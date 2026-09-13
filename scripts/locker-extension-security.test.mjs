import assert from "node:assert/strict";
import test from "node:test";
import {chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {spawnSync} from "node:child_process";
import vm from "node:vm";
import {transformSync} from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const source = (file) => readFileSync(join(root, file), "utf8");
const extensionId = "a".repeat(32);
const token = "b".repeat(64);
const stripImports = (text) => text.replace(/^import\s[\s\S]*?from\s*["'][^"']+["'];\s*/gm, "");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function nativeRequest(home, caller, {instance, id = extensionId, browser = "chromium", manifestPath = join(home, "Library", "Application Support", "Mozilla", "NativeMessagingHosts", "com.polymux.tab_context.json")} = {}) {
  const body = Buffer.from(JSON.stringify({type: "polymux:locker-connection"}));
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length);
  const env = {...process.env, HOME: home, POLYMUX_EXTENSION_ID: id, POLYMUX_NATIVE_BROWSER: browser};
  delete env.POLYMUX_DEV_INSTANCE;
  if (instance) env.POLYMUX_DEV_INSTANCE = instance;
  const result = spawnSync(process.execPath, [join(root, "apps/extension/native-host/polymux_tab_context_host.mjs"), ...(browser === "firefox" ? [manifestPath] : []), caller], {
    env, input: Buffer.concat([header, body]), timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr.toString());
  const length = result.stdout.readUInt32LE(0);
  return JSON.parse(result.stdout.subarray(4, 4 + length).toString());
}

test("native messaging returns the private capability only to the installed extension and honors isolate paths", () => {
  const home = mkdtempSync(join(tmpdir(), "polymux-native-locker-"));
  try {
    mkdirSync(join(home, ".polymux"));
    const file = join(home, ".polymux", "locker-extension-capability");
    writeFileSync(file, token, {mode: 0o600});
    assert.deepEqual(nativeRequest(home, `chrome-extension://${extensionId}/`), {ok: true, token});
    assert.deepEqual(nativeRequest(home, `chrome-extension://${extensionId}`), {ok: true, token});
    for (const caller of [`chrome-extension://${"c".repeat(32)}/`, "https://attacker.example/", "null"])
      assert.equal(nativeRequest(home, caller).ok, false);
    assert.equal(nativeRequest(home, `chrome-extension://${extensionId}/`, {id: ""}).ok, false);
    assert.equal(nativeRequest(home, `chrome-extension://${extensionId}/`, {instance: "review"}).ok, false);
    mkdirSync(join(home, ".polymux-review"));
    writeFileSync(join(home, ".polymux-review", "locker-extension-capability"), "d".repeat(64), {mode: 0o600});
    assert.equal(nativeRequest(home, `chrome-extension://${extensionId}/`, {instance: "review"}).token, "d".repeat(64));
    if (process.platform !== "win32") {
      chmodSync(file, 0o644);
      const denied = nativeRequest(home, `chrome-extension://${extensionId}/`);
      assert.equal(denied.ok, false);
      assert.equal(JSON.stringify(denied).includes(token), false);
    }
  } finally { rmSync(home, {recursive: true, force: true}); }
});

async function apiFixture({native, fetch, browserOrigin = `chrome-extension://${extensionId}/`}) {
  const text = stripImports(source("apps/extension/locker/api.js"))
    .replace(/^export \{[^}]+\};/gm, "")
    .replace(/^export /gm, "")
    .replace('await import("./config.local.js")', "null");
  return new (Object.getPrototypeOf(async function() {}).constructor)("chrome", "fetch", "DESKTOP_OFFLINE", "POLYMUX_SUPABASE_URL", "POLYMUX_SUPABASE_ANON_KEY", `${text}\nreturn {lockerRequest, handleWebAuthn, desktopLockerUnavailableReason};`)(
    {runtime: {sendNativeMessage: native, getURL: (path) => browserOrigin + path}}, fetch, "DESKTOP_OFFLINE", "", "",
  );
}

test("Locker API obtains capabilities only from native messaging, protects destinations and retries a rotated token", async () => {
  const calls = [];
  let nativeCalls = 0;
  const api = await apiFixture({
    native: async (host, request) => {
      assert.equal(host, "com.polymux.tab_context");
      assert.equal(request.type, "polymux:locker-connection");
      return {ok: true, token: ++nativeCalls === 1 ? token : "c".repeat(64)};
    },
    fetch: async (url, init) => {
      calls.push({url, init});
      return {status: calls.length === 1 ? 403 : 200, ok: calls.length !== 1, json: async () => ({unlocked: true})};
    },
  });
  assert.deepEqual(await api.lockerRequest("/v1/locker/status", {headers: {Authorization: "attacker"}}), {unlocked: true});
  assert.equal(nativeCalls, 2);
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[1].init.headers.Authorization, `Bearer ${"c".repeat(64)}`);
  assert.equal(calls.every(({url}) => url === "http://127.0.0.1:47654/v1/locker/status"), true);
  await assert.rejects(api.lockerRequest("https://attacker.example/v1/locker/status"), /Invalid Locker endpoint/);
  await assert.rejects(api.lockerRequest("/v1/snapshot"), /Invalid Locker endpoint/);
  assert.equal(calls.length, 2);
  assert.deepEqual(await api.handleWebAuthn({action: "unlock", password: "never-forward"}), {error: "Unknown passkey request"});
});

