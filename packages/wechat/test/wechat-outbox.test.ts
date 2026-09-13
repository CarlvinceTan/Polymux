import assert from "node:assert/strict";
import {fork} from "node:child_process";
import {once} from "node:events";
import {mkdtemp, rm, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {WeChatOutbox} from "../src/wechat-outbox.js";

test("a killed process leaves a durable send fence without replaying it", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wechat-outbox-crash-"));
  const child = fork(new URL("./fixtures/outbox-crash.ts", import.meta.url), [directory],
    {execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "pipe", "ipc"]});
  let diagnostics = "";
  child.stderr?.on("data", chunk => {diagnostics += chunk;});
  try {
    const ready = await Promise.race([
      once(child, "message").then(([value]) => value),
      once(child, "exit").then(() => {throw new Error(`Fixture exited before committing: ${diagnostics}`);}),
    ]);
    assert.equal(ready, "committed");
    const exited = once(child, "exit");
    child.kill("SIGKILL");
    await exited;
    const outbox = new WeChatOutbox(directory);
    try {
      assert.equal(outbox.claim("$interrupted", "@fixture:local", "filehelper")?.status, "pending");
      const [entry] = outbox.recover("@fixture:local");
      assert.equal(entry.status, "unconfirmed");
      assert.equal(entry.body, "crash fixture");
      assert.deepEqual(entry.previousIds, ["old-id"]);
      assert.equal(outbox.claim("$interrupted", "@fixture:local", "filehelper")?.status, "unconfirmed");
      assert.throws(() => outbox.claim("$interrupted", "@fixture:local", "wxid_other"), /different destination/);
      assert.equal((await stat(path.join(directory, "outbox.sqlite"))).mode & 0o777, 0o600);
    } finally {outbox.close();}
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(directory, {recursive: true, force: true});
  }
});

test("verified receipts survive restart and a delayed failure cannot erase them", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wechat-outbox-receipt-"));
  try {
    const first = new WeChatOutbox(directory);
    first.claim("$confirmed", "@fixture:local", "filehelper");
    first.textCandidate("$confirmed", "private fixture", 123, []);
    first.acknowledge("$confirmed", "7890123456789012345", "native-client");
    first.finish("$confirmed", "unconfirmed", "delayed error");
    first.claim("$other-owner", "@other:local", "filehelper");
    first.close();
    const second = new WeChatOutbox(directory);
    try {
      const [entry] = second.recover("@fixture:local");
      assert.equal(entry.status, "confirmed");
      assert.equal(entry.messageId, "7890123456789012345");
      assert.equal(entry.clientMessageId, "native-client");
      assert.equal(entry.body, null);
      assert.equal(entry.previousIds, null);
      assert.equal(entry.error, null);
      assert.equal(second.get("$other-owner")?.status, "pending");
    } finally {second.close();}
  } finally {await rm(directory, {recursive: true, force: true});}
});

test("an unreadable outbox is rejected instead of silently resetting send fences", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "wechat-outbox-corrupt-"));
  try {
    await writeFile(path.join(directory, "outbox.sqlite"), "not a database");
    assert.throws(() => new WeChatOutbox(directory), /not a database/);
  } finally {await rm(directory, {recursive: true, force: true});}
});
