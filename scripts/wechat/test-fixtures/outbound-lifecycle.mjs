// Executes production modules with fixture-only process and filesystem APIs.
// No WeChat process, account store, socket or debugger can be reached.
import assert from "node:assert/strict";
import {spawn} from "node:child_process";
import {readFile} from "node:fs/promises";
import {EventEmitter} from "node:events";
import {PassThrough, Readable} from "node:stream";
import vm from "node:vm";
import * as crypto from "node:crypto";
import * as realWire from "../wechat-wire.mjs";
import * as coordination from "../wechat-daemon-coordination.mjs";

const mode = process.argv[2];
if (mode === "fake-debugger") {
  process.on("SIGINT", () => process.stdout.write("fixture: SIGINT\n(lldb)\n"));
  process.on("SIGTERM", () => {
    process.stdout.write("fixture: unsafe SIGTERM\n");
    process.exit(9);
  });
  process.stdin.setEncoding("utf8");
  let commands = "";
  process.stdin.on("data", chunk => {
    commands += chunk;
    if (commands.includes("polymux-native-cleanup\nprocess detach\nquit\n")) {
      process.stdout.write("fixture: cleanup\nProcess 4242 detached\n", () => process.exit(0));
    }
  });
  if (process.argv[3] === "scheduled") process.stdout.write('{"scheduled":true}\n');
  process.stdout.write("fixture: attached\n");
} else {
  await runFixture();
}

async function fixtureModule(file, overrides, globals = {}) {
  const context = vm.createContext({Buffer, console, URL, setTimeout, clearTimeout,
    setInterval, clearInterval, ...globals});
  const url = new URL(file, import.meta.url);
  const module = new vm.SourceTextModule(await readFile(url, "utf8"), {
    context, identifier: url.href,
    initializeImportMeta(meta) {meta.url = url.href;},
  });
  await module.link(async specifier => {
    const exports = overrides[specifier] ?? await import(
      specifier.startsWith(".") ? new URL(specifier, url).href : specifier);
    const names = Object.keys(exports);
    return new vm.SyntheticModule(names, function () {
      for (const name of names) this.setExport(name, exports[name]);
    }, {context});
  });
  await module.evaluate();
  return module.namespace;
}

function commandResult(stdout, code = 0) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = () => {throw new Error("fixture command cannot be signalled");};
  queueMicrotask(() => {
    child.stdout.end(stdout);
    child.emit("close", code);
  });
  return child;
}

