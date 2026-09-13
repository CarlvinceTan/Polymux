import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {TerminalSession} from "./session.js";

const sourcePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../resources/native/pty-host.c",
);

test(
  "a POSIX PTY host echoes a command through a terminal session",
  {skip: process.platform === "win32", timeout: 20_000},
  async () => {
    const cacheDirectory = await mkdtemp(path.join(tmpdir(), "polymux-pty-"));
    const previousShell = process.env.SHELL;
    process.env.SHELL = "/bin/sh";
    const chunks: Buffer[] = [];
    const session = new TerminalSession({
      id: "test-terminal",
      sourcePath,
      cacheDirectory,
      onEvent: (event) => {
        if (event.type === "data") chunks.push(Buffer.from(event.data, "base64"));
      },
    });
    try {
      const attached = await session.attach(80, 24);
      assert.equal(attached.id, "test-terminal");
      const token = `polymux-pty-${Date.now().toString(36)}`;
      session.write(`printf '%s\\n' '${token}'\n`);
      const output = await waitForOutput(chunks, token, 15_000);
      assert.match(output, new RegExp(token));
      session.resize(100, 30);
      const replayed = await session.attach(100, 30);
      assert.ok(replayed.seq >= attached.seq);
      assert.match(Buffer.from(replayed.replay, "base64").toString(), new RegExp(token));
    } finally {
      session.close();
      if (previousShell === undefined) delete process.env.SHELL;
      else process.env.SHELL = previousShell;
      await rm(cacheDirectory, {recursive: true, force: true});
    }
  },
);

test(
  "a POSIX PTY session emits exit when the shell ends",
  {skip: process.platform === "win32", timeout: 20_000},
  async () => {
    const cacheDirectory = await mkdtemp(path.join(tmpdir(), "polymux-pty-"));
    const previousShell = process.env.SHELL;
    process.env.SHELL = "/bin/sh";
    const events: Array<{type: string; id: string; code?: number | null}> = [];
    const session = new TerminalSession({
      id: "test-terminal-exit",
      sourcePath,
      cacheDirectory,
      onEvent: (event) => events.push(event),
    });
    try {
      await session.attach(80, 24);
      session.write("exit\n");
      const exit = await waitForExit(events, "test-terminal-exit", 15_000);
      assert.equal(exit.id, "test-terminal-exit");
      assert.equal(typeof exit.seq, "number");
      session.close();
      session.close();
      assert.equal(events.filter((event) => event.type === "exit").length, 1);
    } finally {
      session.close();
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
): Promise<{type: "exit"; id: string; seq: number; code: number | null}> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = events.find((event) => event.type === "exit" && event.id === id);
    if (found && found.type === "exit") return found as {type: "exit"; id: string; seq: number; code: number | null};
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for exit of ${id}`);
}

async function waitForOutput(chunks: Buffer[], token: string, timeoutMs: number): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const output = Buffer.concat(chunks).toString();
    if (output.includes(token)) return output;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${token}: ${Buffer.concat(chunks).toString()}`);
}
