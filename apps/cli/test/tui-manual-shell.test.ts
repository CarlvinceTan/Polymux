import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ManualShell, shellInput } from "../src/tui/manual-shell.js";

test("shell prefix requires whitespace and preserves ordinary exclamations", () => {
  for (const text of ["!hello", "!!hello", "!!! pwd", "!", "hello!"])
    assert.equal(shellInput(text), undefined);
  assert.deepEqual(shellInput(" ! pwd"), { command: "pwd", excluded: false });
  assert.deepEqual(shellInput("!!\tpwd"), { command: "pwd", excluded: true });
});
test(
  "shell keeps and restores its own directory, exit status, and cancellation",
  { timeout: 10000 },
  async () => {
    const root = await realpath(
      await mkdtemp(tmpdir() + "/polymux-shell-test-"),
    );
    const original = process.cwd();
    await mkdir(root + "/a 'quoted' directory");
    const shell = new ManualShell(root, root, "chat");
    const run = async (command: string) => {
      let output = "";
      const result = await shell.run(command, (chunk) => (output += chunk));
      return { ...result, output };
    };
    try {
      assert.equal((await run(`cd "a 'quoted' directory"`)).exitCode, 0);
      assert.equal(
        (await run("pwd")).output.trim(),
        root + "/a 'quoted' directory",
      );
      assert.notEqual(
        (await run("cd /definitely-not-a-directory")).exitCode,
        0,
      );
      assert.equal(shell.cwd, root + "/a 'quoted' directory");
      await run("cd -");
      assert.equal(shell.cwd, root);
      assert.equal(
        (await run(`cd "a 'quoted' directory"; exit 7`)).exitCode,
        7,
      );
      const restored = new ManualShell(root, root, "chat");
      await restored.restore();
      assert.equal(restored.cwd, shell.cwd);
      assert.equal(process.cwd(), original);
      const pending = run("sleep 30");
      setTimeout(() => shell.cancel(), 50);
      assert.equal((await pending).cancelled, true);
      assert.equal(shell.running, false);
      assert.equal((await run("printf recovered")).output, "recovered");
    } finally {
      shell.cancel();
      await rm(root, { recursive: true, force: true });
    }
  },
);
