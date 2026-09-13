import assert from "node:assert/strict";
import {mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";
import {ProcessWeChatWriter} from "../src/wechat-writer.js";
import {isWeChatDeliveryUnconfirmed, WeChatDeliveryUnconfirmedError} from "../src/wechat-delivery.js";

async function helper(response: object): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-writer-test-"));
  const executable = path.join(directory, "driver");
  await writeFile(
    executable,
    `#!/bin/sh\ncat >/dev/null\nprintf '%s\\n' '${JSON.stringify(response)}'\n`,
    {mode: 0o700},
  );
  return executable;
}

async function processFixture(context: TestContext, source: string, options: {
  timeoutMs?: number; cleanupGraceMs?: number; environment?: NodeJS.ProcessEnv;
} = {}): Promise<ProcessWeChatWriter> {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-writer-process-"));
  const script = path.join(directory, "fixture.mjs");
  await writeFile(script, source);
  context.after(() => rm(directory, {recursive: true, force: true}));
  return new ProcessWeChatWriter(process.execPath, {prefixArgs: [script], ...options});
}

async function rejectsWithUnknownCleanup(operation: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, pattern);
    assert.equal((error as Error & {relayRecoverySafe?: boolean}).relayRecoverySafe, false);
    return true;
  });
}

test("preserves a driver's verified server and client message ids", async () => {
  const writer = new ProcessWeChatWriter(
    await helper({
      deliveredVerified: true,
      messageId: "remote-42",
      clientMessageId: "local-42",
    }),
  );
  assert.deepEqual(
    await writer.write({kind: "text", chatId: "filehelper", body: "test"}),
    {
      deliveredVerified: true,
      messageId: "remote-42",
      clientMessageId: "local-42",
    },
  );
});

test("probes the driver's automatic transport without writing a request", async () => {
  assert.equal(
    await new ProcessWeChatWriter(await helper({ready: true})).ready(),
    true,
  );
  assert.equal(
    await new ProcessWeChatWriter(await helper({ready: false})).ready(),
    false,
  );
});

test("reads the driver's current native sticker catalog", async () => {
  const sticker = {
    id: "0123456789abcdef0123456789abcdef",
    xml: '<emoji md5="0123456789abcdef0123456789abcdef"></emoji>',
  };
  assert.deepEqual(
    await new ProcessWeChatWriter(
      await helper({stickers: [sticker]}),
    ).stickers(),
    [sticker],
  );
});

test("native group settings preserve the shared name and reject another group's response", async () => {
  const group = {chatId: "123456@chatroom", name: "学习小组 🐷", isMember: true};
  assert.deepEqual(await new ProcessWeChatWriter(await helper({group})).groupInfo(group.chatId), group);
  for (const invalid of [{...group, chatId: "999@chatroom"}, {...group, name: 1}, {...group, isMember: 1}, null])
    await assert.rejects(new ProcessWeChatWriter(await helper({group: invalid})).groupInfo(group.chatId), /invalid group settings/);
});

test("read-only native media responses retain exact bytes and reject invalid payloads", async () => {
  const request = {kind: "audio" as const, chatId: "filehelper", serverId: "9072123356052134871", localId: "223", timestamp: 1788662525};
  const bytes = Buffer.from("RIFFtest-wave");
  const media = {name: "voice.wav", mimeType: "audio/wav", size: bytes.length, bodyBase64: bytes.toString("base64"), durationMs: 1800};
  assert.deepEqual(await new ProcessWeChatWriter(await helper({media})).readMedia(request), media);
  assert.equal(await new ProcessWeChatWriter(await helper({media: null})).readMedia(request), null);
  for (const invalid of [{...media, size: bytes.length + 1}, {...media, durationMs: -1},
    {...media, bodyBase64: "not base64"}, {...media, localPath: "/tmp/ambiguous"},
    {...media, mimeType: "text/plain"}, {name: "file", mimeType: "text/plain", size: 4, localPath: "/tmp/unverified"}])
    await assert.rejects(new ProcessWeChatWriter(await helper({media: invalid})).readMedia(request), /[Ii]nvalid native WeChat/);
});

test("reads and validates the native manual unread flag independently of message count", async () => {
  const row = {chatId: "filehelper", unreadCount: 0, markedUnread: true};
  assert.deepEqual(await new ProcessWeChatWriter(await helper({sessions: [row]})).readStates(), [row]);
  for (const sessions of [null, [row, row], [{...row, markedUnread: 1}],
    [{...row, unreadCount: -1}], [{...row, unreadCount: "0"}], [{...row, chatId: ""}]]) {
    await assert.rejects(new ProcessWeChatWriter(await helper({sessions})).readStates(), /unread state/);
  }
});

