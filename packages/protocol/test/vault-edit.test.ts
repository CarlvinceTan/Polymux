import assert from "node:assert/strict";
import { test } from "node:test";
import {
  VaultSelectionGate,
  vaultEditDraft,
  normalizeVaultSaveDraft,
  type VaultItemDto,
  type VaultSecretsDto,
} from "../src/index.js";

const item: VaultItemDto = {
  id: "item-1",
  title: "Mail",
  username: "me",
  url: "https://example.com",
  notes: "note",
  groupId: "group-1",
  groupName: "Personal",
  hasPassword: true,
  hasTotp: true,
  hasRecoveryCodes: true,
  hasPasskey: true,
  updatedAt: null,
};
const secrets: VaultSecretsDto = {
  password: "secret",
  totp: null,
  recoveryCodes: ["one"],
  passkey: {
    relyingParty: "example.com",
    username: "me",
    credentialId: "credential",
    userHandle: "handle",
  },
};

test("editing preserves hidden TOTP and passkey private key fields", () => {
  const draft = vaultEditDraft(item, secrets);
  const payload = normalizeVaultSaveDraft(draft);
  assert.equal(payload.password, "secret");
  assert.equal("totpSecret" in payload, false);
  assert.equal("privateKeyPem" in (payload.passkey ?? {}), false);
});

test("editing omits a blank hidden password instead of deleting it", () => {
  const payload = normalizeVaultSaveDraft({
    ...vaultEditDraft(item, secrets),
    password: "",
  });
  assert.equal("password" in payload, false);
});

test("selection gate rejects late responses and invalidated work", () => {
  const gate = new VaultSelectionGate();
  const first = gate.begin("first");
  const second = gate.begin("second");
  assert.equal(gate.accepts(first, "second"), false);
  assert.equal(gate.accepts(second, "second"), true);
  gate.invalidate();
  assert.equal(gate.accepts(second, "second"), false);
});
