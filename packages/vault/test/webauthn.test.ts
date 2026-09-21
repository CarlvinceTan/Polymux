import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOCKED,
  VaultSession,
  credentialIdsEqual,
  decodeCredentialId,
  relyingPartyMatches,
  rpIdAllowedForOrigin,
  type VaultBlobStore,
} from "../src/index.js";
import { type VaultMeta } from "../src/meta.js";

class MemoryStore implements VaultBlobStore {
  data: { bytes: Uint8Array; meta: VaultMeta } | null = null;

  async load() {
    return this.data
      ? { bytes: new Uint8Array(this.data.bytes), meta: { ...this.data.meta } }
      : null;
  }

  async save(bytes: Uint8Array, meta: VaultMeta) {
    this.data = { bytes: new Uint8Array(bytes), meta: { ...meta } };
  }
}

test("a passkey RP id matches the exact relying party, not a lookalike host", () => {
  assert.equal(relyingPartyMatches("github.com", "github.com"), true);
  assert.equal(relyingPartyMatches("www.github.com", "github.com"), true);
  assert.equal(relyingPartyMatches("github.com", "gist.github.com"), false);
  assert.equal(relyingPartyMatches("google.com", "evil-google.com"), false);
});

test("an RP id is allowed on its origin and a subdomain, not on another site", () => {
  assert.equal(rpIdAllowedForOrigin("github.com", "https://github.com/login"), true);
  assert.equal(rpIdAllowedForOrigin("github.com", "https://gist.github.com"), true);
  assert.equal(rpIdAllowedForOrigin("github.com", "https://evil-github.com"), false);
  assert.equal(rpIdAllowedForOrigin("github.com", "http://github.com"), false);
  assert.equal(rpIdAllowedForOrigin("localhost", "http://localhost:3000"), true);
});

test("credential ids compare across base64 and base64url", () => {
  assert.equal(credentialIdsEqual("abcd+/==", "abcd-_"), true);
  assert.equal(credentialIdsEqual("aaaa", "aaab"), false);
});

test("create and get a vault passkey for the same RP", async () => {
  const session = new VaultSession(new MemoryStore());
  await session.hydrate();
  await session.create("correct horse");
  const created = await session.createPasskey({
    origin: "https://github.com",
    rpId: "github.com",
    rpName: "GitHub",
    challenge: "dGVzdC1jaGFsbGVuZ2U",
    userName: "ada",
    userDisplayName: "Ada",
    userId: "dXNlci0x",
  });
  assert.equal(created.type, "public-key");
  assert.ok(decodeCredentialId(created.rawId)?.byteLength);
  assert.ok(decodeCredentialId(created.attestationObject)?.byteLength);
  const secrets = session.reveal(created.itemId);
  assert.equal(secrets.passkey?.relyingParty, "github.com");
  assert.equal(session.list().items[0]?.hasPasskey, true);

  const offers = session.listPasskeys({
    origin: "https://github.com",
    rpId: "github.com",
    challenge: "dGVzdC1jaGFsbGVuZ2U",
  });
  assert.equal(offers.length, 1);
  assert.equal(offers[0]?.username, "ada");
  assert.equal(
    session.listPasskeys({
      origin: "https://gitlab.com",
      rpId: "gitlab.com",
      challenge: "dGVzdC1jaGFsbGVuZ2U",
    }).length,
    0,
  );

  const assertion = await session.getPasskey({
    origin: "https://github.com",
    rpId: "github.com",
    challenge: "c2Vjb25kLWNoYWxsZW5nZQ",
    itemId: created.itemId,
  });
  assert.equal(assertion.type, "public-key");
  assert.ok(decodeCredentialId(assertion.signature)?.byteLength);
  assert.equal(assertion.id, created.id);
});

test("a locked vault refuses passkey get and create", async () => {
  const session = new VaultSession(new MemoryStore());
  await session.hydrate();
  await session.create("correct horse");
  await session.createPasskey({
    origin: "https://github.com",
    rpId: "github.com",
    challenge: "dGVzdC1jaGFsbGVuZ2U",
    userName: "ada",
    userId: "dXNlci0x",
  });
  session.lock();
  const request = {
    origin: "https://github.com",
    rpId: "github.com",
    challenge: "dGVzdC1jaGFsbGVuZ2U",
  };
  assert.throws(() => session.listPasskeys(request), { message: LOCKED });
  await assert.rejects(() => session.getPasskey(request), { message: LOCKED });
  await assert.rejects(
    () =>
      session.createPasskey({
        ...request,
        userName: "ada",
        userId: "dXNlci0x",
      }),
    { message: LOCKED },
  );
});