test("read-only helper refusals preserve the reason without accepting malformed payloads", async () => {
  const request = {kind: "audio" as const, chatId: "filehelper", serverId: "9072123356052134871", localId: "223", timestamp: 1788662525};
  for (const reason of ["Invalid native media identity", "WeChat account keys are unavailable"]) {
    const writer = new ProcessWeChatWriter(await helper({deliveredVerified: false, reason}));
    await assert.rejects(writer.readMedia(request), {message: reason});
    await assert.rejects(writer.readMentions(request), {message: reason});
  }
  for (const reason of [null, 42, "", " "]) {
    const writer = new ProcessWeChatWriter(await helper({reason}));
    await assert.rejects(writer.readMedia(request), /Invalid native WeChat media response/);
    await assert.rejects(writer.readMentions(request), /Invalid native WeChat mention response/);
  }
});

test("native mention reads preserve unavailable versus empty metadata and reject malformed targets", async () => {
  const request = {chatId: "123456@chatroom", serverId: "1167859275151065185", localId: "50", timestamp: 1788665978};
  for (const mentionedIds of [null, [], ["wxid_me"]])
    assert.deepEqual(await new ProcessWeChatWriter(await helper({mentionedIds})).readMentions(request), mentionedIds);
  for (const mentionedIds of [undefined, "wxid_me", [42], ["../invalid"], ["wxid_me\n"]])
    await assert.rejects(new ProcessWeChatWriter(await helper({mentionedIds})).readMentions(request), /mention response/);
});

test("preserves an operational refusal instead of claiming a process crash", async () => {
  const writer = new ProcessWeChatWriter(
    await helper({deliveredVerified: false, reason: "native reply is unavailable"}),
  );
  assert.deepEqual(
    await writer.write({kind: "read", chatId: "filehelper"}),
    {deliveredVerified: false, reason: "native reply is unavailable"},
  );
});

test("preserves a driver's explicit hold on relay recovery", async () => {
  const response = {deliveredVerified: false, reason: "native detach is unconfirmed", relayRecoverySafe: false};
  const writer = new ProcessWeChatWriter(await helper(response));
  assert.deepEqual(await writer.write({kind: "text", chatId: "filehelper", body: "test"}), response);
});

test("readiness exposes a driver's explicit hold on relay recovery", async () => {
  const writer = new ProcessWeChatWriter(await helper({ready: false,
    reason: "native detach is unconfirmed", relayRecoverySafe: false}));
  assert.equal(await writer.ready(), false);
  assert.equal(writer.readinessRecoverySafe(), false);
  const healthy = new ProcessWeChatWriter(await helper({ready: true}));
  assert.equal(await healthy.ready(), true);
  assert.equal(healthy.readinessRecoverySafe(), true);
});

test("abnormal spawned readiness exits hold relay recovery", async context => {
  const writer = await processFixture(context,
    `process.stdout.write(JSON.stringify({ready:true,relayRecoverySafe:true})); process.stderr.write('fixture crash'); process.exitCode=7;`);
  assert.equal(await writer.ready(), false);
  assert.equal(writer.readinessRecoverySafe(), false);
  assert.match(writer.readinessFailure() ?? "", /fixture crash/);
});

test("malformed readiness responses cannot certify detach cleanup", async context => {
  for (const response of ["not-json", "null", "{}", "[]", '{"ready":"true"}',
    '{"ready":true,"reason":{}}', '{"ready":true,"relayRecoverySafe":"false"}']) {
    const writer = await processFixture(context, `process.stdout.write(${JSON.stringify(response)});`);
    assert.equal(await writer.ready(), false);
    assert.equal(writer.readinessRecoverySafe(), false, response);
    assert.match(writer.readinessFailure() ?? "", /invalid response/);
  }
});

test("abnormal spawned write exits preserve unknown cleanup on rejection", async context => {
  const writer = await processFixture(context, `
process.stdin.resume();
process.stdin.on('end',()=>{
  process.stdout.write(JSON.stringify({deliveredVerified:true,relayRecoverySafe:true}));
  process.stderr.write('fixture write crash'); process.exitCode=7;
});`);
  await rejectsWithUnknownCleanup(writer.write({kind:"read",chatId:"filehelper"}), /fixture write crash/);
});