async function runFixture() {
  if (mode === "cached-media-file" || mode === "cached-media-video" || mode === "cached-media-missing") {
    const kind = mode === "cached-media-video" ? "video" : "file";
    const calls = [];
    let finish;
    const result = new Promise(resolve => {finish = resolve;});
    const wire = Object.fromEntries(Object.keys(realWire).map(name => [name,
      () => {throw new Error(`Cached media invoked native action: ${name}`);} ]));
    const row = {server_id: "9001", local_id: "12", create_time: 1788886800, message_kind: kind,
      message_content: '<msg><appmsg><title>notes.txt</title><type>6</type><appattach><totallen>4</totallen><md5>' + 'ab'.repeat(16) + '</md5></appattach></appmsg></msg>',
      media: {md5: 'ab'.repeat(16), length: 4, durationMs: 2000}};
    const cached = async (options, identity) => {
      assert.equal(options.registryPath, "/fixture/own-store.json");
      assert.equal(options.accountWxid, "wxid_self");
      calls.push("cache");
      if (kind === "video") assert.equal(identity.serverId, "9001");
      return {localPath: "/fixture/notes.txt", size: 4, md5: 'ab'.repeat(16)};
    };
    await fixtureModule("../polymux-wechat-driver.mjs", {
      "node:child_process": {spawn() {throw new Error("Cached media spawned an external process");}},
      "./wechat-wire.mjs": wire,
      "./wechat-local-reader.mjs": {async readLocalCommand(args) {
        calls.push(args[0]);
        if (args[0] === "accounts") return {accounts: [{wxid: "wxid_self"}]};
        assert.equal(args[0], "history");
        assert.equal(args[1], "filehelper");
        return {rows: mode === "cached-media-missing" ? [] : [row]};
      }},
      "./wechat-desktop-store.mjs": {loadDesktopFile: cached, loadDesktopVideo: cached,
        loadDesktopVoice() {throw new Error("Unexpected voice read");}, loadDesktopGroupInfo() {},
        loadDesktopMessageSource() {}, loadDesktopReadStates() {}, loadDesktopStickers() {}},
    }, {process: {pid: 4242, env: {POLYMUX_WECHAT_PROVIDER: "hybrid", POLYMUX_WECHAT_CLI: "/forbidden/provider",
      POLYMUX_WECHAT_STORE_REGISTRY: "/fixture/own-store.json"},
      argv: ["node", "driver", "read-media", "--json"], once() {},
      stdin: Readable.from([Buffer.from(JSON.stringify({kind, chatId: "filehelper", serverId: "9001", localId: "12", timestamp: 1788886800, localOnly: true}))]),
      stdout: {write(line) {finish(JSON.parse(line));}}, stderr: {write() {}}, getuid: () => 501}});
    const answer = await result;
    assert.equal(answer.reason, undefined, answer.reason);
    if (mode === "cached-media-missing") assert.equal(answer.media, null);
    else assert.equal(answer.media?.size, 4);
    assert.deepEqual(calls, mode === "cached-media-missing" ? ["accounts", "history"] : ["accounts", "history", "cache"]);
    console.log(JSON.stringify({mode, ownRegistryOnly: true}));
    return;
  }
  if (["cancel", "timeout", "service-cancel"].includes(mode)) {
    let transcript = "";
    let native;
    let fake;
    const files = new Map();
    const namespace = await fixtureModule("../wechat-wire.mjs", {
      "node:child_process": {execFile() {
        throw new Error("unexpected process identity lookup in debugger fixture");
      }, spawn(command, args, options) {
        if (command === "pgrep") return commandResult("4242\n");
        assert.equal(command, "fixture-lldb");
        assert.equal(options.stdio[0], "pipe", "cleanup must have LLDB stdin");
        fake = spawn(process.execPath, [new URL(import.meta.url).pathname, "fake-debugger", ...(mode === "service-cancel" ? ["scheduled"] : [])],
          {stdio: ["pipe", "pipe", "pipe"]});
        fake.stdout.on("data", chunk => {
          const text = chunk.toString();
          transcript += text;
          if (mode.endsWith("cancel") && text.includes("fixture: attached"))
            native.interruptNativeOperations(new Error("fixture cancellation"));
        });
        return fake;
      }},
      "node:crypto": {...crypto, createHash(algorithm) {
        assert.equal(algorithm, "sha256");
        return {update() {return this;}, digest() {return realWire.WECHAT_NATIVE_PROFILE_SHA256;}};
      }},
      "node:fs/promises": {
        access: async () => {}, readFile: async file => String(file).endsWith("/VERSION") ? "f".repeat(64) : Buffer.from("fixture profile"),
        lstat: async () => {throw Object.assign(new Error("absent"), {code: "ENOENT"});},
        writeFile: async (file, value) => {files.set(file, value);},
        rename: async (from, to) => {files.set(to, files.get(from)); files.delete(from);},
        rm: async file => {files.delete(file);},
        // Publishing the primer and staging an attachment copy private bytes
        // into the target's temporary directory. The fixture only tracks the
        // files it must clean up, so these stay inert. stat backs the digest
        // cache with a stable revision so a fixture read is never repeated.
        mkdir: async () => {}, copyFile: async () => {}, chmod: async () => {},
        stat: async () => ({size: 1, mtimeMs: 0}),
      },
    }, {process: {pid: 1234, env: {POLYMUX_WECHAT_LLDB: "fixture-lldb",
      POLYMUX_WECHAT_STATUS_TIMEOUT_MS: "1000"}, getuid: () => 501}});
    native = namespace;
    try {
      const operation = mode === "service-cancel"
        ? native.sendNativeServiceText({recipient: "filehelper", text: "fixture", userId: "wxid_self"})
        : native.sendComposerMessage({kind: "text", recipient: "filehelper", text: "fixture"});
      await assert.rejects(operation, error => {
        assert.match(error.message, mode.endsWith("cancel") ? /fixture cancellation/ : /timed out/);
        if (mode === "service-cancel") assert.equal(error.deliveryUnconfirmed, true);
        return true;
      });
      assert.match(transcript, /fixture: SIGINT/);
      assert.match(transcript, /fixture: cleanup\nProcess 4242 detached/);
      assert.doesNotMatch(transcript, /unsafe SIGTERM/);
      assert.equal(files.size, 0);
    } finally {
      // This is only the exact Node fixture child, never an external process.
      if (fake && fake.exitCode == null && fake.signalCode == null) fake.kill("SIGKILL");
    }
    console.log(JSON.stringify({mode, cleanDetach: true}));
    return;
  }

  let submitted = false;
  let recalled = false;
  let restarted = false;
  let processReads = 0;
  let stateReads = 0;
  let verificationClock = 0;
  class FixtureDate extends Date { static now() { return Date.now() + verificationClock; } }
  const detachMode = mode.startsWith("detach-");
  const calls = [];
  let finish;
  const result = new Promise(resolve => {finish = resolve;});
  const stickerBytes = Buffer.from("fixture-sticker");
  const stickerHash = crypto.createHash("md5").update(stickerBytes).digest("hex");
  const request = mode === "sticker-unconfirmed" ? {kind: "media", mediaType: "sticker", chatId: "wxid_peer", path: "/fixture/sticker", emojiXml: `<emoji md5="${stickerHash}" />`}
    : mode === "recall" ? {kind: "recall", chatId: "wxid_peer", messageId: "123"}
    : {kind: "text", chatId: "wxid_peer", body: "hello"};
  const target = {server_id: "123", local_id: 8, real_sender_id: 7,
    sender_wxid: "wxid_self", create_time: Math.floor(Date.now() / 1000),
    message_kind: "text", message_content: "hello"};
  const wire = Object.fromEntries(Object.keys(realWire).map(name => [name,
    () => {throw new Error(`unexpected native operation: ${name}`);} ]));
  wire.buildMessageSource = realWire.buildMessageSource;
  wire.stickerMd5 = realWire.stickerMd5;
  wire.sendNativeSticker = async () => { submitted = true; return {messageId: "123"}; };
  wire.wechatPid = async () => 99;
  wire.residentComposerReady = async () => !detachMode;
  wire.prepareComposerModel = async () => {
    if (mode === "ready-resident") {
      assert.ok(calls.some(call => call[0] === "fixture-cli" && call[1] === "unfreeze"),
        "resident readiness must detach the independent daemon before preparation");
      return {prepared: true};
    }
    throw Object.assign(new Error("fixture readiness detach unconfirmed"), {nativeDetachUnconfirmed: true});
  };
  wire.sendComposerMessage = async () => {
    if (mode === "detach-unconfirmed")
      throw new AggregateError([new Error("fixture submission failed"),
        Object.assign(new Error("fixture clean detach unconfirmed"), {nativeDetachUnconfirmed: true})],
      "fixture native operation and cleanup failed");
    submitted = true;
    return {submitted: true};
  };
  wire.recallNativeMessage = async value => {
    assert.equal(value.clientMessageId, "8");
    assert.equal(value.fromWxid, "wxid_self");
    recalled = true;
  };
  const processFixture = new EventEmitter();
  processFixture.env = {POLYMUX_WECHAT_CLI: "fixture-cli", POLYMUX_WECHAT_WIRE_NATIVE: "1",
    POLYMUX_WECHAT_LLDB_EXPERIMENTAL: "1", POLYMUX_WECHAT_RELAY_MANAGED: detachMode ? "0" : "1"};
  processFixture.argv = ["node", "driver", mode.startsWith("ready-") ? "ready" : "write", "--json"];
  processFixture.stdin = Readable.from([Buffer.from(JSON.stringify(request))]);
  processFixture.stdout = {write(text) {finish(JSON.parse(text));}};
  processFixture.stderr = {write() {}};
  await fixtureModule("../polymux-wechat-driver.mjs", {
    "./wechat-wire.mjs": wire,
    "node:fs/promises": {...await import("node:fs/promises"), readFile: async file => {
      assert.equal(file, "/fixture/sticker");
      return stickerBytes;
    }},
    "./wechat-daemon-coordination.mjs": {...coordination,
      usesNativeTextTransport: () => coordination.usesNativeTextTransport(processFixture.env)},
    "node:child_process": {spawn(command, args) {
      calls.push([command, ...args]);
      if (command === "/bin/ps") {
        if (args.at(-1) === "stat=") {
          assert.deepEqual(Array.from(args), ["-p", "99", "-o", "stat="]);
          stateReads += 1;
          if (mode === "detach-state-unknown") return commandResult("", 1);
          if (mode === "detach-still-stopped" && stateReads > 1) return commandResult("T");
          return commandResult("S");
        }
        processReads += 1;
        if ((mode === "detach-retry" && processReads === 2) ||
            (mode === "detach-blocked" && processReads >= 2))
          return commandResult("", 1);
        return commandResult(restarted ? "42 1 /usr/bin/lldb -p 99 -s /tmp/wx-hijack-daemon-fixture/cmd.lldb\n" : "");
      }
      assert.equal(command, "fixture-cli");
      if (args[0] === "unfreeze") {
        assert.deepEqual(Array.from(args), ["unfreeze", "--pid", "99"]);
        return commandResult("detached");
      }
      if (args[0] === "accounts") return commandResult(JSON.stringify({accounts: [{wxid: "wxid_self"}]}));
      if (mode === "sticker-unconfirmed" && args[0] === "contacts") return commandResult("[]");
      if (args[0] === "daemon") {
        if (args[1] === "start") restarted = true;
        return commandResult(args[1] === "status" && (detachMode || mode === "ready-resident") ? "running pid=99" : "stopped");
      }
      assert.equal(args[0], "history");
      assert.equal(args[1], "wxid_peer", "File Transfer ids cannot calibrate another shard");
      if (recalled) return commandResult(JSON.stringify({rows: [{server_id: "123", message_kind: "recalled"}]}));
      assert.ok(args.at(-1).includes("sender_wxid"));
      if (["send-unconfirmed", "sticker-unconfirmed"].includes(mode) && submitted) {
        verificationClock += 5_000;
        return commandResult(JSON.stringify({rows: []}));
      }
      return commandResult(JSON.stringify({rows: mode === "recall" || submitted ? [target] : []}));
    }},
  }, {process: processFixture, Error, AggregateError, Date: FixtureDate});
  const response = await result;
  if (["send-unconfirmed", "sticker-unconfirmed"].includes(mode)) {
    assert.equal(submitted, true, JSON.stringify(response));
    assert.equal(response.deliveredVerified, false);
    assert.equal(response.deliveryUnconfirmed, true);
    assert.match(response.reason, mode === "sticker-unconfirmed" ? /sticker acknowledgement/ : /submission was not confirmed/);
    if (mode === "sticker-unconfirmed") assert.equal(response.messageId, "123");
    console.log(JSON.stringify({mode, recoverySafe: true}));
    return;
  }
  if (mode === "ready-resident") {
    assert.equal(response.ready, true);
    assert.equal(restarted, false, "managed recovery belongs to the bridge");
    console.log(JSON.stringify({mode, recoverySafe: true}));
    return;
  }
  if (mode === "ready-unconfirmed") {
    assert.equal(response.ready, false);
    assert.equal(response.relayRecoverySafe, false);
    console.log(JSON.stringify({mode, recoverySafe: true, response}));
    return;
  }
  if (detachMode) {
    assert.equal(response.deliveredVerified, false);
    assert.equal(submitted, false);
    assert.equal(restarted, mode === "detach-retry");
    if (["detach-unconfirmed", "detach-state-unknown", "detach-still-stopped"].includes(mode))
      assert.equal(response.relayRecoverySafe, false);
    console.log(JSON.stringify({mode, recoverySafe: true, response}));
    return;
  }
  assert.equal(response.deliveredVerified, true, JSON.stringify(response));
  assert.equal(response.messageId, "123");
  assert.equal(mode === "recall" ? recalled : submitted, true);
  console.log(JSON.stringify({mode, destinationShardVerified: true, calls: calls.length}));
}
