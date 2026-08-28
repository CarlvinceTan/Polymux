import assert from "node:assert/strict";
import test from "node:test";
import {
  SURFACE_PROTOCOL,
  desktopSupportsExtension,
  extensionProtocolHeaders,
  negotiateSurfaceProtocol,
} from "../src/protocol.js";

test("the legacy extension remains compatible with the current desktop", () => {
  assert.deepEqual(
    negotiateSurfaceProtocol(SURFACE_PROTOCOL.legacyExtension),
    {
      compatible: true,
      negotiatedVersion: 1,
      missingCapabilities: [],
      reason: null,
    },
  );
});

test("negotiation chooses the highest common protocol", () => {
  const result = negotiateSurfaceProtocol(
    {minVersion: 1, maxVersion: 3, capabilities: ["surface-commands-v1"]},
    {
      minVersion: 2,
      maxVersion: 4,
      capabilities: ["surface-feed-v1"],
      requiredExtensionCapabilities: ["surface-commands-v1"],
    },
  );
  assert.equal(result.compatible, true);
  assert.equal(result.negotiatedVersion, 3);
});

test("missing required capabilities make the extension incompatible", () => {
  const result = negotiateSurfaceProtocol({
    minVersion: 1,
    maxVersion: 1,
    capabilities: [],
  });
  assert.equal(result.compatible, false);
  assert.deepEqual(result.missingCapabilities, ["surface-commands-v1"]);
});

test("extension headers and desktop capabilities are explicit", () => {
  const headers = extensionProtocolHeaders("4.7.2");
  assert.equal(headers["X-Polymux-Extension-Version"], "4.7.2");
  assert.equal(headers["X-Polymux-Surface-Protocol-Min"], "1");
  assert.equal(headers["X-Polymux-Surface-Protocol-Max"], "1");
  assert.equal(
    desktopSupportsExtension({
      compatible: true,
      negotiatedVersion: 1,
      capabilities: ["surface-feed-v1"],
    }),
    true,
  );
  assert.equal(
    desktopSupportsExtension({
      compatible: true,
      negotiatedVersion: 1,
      capabilities: [],
    }),
    false,
  );
});
