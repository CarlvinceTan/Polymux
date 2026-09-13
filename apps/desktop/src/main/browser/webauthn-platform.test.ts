import assert from "node:assert/strict";
import { test } from "node:test";
import type { App } from "electron";
import {
  configurePlatformWebAuthn,
  webAuthnKeychainAccessGroup,
} from "./webauthn-platform.js";

const signature = `
Identifier=com.flarehq.polymux
TeamIdentifier=23YB4896XA
<key>keychain-access-groups</key>
<array>
  <string>23YB4896XA.com.flarehq.polymux.webauthn</string>
</array>
`;

test("the WebAuthn keychain group follows the actual signed app identity", () => {
  assert.equal(
    webAuthnKeychainAccessGroup(signature),
    "23YB4896XA.com.flarehq.polymux.webauthn",
  );
  assert.equal(webAuthnKeychainAccessGroup("Identifier=com.flarehq.polymux"), null);
  assert.equal(webAuthnKeychainAccessGroup("TeamIdentifier=not set"), null);
});

test("macOS configures Touch ID with the signed keychain group", () => {
  let configured: Parameters<App["configureWebAuthn"]>[0] | null = null;
  const status = configurePlatformWebAuthn(
    {
      configureWebAuthn: (options) => {
        configured = options;
      },
    },
    { platform: "darwin", inspectSignature: () => signature },
  );
  assert.equal(status.enabled, true);
  assert.deepEqual(configured, {
    touchID: {
      keychainAccessGroup: "23YB4896XA.com.flarehq.polymux.webauthn",
      promptReason: "verify your identity on $1",
    },
  });
});

test("unsupported, unsigned and unentitled builds stay available", () => {
  let calls = 0;
  const app = { configureWebAuthn: () => { calls += 1; } };
  assert.deepEqual(configurePlatformWebAuthn(app, { platform: "linux" }), {
    enabled: false,
    reason: "unsupported-platform",
  });
  assert.deepEqual(
    configurePlatformWebAuthn(app, {
      platform: "darwin",
      inspectSignature: () => "Identifier=com.flarehq.polymux",
    }),
    { enabled: false, reason: "unsigned-build" },
  );
  assert.deepEqual(
    configurePlatformWebAuthn(app, {
      platform: "darwin",
      inspectSignature: () => `
Identifier=com.flarehq.polymux
TeamIdentifier=23YB4896XA
      `,
    }),
    { enabled: false, reason: "missing-entitlement" },
  );
  assert.equal(calls, 0);
});

test("an entitlement mismatch cannot fail app startup", () => {
  const status = configurePlatformWebAuthn(
    { configureWebAuthn: () => { throw new Error("not entitled"); } },
    { platform: "darwin", inspectSignature: () => signature },
  );
  assert.equal(status.enabled, false);
  assert.equal(status.reason, "configuration-failed");
});
