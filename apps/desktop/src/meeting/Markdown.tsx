import { useState, type ReactNode } from "react";
import { parseMarkdown, type Block, type Inline } from "./chat-markdown";

// ADR 0024: the parsed tree as React elements. Every piece of text goes through React as text; a link is a
// button-like anchor whose click asks the room to confirm the address before anything opens.

function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <span
      className={`md-spoiler${shown ? " shown" : ""}`}
      role={shown ? undefined : "button"}
      tabIndex={shown ? undefined : 0}
      aria-label={shown ? undefined : "Spoiler, toque para mostrar"}
      onClick={() => setShown(true)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") setShown(true);
      }}
    >
      {children}
    </span>
  );
}

function inline(nodes: Inline[], ctx: Context): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "code":
        return <code key={index}>{node.text}</code>;
      case "bold":
        return <strong key={index}>{inline(node.children, ctx)}</strong>;
      case "italic":
        return <em key={index}>{inline(node.children, ctx)}</em>;
      case "underline":
        return <u key={index}>{inline(node.children, ctx)}</u>;
      case "strike":
        return <s key={index}>{inline(node.children, ctx)}</s>;
      case "spoiler":
        return <Spoiler key={index}>{inline(node.children, ctx)}</Spoiler>;
      case "link":
        return (
          <a
            key={index}
            href={node.url}
            rel="noopener noreferrer nofollow"
            onClick={(event) => {
              event.preventDefault();
              ctx.onLink(node.url);
            }}
          >
            {inline(node.children, ctx)}
          </a>
        );
      case "mention": {
        const resolved = ctx.mentions?.users.includes(node.userId) === true;
        const name = `@${ctx.mentions?.label(node.userId) ?? "alguém"}`;
        if (!resolved) return name;
        return (
          <span key={index} className={`md-mention${node.userId === ctx.mentions?.self ? " self" : ""}`}>
            {name}
          </span>
        );
      }
      case "everyone":
        return ctx.mentions?.everyone === true ? (
          <span key={index} className="md-mention self">
            @{node.name}
          </span>
        ) : (
          `@${node.name}`
        );
    }
  });
}

function block(node: Block, index: number, ctx: Context): ReactNode {
  if (node.type === "codeblock") {
    return (
      <pre key={index} className="md-code" data-lang={node.lang || undefined}>
        <code>{node.text}</code>
      </pre>
    );
  }
  if (node.type === "quote") {
    return (
      <blockquote key={index} className="md-quote">
        {node.children.map((child, at) => block(child, at, ctx))}
      </blockquote>
    );
  }
  return (
    <span key={index} className="md-text">
      {inline(node.children, ctx)}
    </span>
  );
}

export interface MentionContext {
  /** Members the server resolved; anyone else named by id shows as plain text. */
  users: readonly string[];
  everyone: boolean;
  self: string | null;
  label: (userId: string) => string;
}

interface Context {
  onLink: (url: string) => void;
  mentions: MentionContext | undefined;
}

export function Markdown({ source, onLink, mentions }: { source: string; onLink: (url: string) => void; mentions?: MentionContext }) {
  const ctx: Context = { onLink, mentions };
  return <>{parseMarkdown(source).map((node, index) => block(node, index, ctx))}</>;
}
