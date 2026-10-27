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

function inline(nodes: Inline[], onLink: (url: string) => void): ReactNode[] {
  return nodes.map((node, index) => {
    switch (node.type) {
      case "text":
        return node.text;
      case "code":
        return <code key={index}>{node.text}</code>;
      case "bold":
        return <strong key={index}>{inline(node.children, onLink)}</strong>;
      case "italic":
        return <em key={index}>{inline(node.children, onLink)}</em>;
      case "underline":
        return <u key={index}>{inline(node.children, onLink)}</u>;
      case "strike":
        return <s key={index}>{inline(node.children, onLink)}</s>;
      case "spoiler":
        return <Spoiler key={index}>{inline(node.children, onLink)}</Spoiler>;
      case "link":
        return (
          <a
            key={index}
            href={node.url}
            rel="noopener noreferrer nofollow"
            onClick={(event) => {
              event.preventDefault();
              onLink(node.url);
            }}
          >
            {inline(node.children, onLink)}
          </a>
        );
    }
  });
}

function block(node: Block, index: number, onLink: (url: string) => void): ReactNode {
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
        {node.children.map((child, at) => block(child, at, onLink))}
      </blockquote>
    );
  }
  return (
    <span key={index} className="md-text">
      {inline(node.children, onLink)}
    </span>
  );
}

export function Markdown({ source, onLink }: { source: string; onLink: (url: string) => void }) {
  return <>{parseMarkdown(source).map((node, index) => block(node, index, onLink))}</>;
}
