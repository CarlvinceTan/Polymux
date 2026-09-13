import assert from "node:assert/strict";
import test from "node:test";
import {isBinaryFileName, isEnvFileName, languageForName} from "./language.js";

test("maintained catalogs cover source formats beyond the original extension list", () => {
  for (const [file, language] of [
    ["main.ex", "Elixir"], ["main.elm", "Elm"], ["main.nim", "Nim"], ["main.zig", "Zig"],
    ["main.nix", "Nix"], ["main.lua", "Lua"], ["main.scala", "Scala"], ["main.dart", "Dart"],
    ["main.cs", "C#"], ["index.astro", "Astro"], ["main.f90", "Fortran Free Form"],
    ["types.pyi", "Python"], ["main.clj", "Clojure"], ["main.jl", "Julia"],
    ["foo.h", "C"], ["foo.hpp", "C++"], ["foo.sh.in", "Shell Script"], ["view.blade.php", "Blade"],
    ["Dockerfile", "Dockerfile"], ["dockerfile", "Dockerfile"], ["DOCKERFILE", "Dockerfile"],
    ["CMakeLists.txt", "CMake"], ["Gemfile", "Ruby"], ["Rakefile", "Ruby"],
    ["Cargo.lock", "TOML"], [".editorconfig", "EditorConfig"], [".npmignore", "Gitignore"],
  ]) {
    assert.equal(languageForName(file), language, file);
    assert.equal(isBinaryFileName(file), false, file);
  }
});

test("extensionless scripts use interpreter metadata without executing anything", () => {
  assert.equal(languageForName("script", "#!/usr/bin/python3\nprint(1)"), "Python");
  assert.equal(languageForName("script", "#!/usr/bin/env -S node --flag\n"), "JavaScript");
  assert.equal(languageForName("script", "#!/usr/bin/env MODE=demo ruby\n"), "Ruby");
  assert.equal(languageForName("script", "#!/bin/bash\n"), "Shell Script");
  assert.equal(languageForName("module.ts", "#!/usr/bin/env node\n"), "TypeScript");
  assert.equal(languageForName("file.future-extension", "unrecognised text"), "Text");
});

test("JavaScript and TypeScript module variants and declarations are text", () => {
  for (const [names, language] of [
    [["index.js", "index.jsx", "index.mjs", "index.cjs"], "JavaScript"],
    [["index.ts", "index.tsx", "index.mts", "index.cts", "index.d.ts", "index.d.mts", "index.d.cts"], "TypeScript"],
  ] as const) {
    for (const name of names) {
      for (const file of [name, name.toUpperCase(), `src/${name}`, `C:\\project\\src\\${name}`]) {
        assert.equal(isBinaryFileName(file), false, file);
        assert.equal(languageForName(file), language, file);
      }
    }
  }
});

test("well-known filenames are recognised with Windows directory separators", () => {
  assert.equal(languageForName("C:\\project\\.env.local"), "Shell Script");
  assert.equal(languageForName("C:\\project\\Dockerfile"), "Dockerfile");
  assert.equal(languageForName("C:\\project\\.gitignore"), "Gitignore");
});

test("isEnvFileName matches the dotenv family and not nearby names", () => {
  assert.equal(isEnvFileName(".env"), true);
  assert.equal(isEnvFileName(".env.local"), true);
  assert.equal(isEnvFileName("src/.env.production"), true);
  assert.equal(isEnvFileName("secrets.env"), true);
  assert.equal(isEnvFileName(".envrc"), false);
  assert.equal(isEnvFileName("notes.txt"), false);
});

test("languageForName labels dotenv files as Shell Script", () => {
  assert.equal(languageForName(".env"), "Shell Script");
  assert.equal(languageForName(".env.local"), "Shell Script");
  assert.equal(languageForName(".env.example"), "Shell Script");
  assert.equal(languageForName(".env.production"), "Shell Script");
  assert.equal(languageForName("setup.sh"), "Shell Script");
  assert.notEqual(languageForName(".env.local"), "LOCAL");
  assert.notEqual(languageForName(".env"), "Text");
  assert.notEqual(languageForName(".env"), "Properties");
});

test("languageForName labels images, fonts, archives, and binaries as Binary", () => {
  assert.equal(isBinaryFileName("src/icon.png"), true);
  assert.equal(isBinaryFileName("notes.md"), false);
  assert.equal(languageForName("icon.png"), "Binary");
  assert.equal(languageForName("photo.JPG"), "Binary");
  assert.equal(languageForName("doc.pdf"), "Binary");
  assert.equal(languageForName("font.woff2"), "Binary");
  assert.equal(languageForName("app.zip"), "Binary");
  assert.equal(languageForName("demo.mp4"), "Binary");
  assert.notEqual(languageForName("icon.png"), "PNG");
  assert.notEqual(languageForName("icon.png"), "Text");
});

test("languageForName keeps text formats and well-known names", () => {
  assert.equal(languageForName("App.svelte"), "Svelte");
  assert.equal(languageForName("main.ts"), "TypeScript");
  assert.equal(languageForName("logo.svg"), "SVG");
  assert.equal(languageForName(".gitignore"), "Gitignore");
  assert.equal(languageForName(".bashrc"), "Shell Script");
  assert.equal(languageForName(".zshrc"), "Shell Script");
  assert.equal(languageForName(".envrc"), "Shell Script");
  assert.equal(languageForName("go.mod"), "Go");
  assert.equal(languageForName("Makefile"), "Makefile");
  assert.equal(languageForName("plain"), "Text");
  assert.equal(languageForName("notes.local"), "Text");
});