test("malformed write responses reject with relay recovery held", async context => {
  for (const response of ["not-json", "null", "{}", "[]", '{"deliveredVerified":"true"}',
    '{"deliveredVerified":true,"messageId":42}', '{"deliveredVerified":true,"delivered_verified":false}',
    '{"deliveredVerified":true,"relayRecoverySafe":"false"}']) {
    const writer = await processFixture(context, `
process.stdin.resume();
process.stdin.on('end',()=>process.stdout.write(${JSON.stringify(response)}));`);
    await rejectsWithUnknownCleanup(writer.write({kind:"read",chatId:"filehelper"}), /invalid JSON/);
  }
});

test("a failed spawn does not claim a native process attached", async context => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-writer-missing-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const writer = new ProcessWeChatWriter(path.join(directory, "does-not-exist"));
  assert.equal(await writer.ready(), false);
  assert.equal(writer.readinessRecoverySafe(), true);
  await assert.rejects(writer.write({kind:"read",chatId:"filehelper"}), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /ENOENT/);
    assert.equal((error as Error & {relayRecoverySafe?: boolean}).relayRecoverySafe, undefined);
    return true;
  });
});

test("stdin failure terminates the spawned driver and rejects without an unhandled error", async context => {
  const writer = await processFixture(context, `
import {closeSync} from 'node:fs';
closeSync(0);
process.stdout.write(JSON.stringify({deliveredVerified:true}));
setInterval(()=>{},1000);`, {timeoutMs: 3_000, cleanupGraceMs: 50});
  await rejectsWithUnknownCleanup(writer.write({kind:"text",chatId:"filehelper",body:"x".repeat(2 * 1024 * 1024)}),
    /EPIPE|ECONNRESET|write/);
});

test("forced timeout exits keep readiness and writes unsafe", async context => {
  const writer = await processFixture(context, `
process.on('SIGTERM',()=>{});
process.stdin.resume();
setInterval(()=>{},1000);`, {timeoutMs: 1_000, cleanupGraceMs: 50});
  await rejectsWithUnknownCleanup(writer.write({kind:"read",chatId:"filehelper"}), /timed out/);
  assert.equal(await writer.ready(), false);
  assert.equal(writer.readinessRecoverySafe(), false);
  assert.match(writer.readinessFailure() ?? "", /timed out/);
});

test("captured native targets are copied into each helper environment and clear stale pins", async context => {
  const environment = {...process.env, POLYMUX_WECHAT_TARGET_PID:"123", POLYMUX_WECHAT_TARGET_IDENTITY:"configured", POLYMUX_WECHAT_RELAY_MANAGED:"0"};
  const writer = await processFixture(context, `
const pin = [process.env.POLYMUX_WECHAT_TARGET_PID ?? '',process.env.POLYMUX_WECHAT_TARGET_IDENTITY ?? '',process.env.POLYMUX_WECHAT_RELAY_MANAGED ?? ''].join('|');
if (process.argv[2] === 'ready') process.stdout.write(JSON.stringify({ready:false,reason:pin}));
else {process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({deliveredVerified:true,messageId:pin})));}
`, {environment});
  assert.equal((await writer.write({kind:"read",chatId:"filehelper"})).messageId, "123|configured|0");
  const target = {pid:456,identity:"captured-process-birth"};
  writer.setNativeTarget(target);
  target.pid = 789;
  assert.equal((await writer.write({kind:"read",chatId:"filehelper"})).messageId, "456|captured-process-birth|1");
  assert.equal(await writer.ready(), false);
  assert.equal(writer.readinessFailure(), "456|captured-process-birth|1");
  writer.setNativeTarget(null);
  assert.equal((await writer.write({kind:"read",chatId:"filehelper"})).messageId, "||0");
  assert.equal(environment.POLYMUX_WECHAT_TARGET_PID, "123");
  assert.equal(environment.POLYMUX_WECHAT_TARGET_IDENTITY, "configured");
  assert.equal(environment.POLYMUX_WECHAT_RELAY_MANAGED, "0");
});

test("runs a bundled script through its interpreter and private environment", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-writer-runtime-"));
  const executable = path.join(directory, "runtime");
  await writeFile(
    executable,
    `#!/bin/sh
test "$1" = "/bundled/writer.mjs" || exit 3
test "$2" = "write" || exit 4
test "$POLYMUX_WECHAT_WIRE_NATIVE" = "1" || exit 5
cat >/dev/null
printf '%s\n' '{"deliveredVerified":true}'
`,
    {mode: 0o700},
  );
  const writer = new ProcessWeChatWriter(executable, {
    prefixArgs: ["/bundled/writer.mjs"],
    environment: {...process.env, POLYMUX_WECHAT_WIRE_NATIVE: "1"},
  });
  assert.deepEqual(
    await writer.write({kind: "read", chatId: "filehelper"}),
    {deliveredVerified: true},
  );
});

