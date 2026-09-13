import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadTuiSettings, saveTuiSettings } from "../src/tui/settings.js";
import { polymuxHome } from "../src/paths.js";

test("Polymux settings layer project overrides over personal defaults and preserve unrelated fields", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-settings-"));
  const home = path.join(root, "personal");
  const cwd = path.join(root, "project");
  try {
    await mkdir(home);
    await mkdir(path.join(cwd, ".polymux"), { recursive: true });
    await writeFile(
      path.join(home, "settings.json"),
      JSON.stringify({ outputPad: 0, quietStartup: true, custom: "preserved" }),
    );
    await writeFile(
      path.join(home, "keybindings.json"),
      JSON.stringify({ "app.model.select": "ctrl+y" }),
    );
    await writeFile(
      path.join(cwd, ".polymux", "settings.json"),
      JSON.stringify({ outputPad: 1, quietStartup: false }),
    );
    const loaded = await loadTuiSettings(cwd, home);
    assert.equal(loaded.settings.outputPad, 1);
    assert.equal(loaded.settings.quietStartup, false);
    assert.deepEqual(loaded.keybindings.getKeys("app.model.select" as any), [
      "ctrl+y",
    ]);
    assert.deepEqual(loaded.keybindings.getKeys("tui.input.submit"), [
      "enter",
      "super+enter",
    ]);
    await saveTuiSettings({ expandTools: true }, loaded.globalFile);
    assert.equal(
      JSON.parse(await readFile(loaded.globalFile, "utf8")).custom,
      "preserved",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("default CLI home is .polymux with an explicit override", () => {
  const previous = process.env.POLYMUX_HOME;
  try {
    delete process.env.POLYMUX_HOME;
    assert.equal(polymuxHome(), path.join(homedir(), ".polymux"));
    process.env.POLYMUX_HOME = "/tmp/polymux-explicit";
    assert.equal(polymuxHome(), "/tmp/polymux-explicit");
  } finally {
    if (previous === undefined) delete process.env.POLYMUX_HOME;
    else process.env.POLYMUX_HOME = previous;
  }
});

test("Mermaid follows the personal final-only setting and falls back when it cannot fit", async () => {
  const { terminalMermaid } = await import("../src/tui/mermaid.js");
  const source = "```mermaid\nflowchart LR\nA[Start] --> B[Done]\n```\n";
  assert.equal(terminalMermaid(source, 90, true), source);
  assert.equal(terminalMermaid(source, 3, false), source);
  const diagram = terminalMermaid(source, 90, false);
  assert.match(diagram, /Start/);
  assert.match(diagram, /Done/);
  assert.doesNotMatch(diagram, /flowchart LR/);
});

test("external editor returns the edited prompt and removes the temporary file", async () => {
  const { editPrompt } = await import("../src/tui/external-editor.js");
  const root = await mkdtemp(path.join(tmpdir(), "polymux-editor-test-"));
  const script = path.join(root, "editor.mjs");
  const record = path.join(root, "path.txt");
  const old = process.env.VISUAL;
  try {
    await writeFile(
      script,
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(record)},process.argv[2]);writeFileSync(process.argv[2],'Edited prompt');`,
    );
    process.env.VISUAL = `"${process.execPath}" "${script}"`;
    assert.equal(await editPrompt("Original prompt"), "Edited prompt");
    const file = await readFile(record, "utf8");
    await assert.rejects(readFile(file), { code: "ENOENT" });
  } finally {
    if (old === undefined) delete process.env.VISUAL;
    else process.env.VISUAL = old;
    await rm(root, { recursive: true, force: true });
  }
});
