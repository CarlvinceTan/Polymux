import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

const transportFiles = [
  ".env.example",
  "apps/cli/src/index.ts",
  "apps/connect/edge/vercel.ts",
  "apps/desktop/src/main/backend.ts",
  "apps/desktop/src/main/team/host-relay.ts",
  "apps/desktop/src/main/team/host-server.ts",
  "apps/connect/relay/src/index.ts",
  "apps/desktop/src/renderer/lib/api/polymux.ts",
  "apps/desktop/src/renderer/lib/features/team/TeamHostDialog.svelte",
  "apps/phone/src/lib/host.ts",
  "apps/phone/src-tauri/Info.plist",
  "apps/phone/src-tauri/capabilities/default.json",
  "apps/phone/src-tauri/gen/android/app/build.gradle.kts",
  "packages/host/src/runtime.ts",
  "packages/protocol/src/host-setup.ts",
  "packages/protocol/src/relay.ts",
];

test("Personal Host transport defaults to Polymux Connect without Tailscale assumptions", async () => {
  const sources = await Promise.all(
    transportFiles.map(async (path) => ({path, text: await readFile(path, "utf8")})),
  );

  for (const {path, text} of sources) {
    assert.doesNotMatch(text, /tailscale|tailnet|\.ts\.net/i, `${path} still assumes Tailscale`);
    for (const marker of ["http:\\/\\/100\\.", "http://100.", "100.64.0.0"])
      assert.equal(text.includes(marker), false, `${path} still allows a legacy CGNAT Host address`);
  }

  for (const path of ["apps/cli/src/index.ts", "apps/desktop/src/main/backend.ts", "apps/phone/src/lib/host.ts"]) {
    const source = sources.find((candidate) => candidate.path === path);
    assert.ok(source, `missing transport contract source ${path}`);
    assert.match(source.text, /connect\.polymux\.com/, `${path} does not name the Polymux Connect default`);
  }

  const protocol = sources.find(({path}) => path === "packages/protocol/src/relay.ts");
  const hostRelay = sources.find(({path}) => path === "apps/desktop/src/main/team/host-relay.ts");
  const relay = sources.find(({path}) => path === "apps/connect/relay/src/index.ts");
  const edge = sources.find(({path}) => path === "apps/connect/edge/vercel.ts");
  assert.ok(protocol && hostRelay && relay && edge, "missing Polymux Connect deployment sources");
  assert.match(protocol.text, /HOST_RELAY_CONNECT_CONFIG_PATH\s*=\s*"\/connect-config"/);
  assert.match(hostRelay.text, /hostRelayConnectConfigEndpoint/);
  assert.match(hostRelay.text, /hostRelayWebSocketEndpoint\(value\.webSocketOrigin/);
  assert.match(relay.text, /webSocketOrigin:\s*url\.origin/);
  assert.match(edge.text, /POLYMUX_CONNECT_UPSTREAM/);

  const ios = sources.find(({path}) => path === "apps/phone/src-tauri/Info.plist");
  const android = sources.find(({path}) => path === "apps/phone/src-tauri/gen/android/app/build.gradle.kts");
  const capability = sources.find(({path}) => path === "apps/phone/src-tauri/capabilities/default.json");
  assert.ok(ios && android && capability, "missing native mobile transport policy sources");
  assert.doesNotMatch(ios.text, /NSAllowsArbitraryLoads/);
  assert.match(ios.text, /NSAllowsLocalNetworking/);
  assert.match(android.text, /manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"false"/);
  assert.match(capability.text, /https:\/\/connect\.polymux\.com\/\*/);
  assert.doesNotMatch(capability.text, /https:\/\/\*|http:\/\/(?!127\.0\.0\.1|localhost)/);
});
