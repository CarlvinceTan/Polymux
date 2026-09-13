import assert from "node:assert/strict";
import {mkdir, mkdtemp, rm, symlink, truncate, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import test from "node:test";
import {languageForName} from "./language.js";
import {insideRoot, resolveInside} from "./paths.js";
import {IdeService} from "./service.js";

test("language labels follow the extension the status bar shows", () => {
  assert.equal(languageForName("notes.md"), "Markdown");
  assert.equal(languageForName("config.json"), "JSON");
  assert.equal(languageForName("main.go"), "Go");
  assert.equal(languageForName("App.svelte"), "Svelte");
  assert.equal(languageForName("Makefile"), "Makefile");
  assert.equal(languageForName("plain"), "Text");
  assert.equal(languageForName("setup.sh"), "Shell Script");
  assert.equal(languageForName("icon.png"), "Binary");
});

test("dotenv files are Shell Script, including env variants", () => {
  assert.equal(languageForName(".env"), "Shell Script");
  assert.equal(languageForName(".env.local"), "Shell Script");
  assert.equal(languageForName(".ENV.LOCAL"), "Shell Script");
  assert.equal(languageForName(".env.example"), "Shell Script");
  assert.equal(languageForName(".env.production"), "Shell Script");
  assert.equal(languageForName("src/.env.development"), "Shell Script");
  assert.equal(languageForName("secrets.env"), "Shell Script");
  assert.notEqual(languageForName(".env.local"), "LOCAL");
  assert.notEqual(languageForName(".env.example"), "EXAMPLE");
  assert.notEqual(languageForName(".env"), "ENV");
  assert.notEqual(languageForName(".env"), "Text");
  assert.notEqual(languageForName(".env"), "Properties");
});

test("resolveInside refuses a path that would leave the project", () => {
  const root = path.join("/tmp", "project");
  assert.equal(resolveInside(root, "src/main.go"), path.resolve(root, "src/main.go"));
  assert.throws(() => resolveInside(root, "../secret"), /outside/);
  assert.ok(insideRoot(root, path.join(root, "a")));
  assert.equal(insideRoot(root, path.join(root, "..", "other")), false);
});

test("list sorts folders ahead of files and skips a vanished name", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-ide-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "README.md"), "# Hello\n");
  await writeFile(path.join(root, ".DS_Store"), "");
  const service = new IdeService();
  const entries = await service.list(root);
  assert.deepEqual(entries.map((entry) => entry.name), ["src", "README.md"]);
  assert.equal(entries[0]?.kind, "folder");
  assert.equal(entries[1]?.kind, "file");
});

test("read returns text, language, and refuses a symlink out of the project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-ide-"));
  const outside = await mkdtemp(path.join(tmpdir(), "polymux-ide-out-"));
  await writeFile(path.join(root, "notes.md"), "# Title\n");
  await writeFile(path.join(outside, "secret.txt"), "nope");
  await symlink(path.join(outside, "secret.txt"), path.join(root, "link.txt"));
  const service = new IdeService();
  const file = await service.read(root, "notes.md");
  assert.equal(file.language, "Markdown");
  assert.equal(file.binary, false);
  assert.equal(file.content, "# Title\n");
  await assert.rejects(() => service.read(root, "link.txt"), /outside/);
});

test("large source and text files retain their language and full contents", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-ide-large-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const service = new IdeService();
  const content = `/* ${"large text\n".repeat(220_000)} */\n`;
  for (const [name, language] of [
    ["bundle.mjs", "JavaScript"], ["bundle.cjs", "JavaScript"],
    ["module.mts", "TypeScript"], ["module.cts", "TypeScript"],
    ["index.d.mts", "TypeScript"], ["index.d.cts", "TypeScript"],
    ["component.jsx", "JavaScript"], ["component.tsx", "TypeScript"],
    ["config.json", "JSON"], ["README.md", "Markdown"], ["data.txt", "Text"],
  ]) {
    await writeFile(path.join(root, name), content);
    const file = await service.read(root, name);
    assert.equal(file.binary, false, name);
    assert.equal(file.language, language, name);
    assert.equal(file.content, content, name);
  }
});

