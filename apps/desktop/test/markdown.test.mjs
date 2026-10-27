import assert from "node:assert/strict";
import test from "node:test";
import { parseInline, parseMarkdown, safeLink } from "../src/meeting/chat-markdown.ts";

const t = (text) => ({ type: "text", text });

test("markup and scripts stay text; only http and https become links", () => {
  assert.deepEqual(parseInline('<script>alert(1)</script> <img src=x onerror="alert(1)">', 0), [t('<script>alert(1)</script> <img src=x onerror="alert(1)">')]);
  assert.deepEqual(parseInline("[clique](javascript:alert(1))", 0), [t("[clique](javascript:alert(1))")]);
  assert.deepEqual(parseInline("javascript:alert(1) data:text/html,x", 0), [t("javascript:alert(1) data:text/html,x")]);
  assert.equal(safeLink("https://user:pass@example.com"), undefined);
  assert.equal(safeLink("file:///C:/x"), undefined);
  assert.deepEqual(parseInline("veja https://example.com/a?b=1.", 0), [
    t("veja "),
    { type: "link", url: "https://example.com/a?b=1", children: [t("https://example.com/a?b=1")] },
    t("."),
  ]);
  assert.deepEqual(parseInline("[site](https://example.com) e <https://example.org>", 0), [
    { type: "link", url: "https://example.com/", children: [t("site")] },
    t(" e "),
    { type: "link", url: "https://example.org/", children: [t("https://example.org")] },
  ]);
});

test("the Discord marks nest, escape and leave snake_case alone", () => {
  assert.deepEqual(parseInline("**negrito** *itálico* __sub__ ~~risco~~ ||spoiler|| `a*b*`", 0), [
    { type: "bold", children: [t("negrito")] },
    t(" "),
    { type: "italic", children: [t("itálico")] },
    t(" "),
    { type: "underline", children: [t("sub")] },
    t(" "),
    { type: "strike", children: [t("risco")] },
    t(" "),
    { type: "spoiler", children: [t("spoiler")] },
    t(" "),
    { type: "code", text: "a*b*" },
  ]);
  assert.deepEqual(parseInline("*a **b** c*", 0), [{ type: "italic", children: [t("a "), { type: "bold", children: [t("b")] }, t(" c")] }]);
  assert.deepEqual(parseInline("nome_de_variavel \\*nada\\* ** sozinho", 0), [t("nome_de_variavel *nada* ** sozinho")]);
});

test("code blocks keep their text raw and quotes take their lines", () => {
  assert.deepEqual(parseMarkdown("antes\n```js\nconst a = '**x**';\n```\ndepois"), [
    { type: "text", children: [t("antes")] },
    { type: "codeblock", lang: "js", text: "const a = '**x**';" },
    { type: "text", children: [t("depois")] },
  ]);
  assert.deepEqual(parseMarkdown("> citado\n> **dois**\nfora"), [
    { type: "quote", children: [{ type: "text", children: [t("citado\n"), { type: "bold", children: [t("dois")] }] }] },
    { type: "text", children: [t("fora")] },
  ]);
  assert.deepEqual(parseMarkdown(">>> tudo\nisto"), [{ type: "quote", children: [{ type: "text", children: [t("tudo\nisto")] }] }]);
  assert.deepEqual(parseMarkdown("```sem fim"), [{ type: "text", children: [t("```sem fim")] }]);
});

test("deep nesting stops parsing instead of recursing without end", () => {
  const deep = "**".repeat(40) + "x" + "**".repeat(40);
  assert.doesNotThrow(() => parseInline(deep, 0));
});

test("mentions parse outside code, @everyone only at a word edge", () => {
  const id = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(parseInline(`oi <@${id.toUpperCase()}>!`, 0), [t("oi "), { type: "mention", userId: id }, t("!")]);
  assert.deepEqual(parseInline("`<@x>` @here e a@everyone.com", 0), [
    { type: "code", text: "<@x>" },
    t(" "),
    { type: "everyone", name: "here" },
    t(" e a@everyone.com"),
  ]);
  assert.deepEqual(parseInline("@everyoneX", 0), [t("@everyoneX")]);
});

test("a server emoji token is its own node, and stays text inside code", () => {
  const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
  assert.deepEqual(parseInline(`oi <:festa:${id.toUpperCase()}>!`, 0), [t("oi "), { type: "emoji", name: "festa", id }, t("!")]);
  assert.deepEqual(parseInline(`\`<:festa:${id}>\``, 0), [{ type: "code", text: `<:festa:${id}>` }]);
  assert.deepEqual(parseInline("<:x:not-an-id>", 0), [t("<:x:not-an-id>")]);
});
