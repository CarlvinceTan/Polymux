#!/usr/bin/env node
/**
 * Downloads the Node.js runtime that ships inside FlareAI.
 *
 * Skill scripts are plain `.mjs` files run with `"${FLAREAI_NODE:-node}"`. In
 * development that interpreter is Electron itself via ELECTRON_RUN_AS_NODE,
 * but the packaged app burns that fuse off (forge.config.ts, RunAsNode:
 * false) — deliberately, so nothing can borrow the signed binary as an
 * arbitrary Node with FlareAI's TCC grants. The packaged app therefore ships
 * its own `node`, and cannot fall back to whatever Python or Node a user's
 * machine happens to have.
 *
 * The version is pinned to the exact release Electron embeds, so a script
 * behaves identically under `npm run isolate` and in the packaged app. The
 * download is checked against the SHASUMS256.txt published alongside it; a
 * mismatch is fatal for the same reason it is for the bridges — this binary
 * executes with the user's files in reach.
 *
 *   node scripts/fetch-node.mjs           # download into ./resources/node
 *   node scripts/fetch-node.mjs --force   # re-download even if present
 */

import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {chmod, mkdir, mkdtemp, rm, rename, readFile, stat, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

// Keep in step with the Electron major in package.json: this must be the
// Node release Electron embeds (`ELECTRON_RUN_AS_NODE=1 <electron> -p
// process.version`), not merely a compatible one.
const NODE_VERSION = "24.18.1";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "resources", "node");
const binaryPath = path.join(outputDirectory, "node");
const versionStamp = path.join(outputDirectory, "VERSION");

function target() {
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
  if (process.platform === "linux" && process.arch === "arm64") return "linux-arm64";
  throw new Error(`No pinned Node runtime for ${process.platform}-${process.arch}`);
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  const force = process.argv.includes("--force");
  try {
    const existing = (await readFile(versionStamp, "utf8")).trim();
    await stat(binaryPath);
    if (existing === NODE_VERSION && !force) {
      console.log(`node ${NODE_VERSION} already present, skipping`);
      return;
    }
  } catch {
    // Missing or unstamped: fetch.
  }

  const platform = target();
  const archive = `node-v${NODE_VERSION}-${platform}.tar.gz`;
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`;

  console.log(`fetching ${archive}`);
  const sums = (await fetchBytes(`${base}/SHASUMS256.txt`)).toString("utf8");
  const expected = sums
    .split("\n")
    .map((line) => line.trim().split(/\s+/))
    .find(([, name]) => name === archive)?.[0];
  if (!expected) throw new Error(`${archive} is not listed in SHASUMS256.txt`);

  const bytes = await fetchBytes(`${base}/${archive}`);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expected)
    throw new Error(`${archive}: sha256 mismatch\n  expected ${expected}\n  actual   ${actual}`);

  // Only bin/node ships; the tarball's headers, docs and npm do not.
  const staging = await mkdtemp(path.join(tmpdir(), "flareai-node-"));
  try {
    const archivePath = path.join(staging, archive);
    await writeFile(archivePath, bytes);
    execFileSync("tar", [
      "-xzf", archivePath,
      "-C", staging,
      "--strip-components", "2",
      `node-v${NODE_VERSION}-${platform}/bin/node`,
    ]);
    await mkdir(outputDirectory, {recursive: true});
    await rm(binaryPath, {force: true});
    await rename(path.join(staging, "node"), binaryPath);
    await chmod(binaryPath, 0o755);
    await writeFile(versionStamp, `${NODE_VERSION}\n`);
  } finally {
    await rm(staging, {recursive: true, force: true});
  }
  console.log(`node ${NODE_VERSION} → ${path.relative(root, binaryPath)}`);
}

await main();