test("gives a timed-out driver a cleanup window before forcing it closed", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-writer-cleanup-"));
  const executable = path.join(directory, "driver");
  const marker = path.join(directory, "cleaned");
  await writeFile(
    executable,
    `#!/bin/sh
trap 'printf cleaned > "$POLYMUX_CLEANUP_MARKER"; exit 0' TERM
cat >/dev/null
while :; do sleep 0.05; done
`,
    {mode: 0o700},
  );
  const writer = new ProcessWeChatWriter(executable, {
    environment: {...process.env, POLYMUX_CLEANUP_MARKER: marker},
    // The full Hub suite runs many child-process tests in parallel. Leave
    // enough time for this helper to be scheduled and install its TERM trap;
    // the behaviour under test is the cleanup window after timeout, not a
    // sub-second process-start benchmark.
    timeoutMs: 3_000,
  });
  await rejectsWithUnknownCleanup(
    writer.write({kind: "read", chatId: "filehelper"}),
    /timed out after 3000ms/,
  );
  assert.equal(await readFile(marker, "utf8"), "cleaned");
  await writeFile(marker, "pending");
  assert.equal(await writer.ready(), false);
  assert.equal(await readFile(marker, "utf8"), "cleaned", "readiness waits for detach cleanup too");
  assert.match(writer.readinessFailure() ?? "", /timed out/);
  assert.equal(writer.readinessRecoverySafe(), false, "a timeout has no confirmed detach response");
});


test("read-only build checks reject unsupported and malformed results", async () => {
  for (const result of [{supported:false,reason:"This WeChat version needs a Polymux update."}, {}, {supported:"true"}]) {
    const writer = new ProcessWeChatWriter(await helper(result), {checkCompatibility:true});
    assert.equal(await writer.compatible(), false);
    assert.match(writer.readinessFailure()!, /Polymux update/);
  }
  const writer = new ProcessWeChatWriter(await helper({supported:true}), {checkCompatibility:true});
  assert.equal(await writer.compatible(), true);
});

test("preserves unconfirmed native delivery without claiming success", async () => {
  const response = {deliveredVerified: false, deliveryUnconfirmed: true,
    reason: "Native submission has no acknowledgement"};
  const writer = new ProcessWeChatWriter(await helper(response));
  assert.deepEqual(await writer.write({kind: "text", chatId: "filehelper", body: "one attempt"}), response);
});

test("lost send responses remain unconfirmed and retain the native cleanup hold", async context => {
  for (const source of [
    "process.stdin.resume();process.stdin.on('end',()=>process.exit(7));",
    "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('not-json'));",
    "process.stdin.resume();setInterval(()=>{},1000);",
  ]) {
    const writer = await processFixture(context, source, {timeoutMs: 1000, cleanupGraceMs: 50});
    for (const request of [
      {kind: "text" as const, chatId: "filehelper", body: "one attempt"},
      {kind: "media" as const, chatId: "filehelper", mediaType: "image" as const, path: "/fixture.png", name: "fixture.png"},
    ]) {
      await assert.rejects(writer.write(request), error => {
        assert.ok(isWeChatDeliveryUnconfirmed(error));
        assert.equal((error as Error & {relayRecoverySafe?: boolean}).relayRecoverySafe, false);
        return true;
      });
    }
  }
});

test("a send that cannot spawn is a definite rejection", async context => {
  const directory = await mkdtemp(path.join(tmpdir(), "polymux-send-missing-"));
  context.after(() => rm(directory, {recursive: true, force: true}));
  const writer = new ProcessWeChatWriter(path.join(directory, "missing"));
  await assert.rejects(writer.write({kind: "text", chatId: "filehelper", body: "not submitted"}), error => {
    assert.equal(isWeChatDeliveryUnconfirmed(error), false);
    assert.match((error as Error).message, /ENOENT/);
    return true;
  });
});

test("combined delivery and recovery failures preserve uncertain delivery", () => {
  assert.equal(isWeChatDeliveryUnconfirmed(new AggregateError([
    new WeChatDeliveryUnconfirmedError(), new Error("cleanup failed"),
  ])), true);
  assert.equal(isWeChatDeliveryUnconfirmed(new AggregateError([new Error("not submitted")])), false);
});
