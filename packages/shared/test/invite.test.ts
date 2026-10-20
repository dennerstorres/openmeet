import assert from "node:assert/strict";
import test from "node:test";
import { inviteFromFragment, inviteLink, invitePageLink, parseInvite } from "../src/invite.js";

const code = "A".repeat(20) + "b_-" + "9".repeat(20);

test("the link carries only the instance host and the code", () => {
  assert.equal(inviteLink("https://meet.example", code), `openmeet://convite?host=meet.example&code=${code}`);
  assert.equal(inviteLink("http://127.0.0.1:3000", code), `openmeet://convite?host=127.0.0.1%3A3000&code=${code}`);
  assert.throws(() => inviteLink("https://meet.example", "short"));
});

test("the app link, the browser page, and the bare code all parse", () => {
  assert.deepEqual(parseInvite(inviteLink("https://meet.example", code)), { origin: "https://meet.example", code });
  assert.deepEqual(parseInvite(inviteLink("http://127.0.0.1:3000", code)), { origin: "http://127.0.0.1:3000", code });
  assert.deepEqual(parseInvite(`https://meet.example/convite/${code}`), { origin: "https://meet.example", code });
  assert.deepEqual(parseInvite(`  ${code}  `), { origin: null, code });
});

test("a public host never falls back to plain HTTP", () => {
  assert.deepEqual(parseInvite(`openmeet://convite?host=meet.example:8443&code=${code}`), { origin: "https://meet.example:8443", code });
  assert.equal(parseInvite(`http://meet.example/convite/${code}`), null);
});

test("anything else is refused without throwing", () => {
  const refused = [
    "",
    "short",
    `openmeet://convite?host=meet.example&code=${code}&refresh=x`,
    `openmeet://convite?host=meet.example&code=${code}&code=${code}`,
    `openmeet://sala?host=meet.example&code=${code}`,
    `openmeet://convite/extra?host=meet.example&code=${code}`,
    `openmeet://convite?host=user@meet.example&code=${code}`,
    `openmeet://convite?host=meet.example/path&code=${code}`,
    `openmeet://convite?host=javascript:alert(1)&code=${code}`,
    `openmeet://convite?host=meet.example&code=${code}#x`,
    `openmeet://convite?host=meet.example&code=${code.slice(1)}`,
    `https://user:pw@meet.example/convite/${code}`,
    `https://meet.example/convite/${code}?next=x`,
    `https://meet.example/outra/${code}`,
    `file:///convite/${code}`,
    "x".repeat(600),
  ];
  for (const raw of refused) assert.equal(parseInvite(raw), null, raw);
});

test("the web client takes the code only from an exact #convite fragment", () => {
  assert.equal(invitePageLink("https://meet.example/", code), `https://meet.example/convite/${code}`);
  assert.deepEqual(parseInvite(invitePageLink("https://meet.example", code)), { origin: "https://meet.example", code });
  assert.throws(() => invitePageLink("https://meet.example", "short"));
  assert.equal(inviteFromFragment(`#convite=${code}`), code);
  assert.equal(inviteFromFragment(`#convite=${code}&x=1`), null);
  assert.equal(inviteFromFragment("#convite=short"), null);
  assert.equal(inviteFromFragment(`?convite=${code}`), null);
  assert.equal(inviteFromFragment(""), null);
});
