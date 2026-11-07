import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("desktop package is the private OpenMeet shell", () => {
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "@openmeet/desktop");
  assert.equal(manifest.private, true);
});

test("Tauri identifier matches the instance-local desktop app", () => {
  const config = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  assert.equal(config.identifier, "com.openmeet.desktop");
  assert.equal(config.productName, "OpenMeet");
  assert.equal(config.build.devUrl, "http://localhost:1420");
  const connect = config.app.security.csp["connect-src"];
  assert.match(connect, /\bhttps:/);
  assert.match(connect, /\bwss:/);
  assert.equal(connect.includes("dennerstorres"), false);
});

test("the main window gets only the core calls the page makes (S-14)", () => {
  const capability = JSON.parse(readFileSync(new URL("../src-tauri/capabilities/default.json", import.meta.url), "utf8"));
  assert.deepEqual(capability.windows, ["main"]);
  assert.equal(capability.permissions.includes("core:default"), false);
  assert.equal(
    capability.permissions.some((permission) => permission.includes("allow-internal-toggle-devtools")),
    false,
  );
  assert.equal(capability.permissions.includes("core:webview:deny-internal-toggle-devtools"), true);
  assert.equal(capability.permissions.includes("core:event:allow-listen"), true);
  assert.equal(
    capability.permissions.some((permission) => permission.startsWith("core:event:allow-emit")),
    false,
  );
  assert.equal("remote" in capability, false);
});

test("the release CSP has base-uri none and no inline style (S-15)", () => {
  const security = JSON.parse(readFileSync(new URL("../src-tauri/tauri.conf.json", import.meta.url), "utf8")).app.security;
  assert.equal(security.csp["base-uri"], "'none'");
  assert.equal(security.csp["style-src"].includes("unsafe-inline"), false);
  // Only `tauri dev` serves CSS through Vite style tags.
  assert.equal(security.devCsp["base-uri"], "'none'");
  assert.equal(security.devCsp["connect-src"], security.csp["connect-src"]);
});

test("fullscreen maps the shell to the call only on desktop and narrow web layouts", () => {
  const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
  assert.match(css, /\.server-shell\.is-fullscreen\s*{[^}]*grid-template-areas:\s*"call";[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  assert.match(
    css,
    /@media \(max-width: 900px\)[\s\S]*\.web-shell\.is-fullscreen\s*{[^}]*grid-template-areas:\s*"call";[^}]*grid-template-rows:\s*minmax\(0, 1fr\);/,
  );
  assert.match(css, /\.web-shell\.is-fullscreen \.mobile-navigation\s*{[^}]*display:\s*none;/s);
});

test("dialogs and their form controls cannot grow beyond the viewport", () => {
  const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
  assert.match(css, /\.fui-DialogSurface\s*{[^}]*max-width:\s*calc\(100vw - 24px\);[^}]*max-height:\s*calc\(100dvh - 24px\);[^}]*min-width:\s*0;/s);
  assert.match(css, /\.fui-DialogContent\s*{[^}]*overflow-x:\s*hidden;/s);
  assert.match(
    css,
    /\.fui-DialogSurface \.fui-Field,[\s\S]*\.fui-DialogSurface \.fui-Select__select,[\s\S]*\.fui-DialogSurface select,[\s\S]*{[^}]*width:\s*100%;[^}]*min-width:\s*0;[^}]*max-width:\s*100%;/,
  );
});

test("the sidebar sound button follows the same outlined control style as its Fluent siblings", () => {
  const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
  const meeting = readFileSync(new URL("../src/meeting/MeetingApp.tsx", import.meta.url), "utf8");
  assert.match(
    css,
    /\.voice-actions \.sounds summary\s*{[^}]*min-height:\s*32px;[^}]*border:\s*1px solid var\(--colorNeutralStroke1, #3a423f\);[^}]*border-radius:\s*4px;[^}]*background:\s*transparent;/s,
  );
  assert.match(css, /\.voice-actions \.sounds\[open\] summary\s*{[^}]*background:\s*var\(--bg-active\);/s);
  assert.equal(meeting.match(/<SoundPanel/g)?.length, 1);
  assert.match(meeting, /<SoundPanel\s+variant="panel"/);
});

test("quick device menus contain only selectors and the call has an output volume", () => {
  const meeting = readFileSync(new URL("../src/meeting/MeetingApp.tsx", import.meta.url), "utf8");
  assert.equal(meeting.includes("Configurações de voz"), false);
  assert.equal(meeting.includes("onSettings"), false);
  assert.match(meeting, /label="Opções de saída"[\s\S]*kind: "audiooutput"/);
  assert.match(meeting, /Volume de saída da chamada:/);
  assert.match(meeting, /outputVolume=\{outputVolume \/ 100\}/);
});

test("the call options panel always fits the viewport and scrolls internally", () => {
  const css = readFileSync(new URL("../src/App.css", import.meta.url), "utf8");
  assert.match(
    css,
    /\.more-body\s*{[^}]*max-height:\s*calc\(100dvh - 128px\);[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;[^}]*box-sizing:\s*border-box;/s,
  );
  assert.match(css, /\.more-body\s*>\s*\*\s*{[^}]*flex-shrink:\s*0;/s);
});
