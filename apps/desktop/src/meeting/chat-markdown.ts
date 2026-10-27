// ADR 0024: the Discord subset of markdown, parsed into a tree that React renders as elements. Nothing here
// becomes HTML: a `<script>` in a message stays text, and a link exists only for an http or https address.

export type Inline =
  | { type: "text"; text: string }
  | { type: "bold" | "italic" | "underline" | "strike" | "spoiler"; children: Inline[] }
  | { type: "code"; text: string }
  | { type: "link"; url: string; children: Inline[] };

export type Block = { type: "text"; children: Inline[] } | { type: "codeblock"; lang: string; text: string } | { type: "quote"; children: Block[] };

const MAX_DEPTH = 6;
const URL_TAIL = /[.,:;!?'")\]]+$/;

/** An address worth a link: http or https, a host, no credentials. Anything else is shown as text. */
export function safeLink(raw: string): string | undefined {
  if (raw.length > 2048) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname === "" || url.username !== "" || url.password !== "") return undefined;
  return url.href;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  let rest = source;
  while (rest.length > 0) {
    const fence = rest.indexOf("```");
    const before = fence < 0 ? rest : rest.slice(0, fence);
    const close = fence < 0 ? -1 : rest.indexOf("```", fence + 3);
    if (fence < 0 || close < 0) {
      blocks.push(...textBlocks(rest));
      break;
    }
    if (before.length > 0) blocks.push(...textBlocks(before.replace(/\n$/, "")));
    let inner = rest.slice(fence + 3, close);
    const lang = /^([A-Za-z0-9_+-]{1,20})\n/.exec(inner);
    if (lang) inner = inner.slice(lang[0].length);
    else if (inner.startsWith("\n")) inner = inner.slice(1);
    blocks.push({ type: "codeblock", lang: lang?.[1] ?? "", text: inner.replace(/\n$/, "") });
    rest = rest.slice(close + 3).replace(/^\n/, "");
  }
  return blocks;
}

// `>>> ` quotes everything after it; `> ` quotes one line. Other lines stay text, newlines kept.
function textBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  let plain: string[] = [];
  const flush = () => {
    if (plain.length > 0) blocks.push({ type: "text", children: parseInline(plain.join("\n"), 0) });
    plain = [];
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith(">>> ")) {
      flush();
      const quoted = [line.slice(4), ...lines.slice(index + 1)].join("\n");
      blocks.push({ type: "quote", children: [{ type: "text", children: parseInline(quoted, 0) }] });
      return blocks;
    }
    if (line.startsWith("> ")) {
      flush();
      const quoted: string[] = [];
      while (index < lines.length && (lines[index] ?? "").startsWith("> ")) {
        quoted.push((lines[index] ?? "").slice(2));
        index += 1;
      }
      index -= 1;
      blocks.push({ type: "quote", children: [{ type: "text", children: parseInline(quoted.join("\n"), 0) }] });
      continue;
    }
    plain.push(line);
  }
  flush();
  return blocks;
}

const PAIRS: { mark: string; type: "bold" | "underline" | "strike" | "spoiler" | "italic" }[] = [
  { mark: "||", type: "spoiler" },
  { mark: "**", type: "bold" },
  { mark: "__", type: "underline" },
  { mark: "~~", type: "strike" },
  { mark: "*", type: "italic" },
  { mark: "_", type: "italic" },
];

export function parseInline(source: string, depth: number): Inline[] {
  const out: Inline[] = [];
  let text = "";
  const push = (node: Inline) => {
    if (text.length > 0) out.push({ type: "text", text });
    text = "";
    out.push(node);
  };
  let index = 0;
  while (index < source.length) {
    const char = source[index] ?? "";
    const rest = source.slice(index);
    if (char === "\\" && index + 1 < source.length && /[\\*_~|`>[\]()<]/.test(source[index + 1] ?? "")) {
      text += source[index + 1];
      index += 2;
      continue;
    }
    if (char === "`") {
      const run = /^`+/.exec(rest)?.[0] ?? "`";
      const end = source.indexOf(run, index + run.length);
      if (end > index + run.length) {
        push({ type: "code", text: source.slice(index + run.length, end) });
        index = end + run.length;
        continue;
      }
    }
    if (char === "[" && depth < MAX_DEPTH) {
      const masked = /^\[([^\]\n]{1,200})\]\((https?:\/\/[^\s)]{1,2048})\)/.exec(rest);
      const url = masked ? safeLink(masked[2] ?? "") : undefined;
      if (masked && url) {
        push({ type: "link", url, children: parseInline(masked[1] ?? "", depth + 1) });
        index += masked[0].length;
        continue;
      }
    }
    if (char === "<") {
      const angled = /^<(https?:\/\/[^\s>]{1,2048})>/.exec(rest);
      const url = angled ? safeLink(angled[1] ?? "") : undefined;
      if (angled && url) {
        push({ type: "link", url, children: [{ type: "text", text: angled[1] ?? "" }] });
        index += angled[0].length;
        continue;
      }
    }
    if ((char === "h" || char === "H") && /^https?:\/\//i.test(rest) && !/[A-Za-z0-9]$/.test(text)) {
      const raw = (/^https?:\/\/[^\s<]+/i.exec(rest)?.[0] ?? "").replace(URL_TAIL, "");
      const url = safeLink(raw);
      if (url) {
        push({ type: "link", url, children: [{ type: "text", text: raw }] });
        index += raw.length;
        continue;
      }
    }
    if (depth < MAX_DEPTH) {
      const pair = PAIRS.find(({ mark }) => rest.startsWith(mark));
      if (pair) {
        const found = closing(source, index + pair.mark.length, pair.mark);
        // `_` marks italics only at word edges, so snake_case_names stay as they are.
        const edge = pair.mark !== "_" || ((index === 0 || !/\w/.test(source[index - 1] ?? "")) && !/\w/.test(source[found + 1] ?? ""));
        if (found > index + pair.mark.length && edge) {
          push({ type: pair.type, children: parseInline(source.slice(index + pair.mark.length, found), depth + 1) });
          index = found + pair.mark.length;
          continue;
        }
      }
    }
    text += char;
    index += 1;
  }
  if (text.length > 0) out.push({ type: "text", text });
  return out;
}

// The closing mark of the same kind; `*` skips a `**` so bold inside italics still pairs up.
function closing(source: string, from: number, mark: string): number {
  let at = source.indexOf(mark, from);
  while (at >= 0) {
    const inner = source.slice(from, at);
    const doubled = mark.length === 1 && source[at + 1] === mark;
    if (inner.trim().length > 0 && source[at - 1] !== "\\" && !doubled) return at;
    at = source.indexOf(mark, at + (doubled ? 2 : 1));
  }
  return -1;
}
