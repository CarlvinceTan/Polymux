import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {TerminalSessions} from "./sessions.js";

const sourcePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../resources/native/pty-host.c",
);

test("create allocates distinct ids and close drops only that session", () => {
  const sessions = new TerminalSessions({
    sourcePath: "/nonexistent/pty-host.c",
    cacheDirectory: path.join(tmpdir(), "polymux-pty-unused"),
    onEvent: () => {},
  });
  const first = sessions.create();
  const second = sessions.create("/tmp");
  assert.notEqual(first.id, second.id);
  assert.equal(sessions.size, 2);
  assert.ok(sessions.has(first.id));
  sessions.close(first.id);
  assert.equal(sessions.size, 1);
  assert.equal(sessions.has(first.id), false);
  assert.ok(sessions.has(second.id));
  sessions.close(first.id);
  assert.equal(sessions.size, 1);
  assert.throws(() => sessions.write(first.id, "x"), /Unknown terminal session/);
  sessions.closeAll();
  assert.equal(sessions.size, 0);
});

test("close of an unattached session emits exit once and further close is a no-op", () => {
  const events: Array<{type: string; id: string}> = [];
  const sessions = new TerminalSessions({
    sourcePath: "/nonexistent/pty-host.c",
    cacheDirectory: path.join(tmpdir(), "polymux-pty-unused"),
    onEvent: (event) => events.push(event),
  });
  const created = sessions.create();
  sessions.close(created.id);
  const exit = events.find((event) => event.type === "exit");
  assert.ok(exit);
  assert.equal(exit.id, created.id);
  assert.equal(sessions.has(created.id), false);
  sessions.close(created.id);
  assert.equal(events.filter((event) => event.type === "exit").length, 1);
  assert.equal(sessions.size, 0);
});

test(
  "a POSIX PTY host echoes a command through a mapped session",
  {skip: process.platform === "win32", timeout: 20_000},
  async () => {
    const cacheDirectory = await mkdtemp(path.join(tmpdir(), "polymux-pty-"));
    const previousShell = process.env.SHELL;
    process.env.SHELL = "/bin/sh";
    const chunks = new Map<string, Buffer[]>();
    const sessions = new TerminalSessions({
      sourcePath,
      cacheDirectory,
      onEvent: (event) => {
        if (event.type !== "data") return;
        const list = chunks.get(event.id) ?? [];
        list.push(Buffer.from(event.data, "base64"));
        chunks.set(event.id, list);
      },
    });
    try {
      const first = sessions.create();
      const second = sessions.create();
      const attached = await sessions.attach(first.id, 80, 24);
      assert.equal(attached.id, first.id);
      const attachedSecond = await sessions.attach(second.id, 80, 24);
      const tokenA = `polymux-pty-a-${Date.now().toString(36)}`;
      const tokenB = `polymux-pty-b-${Date.now().toString(36)}`;
      sessions.write(first.id, `printf '%s\\n' '${tokenA}'\n`);
      sessions.write(second.id, `printf '%s\\n' '${tokenB}'\n`);
      const outputA = await waitForOutput(() => chunks.get(first.id) ?? [], tokenA, 15_000);
      const outputB = await waitForOutput(() => chunks.get(second.id) ?? [], tokenB, 15_000);
      assert.match(outputA, new RegExp(tokenA));
      assert.match(outputB, new RegExp(tokenB));
      assert.doesNotMatch(outputA, new RegExp(tokenB));
      assert.doesNotMatch(outputB, new RegExp(tokenA));
      sessions.close(first.id);
      assert.throws(() => sessions.resize(first.id, 100, 30), /Unknown terminal session/);
      const replayed = await sessions.attach(second.id, 100, 30);
      assert.ok(replayed.seq >= attachedSecond.seq);
      assert.match(Buffer.from(replayed.replay, "base64").toString(), new RegExp(tokenB));
    } finally {
      sessions.closeAll();
      if (previousShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = previousShell;
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  },
);

test(
  "a shell exit drops only that session and further close is a no-op",
  {skip: process.platform === "win32", timeout: 20_000},
  async () => {
    const cacheDirectory = await mkdtemp(path.join(tmpdir(), "polymux-pty-"));
    const previousShell = process.env.SHELL;
    process.env.SHELL = "/bin/sh";
    const chunks = new Map<string, Buffer[]>();
    const exits: Array<{type: string; id: string}> = [];
    const sessions = new TerminalSessions({
      sourcePath,
      cacheDirectory,
      onEvent: (event) => {
        if (event.type === "exit") {
          exits.push(event);
          return;
        }
        if (event.type !== "data") return;
        const list = chunks.get(event.id) ?? [];
        list.push(Buffer.from(event.data, "base64"));
        chunks.set(event.id, list);
      },
    });
    try {
      const first = sessions.create();
      const second = sessions.create();
      await sessions.attach(first.id, 80, 24);
      await sessions.attach(second.id, 80, 24);
      sessions.write(first.id, "exit\n");
      const exit = await waitForExit(exits, first.id, 15_000);
      assert.equal(exit.id, first.id);
      assert.equal(sessions.has(first.id), false);
      assert.ok(sessions.has(second.id));
      assert.equal(sessions.size, 1);
      sessions.close(first.id);
      assert.equal(sessions.size, 1);
      assert.equal(exits.filter((event) => event.id === first.id).length, 1);
      assert.throws(() => sessions.write(first.id, "x"), /Unknown terminal session/);
      const token = `polymux-pty-kept-${Date.now().toString(36)}`;
      sessions.write(second.id, `printf '%s\\n' '${token}'\n`);
      const output = await waitForOutput(() => chunks.get(second.id) ?? [], token, 15_000);
      assert.match(output, new RegExp(token));
      assert.equal(exits.filter((event) => event.id === second.id).length, 0);
    } finally {
      sessions.closeAll();
      if (previousShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = previousShell;
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  },
);

async function waitForExit(
  events: Array<{type: string; id: string}>,
  id: string,
  timeoutMs: number,
): Promise<{type: string; id: string}> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = events.find((event) => event.type === "exit" && event.id === id);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for exit of ${id}`);
}

async function waitForOutput(
  chunks: () => Buffer[],
  token: string,
  timeoutMs: number,
): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const output = Buffer.concat(chunks()).toString();
    if (output.includes(token)) return output;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${token}: ${Buffer.concat(chunks()).toString()}`);
}
