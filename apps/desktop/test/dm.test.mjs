import assert from "node:assert/strict";
import test from "node:test";
import { dmClosed, dmPeer } from "../src/meeting/dm-state.ts";

const ana = "22222222-2222-4222-8222-222222222222";
const bia = "33333333-3333-4333-8333-333333333333";
const direct = {
  id: "44444444-4444-4444-8444-444444444444",
  kind: "direct",
  name: null,
  createdBy: ana,
  members: [
    { id: ana, label: "Ana", avatarId: null },
    { id: bia, label: "Bia", avatarId: null },
  ],
  readOnly: false,
};

test("a block leaves the direct DM read only for both, and only the one who blocked is told why", () => {
  assert.equal(dmPeer(direct, ana)?.label, "Bia");
  assert.equal(dmPeer({ ...direct, kind: "group" }, ana), null);
  assert.equal(dmClosed(direct, ana, new Set()), null);
  const blocked = { ...direct, readOnly: true };
  assert.match(dmClosed(blocked, ana, new Set([bia])) ?? "", /Você bloqueou Bia/);
  assert.equal(dmClosed(blocked, bia, new Set()), "Esta conversa está só para leitura.");
});