test("missing native enrollment fails closed without an HTTP request", async () => {
  let fetched = false;
  const api = await apiFixture({native: async () => { throw new Error("host missing"); }, fetch: async () => { fetched = true; }});
  await assert.rejects(api.lockerRequest("/v1/locker/status"), (error) => error.code === "DESKTOP_OFFLINE");
  assert.equal(fetched, false);
});

function backgroundFixture() {
  const handlers = [];
  const calls = [];
  const event = {addListener() {}};
  const chrome = {
    runtime: {id: extensionId, getURL: (path) => `chrome-extension://${extensionId}/${path}`, getManifest: () => ({version: "1"}),
      onMessage: {addListener: (handler) => handlers.push(handler)}, onInstalled: event, onStartup: event, onSuspend: event},
    tabs: Object.fromEntries(["onCreated", "onRemoved", "onUpdated", "onActivated", "onMoved", "onAttached"].map((name) => [name, event])),
    windows: {onFocusChanged: event}, alarms: {onAlarm: event},
  };
  const text = stripImports(source("apps/extension/background.js"))
    .replace(/^void refreshWatchedTabs\(\);$/gm, "").replace(/^scheduleSnapshot\(\);$/gm, "").replace(/^void pump\(\);$/gm, "");
  vm.runInNewContext(text, {chrome, URL, Headers, extensionProtocolHeaders: () => ({}),
    handleWebAuthn: async (value) => { calls.push(value); return {unlocked: true}; },
    lockerRequest: async () => { calls.push("locker-request"); return {}; },
    unlockDeviceSession: async () => { calls.push("unlock"); return {unlocked: true}; },
  });
  return {calls, request: (message, sender) => new Promise((resolve) => handlers[0](message, sender, resolve))};
}

test("background uses the real frame sender, rejects opaque/missing origins and reserves unlock/proxy to extension pages", async () => {
  const fixture = backgroundFixture();
  const sender = {id: extensionId, url: "https://real.example/frame", origin: "https://real.example"};
  assert.equal((await fixture.request({type: "polymux:webauthn", action: "status", origin: "https://attacker.example"}, sender)).unlocked, true);
  assert.equal(fixture.calls[0].origin, "https://real.example");
  for (const bad of [{}, {...sender, url: undefined, tab: {url: sender.url}}, {...sender, origin: "null"}, {...sender, origin: "https://other.example"}])
    assert.match((await fixture.request({type: "polymux:webauthn", action: "get", origin: "https://real.example"}, bad)).error, /Invalid passkey/);
  for (const type of ["polymux:locker-request", "polymux:locker-device-unlock", "polymux:locker-pending"])
    assert.equal((await fixture.request({type, path: "/v1/locker/export", password: "secret"}, sender)).ok, false);
  assert.match((await fixture.request({type: "polymux:webauthn", action: "unlock"}, sender)).error, /Invalid passkey/);
  assert.equal(fixture.calls.length, 1);
  assert.equal((await fixture.request({type: "polymux:locker-device-unlock", password: "secret"}, {id: extensionId, url: `chrome-extension://${extensionId}/locker/popup.html`})).unlocked, true);
  assert.equal(fixture.calls.at(-1), "unlock");
});

function bridgeFixture(kind, answer) {
  let listener;
  const messages = [];
  const shadows = [];
  const replies = [];
  const window = {addEventListener: (name, callback) => { if (name === "message") listener = callback; }, postMessage: (message) => replies.push(message)};
  const document = {
    getElementById: () => null,
    documentElement: {querySelector: () => true, appendChild() {}},
    createElement: () => ({attachShadow() {
      const elements = new Map();
      const element = (id) => {
        if (!elements.has(id)) elements.set(id, {events: {}, hidden: true, addEventListener(event, callback) { this.events[event] = callback; }});
        return elements.get(id);
      };
      const shadow = {innerHTML: "", elements, getElementById: (id) => element(`#${id}`), querySelector: element, querySelectorAll: () => []};
      shadows.push(shadow);
      return shadow;
    }}),
  };
  const invoke = async (value) => { messages.push(value); return answer(value); };
  let text = source(kind === "desktop" ? "apps/desktop/src/preload/webauthn.ts" : "apps/extension/locker/webauthn.js");
  if (kind === "desktop") text = transformSync(stripImports(text).replace("export function", "function"), {loader: "ts"}).code + "\ninstallLockerWebAuthn();";
  vm.runInNewContext(text, {window, document, location: {origin: "https://real.example"},
    ipcRenderer: {invoke: (_channel, payload) => invoke(payload)}, webFrame: {executeJavaScript() {}},
    chrome: {runtime: {getURL: (path) => path, sendMessage: invoke}},
  });
  return {messages, shadows, replies, send: async (action, options) => {
    listener({source: window, data: {source: "polymux-webauthn", dir: "request", id: 1, action, options}});
    await tick();
  }};
}

