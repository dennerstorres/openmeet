import { createRequire } from "node:module";
const require = createRequire("C:/Users/Administrador/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json");
const { chromium } = require("playwright");
const browser = await chromium.launch({ channel: "msedge", headless: true });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const sid = "44444444-4444-4444-8444-444444444444",
  rid = "11111111-1111-4111-8111-111111111111",
  uid = "22222222-2222-4222-8222-222222222222";
let logged = false;
await page.route("**/api/v1/**", async (route) => {
  const p = new URL(route.request().url()).pathname;
  let status = 200,
    body = {};
  if (p.endsWith("/instance")) body = { name: "OpenMeet", apiVersion: "v1", bootstrapOpen: false, googleLogin: false };
  else if (p.endsWith("/auth/login") || (p.endsWith("/auth/refresh") && logged)) {
    logged = true;
    body = { expiresIn: 900, user: { id: uid, username: "teste", displayName: "Pessoa de teste", role: "admin" } };
  } else if (p.endsWith("/auth/refresh")) {
    status = 401;
    body = { error: "unauthorized" };
  } else if (p.endsWith("/servers")) body = [{ id: sid, name: "Servidor de teste com nome comprido", role: "owner" }];
  else if (p.endsWith("/rooms"))
    body = Array.from({ length: 12 }, (_, i) => ({
      id: i === 0 ? rid : `11111111-1111-4111-8111-${String(i).padStart(12, "0")}`,
      name: i === 0 ? "Geral" : "Sala de equipe " + i,
      slug: "sala" + i,
      kind: "persistent",
      ended: false,
    }));
  else if (p.endsWith("/presence")) body = { [rid]: [{ id: uid, displayName: "Pessoa de teste" }] };
  else if (p.endsWith("/members"))
    body = {
      policy: { allowInvisible: true, managersSeeInvisible: true },
      selfMode: "visible",
      members: [
        { id: uid, displayName: "Pessoa de teste", role: "owner", status: "online", self: true },
        { id: "33333333-3333-4333-8333-333333333333", displayName: "João Ação", role: "participant", status: "away", self: false },
        { id: "55555555-5555-4555-8555-555555555555", displayName: "Gustavo Pavão", role: "participant", status: "offline", self: false },
      ],
    };
  else if (p.endsWith("/join")) body = { url: "ws://127.0.0.1:7880", token: "fixture.layout.only" };
  else {
    status = 404;
    body = { error: "room_not_found" };
  }
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
});
let intercepted = false;
await page.route("**/packages/media/dist/session.js*", async (route) => {
  const response = await route.fetch();
  let body = await response.text();
  body = body.replace(
    "await this.room.connect(url, token);",
    `this.room.localParticipant.identity = '${uid}'; this.room.localParticipant.name = 'Pessoa de teste';`,
  );
  body = body.replace(
    "[local, ...this.room.remoteParticipants.values()]",
    "[local, ...Array.from({length:4}, (_,i)=>({identity: String(i), name: `Participante ${i+1}`}))]",
  );
  intercepted = true;
  await route.fulfill({ response, body });
});
page.on("request", (r) => {
  if (r.url().includes("media") || r.url().includes("session")) console.log(r.url());
});
await page.goto("http://127.0.0.1:1420");
await page.getByLabel("Usuário", { exact: true }).fill("teste");
await page.getByLabel("Senha", { exact: true }).fill("layout-fixture");
await page.screenshot({ path: "artifacts/mobile/login-390.png" });
await page.getByRole("button", { name: "Entrar", exact: true }).click();
await page.locator(".room-item").first().waitFor();
await page.screenshot({ path: "artifacts/mobile/rooms-390.png" });
await page.getByRole("button", { name: "Mostrar membros", exact: true }).click();
await page.locator(".members-panel").waitFor();
await page.screenshot({ path: "artifacts/mobile/members-390.png" });
await page.getByRole("button", { name: "Recolher membros", exact: true }).click();
await page.getByRole("button", { name: "Adicionar servidor", exact: true }).click();
await page.getByRole("dialog", { name: "Adicionar servidor" }).waitFor();
await page.screenshot({ path: "artifacts/mobile/add-server-390.png" });
await page.getByRole("button", { name: "Fechar", exact: true }).click();
await page.getByRole("button", { name: "Configurações do servidor", exact: true }).click();
await page.getByRole("dialog", { name: /Configurações de/ }).waitFor();
await page.screenshot({ path: "artifacts/mobile/server-settings-390.png" });
await page.getByRole("button", { name: "Fechar", exact: true }).click();
await page.locator(".room-item").first().click();
await page
  .locator(".dock")
  .waitFor({ timeout: 10000 })
  .catch(async (e) => {
    console.log(await page.locator("body").innerText());
    await browser.close();
    throw e;
  });
console.log("session fixture intercepted:", intercepted);
const results = [];
for (const [width, height] of [
  [320, 568],
  [390, 844],
  [844, 390],
  [768, 1024],
  [1280, 800],
]) {
  await page.setViewportSize({ width, height });
  await page.screenshot({ path: `artifacts/mobile/call-${width}.png` });
  const measurement = await page.evaluate(() => ({
    viewport: innerWidth,
    scroll: document.documentElement.scrollWidth,
    dock: (() => {
      const r = document.querySelector(".dock").getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    })(),
  }));
  if (measurement.scroll > width) throw new Error("horizontal overflow " + JSON.stringify(measurement));
  if (measurement.dock.left < 0 || measurement.dock.right > width) throw new Error("dock clipped " + width);
  results.push({ width, height, ...measurement });
  if (width <= 900) {
    await page.getByRole("button", { name: "Grade", exact: true }).click();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw new Error("grid overflow");
    await page.screenshot({ path: "artifacts/mobile/grid-" + width + ".png" });
    await page.getByRole("button", { name: "Destaque", exact: true }).click();
    await page.getByRole("button", { name: "Tela cheia", exact: true }).click();
    await page.getByRole("button", { name: "Sair da tela cheia", exact: true }).click();
    await page.getByLabel("Dispositivos e diagnóstico").click();
    await page.getByRole("button", { name: "Fechar ajustes" }).waitFor();
    const r = await page.locator(".more-body").boundingBox();
    if (r.x < 0 || r.x + r.width > width || r.y < 0 || r.y + r.height > height) throw new Error("settings clipped " + JSON.stringify(r));
    await page.screenshot({ path: `artifacts/mobile/settings-${width}.png` });
    await page.getByRole("button", { name: "Fechar ajustes" }).click();
    await page.getByRole("button", { name: "Salas", exact: true }).click();
    if (!(await page.locator(".room-bar").isVisible())) throw new Error("rooms missing");
    await page.getByRole("button", { name: "Voltar à chamada" }).click();
    if (!(await page.locator(".dock").isVisible())) throw new Error("call missing");
  }
}
console.log(JSON.stringify(results, null, 2));
await browser.close();