test("files beyond the editor size limit report size, not a binary classification", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-ide-limit-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const file = path.join(root, "huge.mjs");
  await writeFile(file, "export {};\n");
  await truncate(file, 64 * 1024 * 1024 + 1);
  await assert.rejects(() => new IdeService().read(root, "huge.mjs"), /too large.*64 MiB/i);
});

test("JavaScript and TypeScript names do not make real binary contents editable", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-ide-binary-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  for (const name of ["binary.mjs", "binary.cjs", "binary.mts", "binary.cts", "lib.wasm", "file.unknown-extension"]) {
    await writeFile(path.join(root, name), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0]));
    const file = await new IdeService().read(root, name);
    assert.equal(file.binary, true, name);
    assert.equal(file.content, null, name);
  }
});

test("write updates a file inside the project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-ide-"));
  await writeFile(path.join(root, "a.txt"), "old");
  const service = new IdeService();
  await service.write(root, "a.txt", "new");
  const file = await service.read(root, "a.txt");
  assert.equal(file.content, "new");
});

test("the reader recognises extensionless scripts and preserves unknown text", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-ide-catalog-"));
  t.after(() => rm(root, {recursive: true, force: true}));
  const service = new IdeService();
  for (const [name, content, language] of [
    ["script", "#!/usr/bin/env python3\nprint('hello')\n", "Python"],
    ["source.ex", "defmodule Hello do\nend\n", "Elixir"],
    ["future.unknown-extension", "New formats can still be edited.\n", "Text"],
  ]) {
    await writeFile(path.join(root, name), content);
    const file = await service.read(root, name);
    assert.equal(file.binary, false, name);
    assert.equal(file.language, language, name);
    assert.equal(file.content, content, name);
  }
});

test("create writes a new file and refuses a name that is already there", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-ide-"));
  const service = new IdeService();
  const created = await service.create(root, "untitled", "");
  assert.equal(created.name, "untitled");
  assert.equal(created.content, "");
  await assert.rejects(() => service.create(root, "untitled", "nope"), /Already exists/);
});

test("create and move classify dotenv files as Shell Script", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-ide-"));
  const service = new IdeService();
  const created = await service.create(root, ".env", "FOO=1\n");
  assert.equal(created.language, "Shell Script");
  const moved = await service.move(root, ".env", ".env.example");
  assert.equal(moved.name, ".env.example");
  assert.equal(moved.language, "Shell Script");
  const read = await service.read(root, ".env.example");
  assert.equal(read.language, "Shell Script");
});

test("read classifies images as Binary and does not open them as text", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-ide-"));
  await writeFile(path.join(root, "icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
  const service = new IdeService();
  const file = await service.read(root, "icon.png");
  assert.equal(file.language, "Binary");
  assert.equal(file.binary, true);
  assert.equal(file.content, null);
});

test("read treats NUL bytes as Binary even when the name looks like text", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-ide-"));
  await writeFile(path.join(root, "notes.md"), Buffer.from("ok\0no"));
  const service = new IdeService();
  const file = await service.read(root, "notes.md");
  assert.equal(file.language, "Binary");
  assert.equal(file.binary, true);
  assert.equal(file.content, null);
});

test("move renames a file and can send it into and out of a folder", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-ide-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "notes.md"), "# Title\n");
  const service = new IdeService();
  const into = await service.move(root, "notes.md", "src/notes.md");
  assert.equal(into.path, "src/notes.md");
  assert.equal(into.content, "# Title\n");
  const renamed = await service.move(root, "src/notes.md", "src/readme.md");
  assert.equal(renamed.name, "readme.md");
  assert.equal(renamed.language, "Markdown");
  const out = await service.move(root, "src/readme.md", "readme.md");
  assert.equal(out.path, "readme.md");
});

test("move refuses a destination outside the project or already taken", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "polymux-ide-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "a.txt"), "a");
  await writeFile(path.join(root, "b.txt"), "b");
  const service = new IdeService();
  await assert.rejects(() => service.move(root, "a.txt", "../secret.txt"), /outside/);
  await assert.rejects(() => service.move(root, "a.txt", "b.txt"), /Already exists/);
  await assert.rejects(() => service.create(root, "missing/new.txt"), /Folder not found/);
});
