import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "../src/app.js";

test("privacy and terms pages are public, static and script-free", async () => {
  const app = await buildApp({ logger: false, env: {} });
  try {
    for (const [url, title] of [
      ["/privacidade", "Política de Privacidade"],
      ["/termos", "Termos de Serviço"],
    ] as const) {
      const page = await app.inject({ method: "GET", url });
      assert.equal(page.statusCode, 200);
      assert.match(String(page.headers["content-type"]), /^text\/html/);
      assert.match(String(page.headers["content-security-policy"]), /default-src 'none'/);
      assert.equal(page.body.includes(title), true);
      assert.equal(page.body.includes("<script"), false);
    }
  } finally {
    await app.close();
  }
});
