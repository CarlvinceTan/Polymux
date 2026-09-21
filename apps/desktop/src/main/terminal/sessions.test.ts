import assert from "node:assert/strict";
import test from "node:test";
import {execFileSync} from "node:child_process";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
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

test(
  "close settles a shell that ignores SIGHUP and releases its host",
  {skip: process.platform === "win32", timeout: 20_000},
  async () => {
    const cacheDirectory = await mkdtemp(path.join(tmpdir(), "polymux-pty-"));
    const shellPath = path.join(cacheDirectory, "stubborn-shell.sh");
    await writeFile(
      shellPath,
      '#!/bin/sh\ntrap "" HUP INT TERM\nwhile true; do sleep 1; done\n',
      {mode: 0o755},
    );
    const previousShell = process.env.SHELL;
    process.env.SHELL = shellPath;
    const chunks: Buffer[] = [];
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
        chunks.push(Buffer.from(event.data, "base64"));
      },
    });
    try {
      const created = sessions.create();
      await sessions.attach(created.id, 80, 24);
      // Answering proves the host is up and handling signals, so closing below
      // tests the teardown rather than racing its startup.
      sessions.write(created.id, "printf 'polymux-pty-ready\\n'\n");
      await waitForOutput(() => chunks, "polymux-pty-ready", 15_000);
      sessions.close(created.id);
      // SIGHUP alone cannot settle this shell. A close that leaves the helper
      // running, or that never reports the helper's exit because the shell still
      // holds its control pipe, times out here — and the unreported exit leaves
      // the whole test runner waiting on a host that outlives it.
      await waitForExit(exits, created.id, 15_000);
      assert.equal(sessions.has(created.id), false);
    } finally {
      sessions.closeAll();
      // This shell refuses every signal the session can send, so it outlives a
      // killed helper and has to be reaped here rather than by the teardown.
      try {
        execFileSync("pkill", ["-9", "-f", shellPath], {stdio: "ignore"});
      } catch {
        // Nothing left to reap.
      }
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