for (const kind of ["desktop", "extension"]) {
  test(`${kind} passkey bridge whitelists hostile page options before privileged dispatch`, async () => {
    const fixture = bridgeFixture(kind, () => ({offers: []}));
    await fixture.send("get", {action: "create", type: "polymux:locker-request", origin: "https://attacker.example", path: "/v1/locker/export", password: "never-forward", itemId: "forged", rpId: "real.example", challenge: "abc", allowCredentialIds: ["id", 5]});
    assert.equal(fixture.messages.length, 1);
    const message = fixture.messages[0];
    assert.equal(message.action, "offers");
    assert.equal(message.rpId, "real.example");
    assert.deepEqual(Array.from(message.allowCredentialIds), ["id"]);
    for (const key of ["path", "password", "itemId"]) assert.equal(key in message, false);
    if (kind === "extension") {
      assert.equal(message.type, "polymux:webauthn");
      assert.equal(message.origin, "https://real.example");
    } else assert.equal("origin" in message, false);
  });

  test(`${kind} locked passkeys display only trusted-surface unlock instructions and Retry`, async () => {
    const fixture = bridgeFixture(kind, () => ({locked: true, unlocked: false}));
    await fixture.send("get", {rpId: "real.example", challenge: "abc"});
    const shadow = fixture.shadows[0];
    assert.ok(shadow);
    assert.match(shadow.innerHTML, /Unlock Locker in Polymux/);
    assert.doesNotMatch(shadow.innerHTML, /<input|type="password"|Master password/);
    await shadow.elements.get("#retry").events.click();
    await tick();
    assert.equal(fixture.messages.at(-1).action, "status");
    assert.equal(fixture.messages.some((message) => message.action === "unlock" || "password" in message), false);
    assert.equal(shadow.elements.get(".error").hidden, false);
  });
}


test("Firefox enrollment pins both its add-on ID and native manifest and uses a separate wrapper", () => {
  const home = mkdtempSync(join(tmpdir(), "polymux-firefox-locker-"));
  try {
    mkdirSync(join(home, ".polymux"));
    writeFileSync(join(home, ".polymux", "locker-extension-capability"), token, {mode: 0o600});
    const firefox = {browser: "firefox", id: "extension@polymux.com"};
    assert.deepEqual(nativeRequest(home, "extension@polymux.com", firefox), {ok: true, token});
    assert.equal(nativeRequest(home, "attacker@example.com", firefox).ok, false);
    assert.equal(nativeRequest(home, "extension@polymux.com", {...firefox, manifestPath: "/tmp/unapproved.json"}).ok, false);
    assert.equal(nativeRequest(home, "extension@polymux.com", {...firefox, id: "attacker@example.com"}).ok, false);
    if (process.platform === "darwin") {
      const install = spawnSync("/bin/zsh", [join(root, "apps/extension/install.sh"), "firefox"], {
        env: {...process.env, HOME: home}, encoding: "utf8", timeout: 5000,
      });
      assert.equal(install.status, 0, install.stderr);
      const manifestPath = join(home, "Library", "Application Support", "Mozilla", "NativeMessagingHosts", "com.polymux.tab_context.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      assert.deepEqual(manifest.allowed_extensions, ["extension@polymux.com"]);
      assert.equal("allowed_origins" in manifest, false);
      assert.match(manifest.path, /polymux_tab_context_host-firefox$/);
      const body = Buffer.from(JSON.stringify({type: "polymux:locker-connection"}));
      const header = Buffer.alloc(4);
      header.writeUInt32LE(body.length);
      const env = {...process.env, HOME: home};
      delete env.POLYMUX_DEV_INSTANCE;
      const reply = spawnSync(manifest.path, [manifestPath, "extension@polymux.com"], {env, input: Buffer.concat([header, body]), timeout: 5000});
      assert.equal(reply.status, 0, reply.stderr.toString());
      assert.ok(reply.stdout.length > 4, `No framed reply from wrapper: ${readFileSync(manifest.path, "utf8")} ${reply.stderr}`);
      assert.deepEqual(JSON.parse(reply.stdout.subarray(4).toString()), {ok: true, token});
    }
  } finally { rmSync(home, {recursive: true, force: true}); }
});

test("Safari explicitly reports standalone availability and never requests a desktop capability", async () => {
  let contacted = false;
  const api = await apiFixture({browserOrigin: "safari-web-extension://test/", native: async () => { contacted = true; }, fetch: async () => { contacted = true; }});
  assert.match(api.desktopLockerUnavailableReason(), /Desktop Locker connection is not available/);
  await assert.rejects(api.lockerRequest("/v1/locker/status"), (error) => error.code === "DESKTOP_OFFLINE");
  assert.equal(contacted, false);
});
