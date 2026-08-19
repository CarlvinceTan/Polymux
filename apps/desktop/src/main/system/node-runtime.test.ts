import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { exportNodeRuntime, resolveNodeRuntime } from "./node-runtime.js";

const cleanups: string[] = [];
const originalEnv = process.env.FLAREAI_NODE;
afterEach(() => {
  for (const directory of cleanups.splice(0)) rmSync(directory, { recursive: true, force: true });
  if (originalEnv === undefined) delete process.env.FLAREAI_NODE;
  else process.env.FLAREAI_NODE = originalEnv;
});

function scratch(): string {
  const directory = mkdtempSync(path.join(tmpdir(), "node-runtime-"));
  cleanups.push(directory);
  return directory;
}

test("a bundled runtime wins over everything else", () => {
  const base = scratch();
  const bundled = path.join(base, "node");
  writeFileSync(bundled, "");
  const resolved = resolveNodeRuntime({
    bundledNode: bundled,
    checkoutMarker: path.join(base, "also-exists"),
    execPath: "/bin/true",
    wrapperDirectory: path.join(base, "bin"),
  });
  assert.equal(resolved, bundled);
});

test("a checkout without the bundle gets an ELECTRON_RUN_AS_NODE wrapper", () => {
  const base = scratch();
  mkdirSync(path.join(base, "marker"));
  const resolved = resolveNodeRuntime({
    bundledNode: path.join(base, "missing", "node"),
    checkoutMarker: path.join(base, "marker"),
    execPath: path.join(base, "space dir", "FlareAI"),
    wrapperDirectory: path.join(base, "bin"),
  });
  assert.equal(resolved, path.join(base, "bin", "flareai-node"));
  const body = readFileSync(resolved!, "utf8");
  assert.ok(body.startsWith("#!/bin/sh\n"));
  // The exec path is quoted: a userData path with spaces must survive.
  assert.ok(body.includes(`exec "${path.join(base, "space dir", "FlareAI")}" "$@"`));
  assert.ok(body.includes("ELECTRON_RUN_AS_NODE=1 "));
  assert.equal(statSync(resolved!).mode & 0o755, 0o755);
});

test("the wrapper actually execs its target with arguments", () => {
  const base = scratch();
  mkdirSync(path.join(base, "marker"));
  // Standing in for Electron: with ELECTRON_RUN_AS_NODE=1 set by the wrapper,
  // the real binary behaves as `node`, so plain `node` is a faithful target.
  const resolved = resolveNodeRuntime({
    bundledNode: path.join(base, "missing", "node"),
    checkoutMarker: path.join(base, "marker"),
    execPath: process.execPath,
    wrapperDirectory: path.join(base, "bin"),
  });
  const out = execFileSync(resolved!, ["-e", "console.log(process.env.ELECTRON_RUN_AS_NODE)"], {
    encoding: "utf8",
  });
  assert.equal(out.trim(), "1");
});

test("packaged without a bundle resolves to nothing rather than a GUI relaunch", () => {
  const base = scratch();
  const resolved = resolveNodeRuntime({
    bundledNode: path.join(base, "missing", "node"),
    checkoutMarker: path.join(base, "also-missing"),
    execPath: "/Applications/FlareAI.app/Contents/MacOS/FlareAI",
    wrapperDirectory: path.join(base, "bin"),
  });
  assert.equal(resolved, undefined);
});

test("exportNodeRuntime publishes FLAREAI_NODE only when something resolved", () => {
  const base = scratch();
  delete process.env.FLAREAI_NODE;
  const missing = exportNodeRuntime({
    bundledNode: path.join(base, "missing", "node"),
    checkoutMarker: path.join(base, "also-missing"),
    execPath: "/bin/true",
    wrapperDirectory: path.join(base, "bin"),
  });
  assert.equal(missing, undefined);
  assert.equal(process.env.FLAREAI_NODE, undefined);

  const bundled = path.join(base, "node");
  writeFileSync(bundled, "");
  const resolved = exportNodeRuntime({
    bundledNode: bundled,
    checkoutMarker: path.join(base, "nothing"),
    execPath: "/bin/true",
    wrapperDirectory: path.join(base, "bin"),
  });
  assert.equal(resolved, bundled);
  assert.equal(process.env.FLAREAI_NODE, bundled);
});
