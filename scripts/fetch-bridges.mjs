#!/usr/bin/env node
/**
 * Downloads the mautrix bridge binaries that ship inside FlareAI.
 *
 * Bridges are bundled rather than fetched at runtime: setup has to work on a
 * machine that is not online yet, and an app that downloads and then executes
 * code on first use is a much bigger promise to the user than one that ships
 * what it runs. The cost is bundle size, which is why this is a build step and
 * not a dependency.
 *
 * Versions are pinned, and every download is checked against the sha256sums.txt
 * published alongside it in the same release. A mismatch is fatal: a bridge is
 * a supervised child process with access to the user's accounts, so "probably
 * fine" is not a state worth packaging.
 *
 *   node scripts/fetch-bridges.mjs            # download into ./resources/bridges
 *   node scripts/fetch-bridges.mjs --dry-run  # resolve and verify availability
 *   node scripts/fetch-bridges.mjs --force    # re-download what is present
 */

import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile, chmod, stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = path.join(root, "resources", "bridges");

/**
 * Pinned releases from GitHub. `binary` is the name BridgeHost looks for; the
 * asset is that name plus `-darwin-arm64`, and its checksum comes from the
 * sha256sums.txt in the same release.
 */
const FLEET = [
  {binary: "mautrix-whatsapp", repo: "whatsapp", tag: "v0.2607.0"},
  {binary: "mautrix-telegram", repo: "telegram", tag: "v0.2607.0"},
  {binary: "mautrix-signal", repo: "signal", tag: "v0.2607.0"},
  {binary: "mautrix-discord", repo: "discord", tag: "v0.7.6"},
  {binary: "mautrix-slack", repo: "slack", tag: "v0.2607.0"},
  // One binary, two networks: Messenger and Instagram both run from this.
  {binary: "mautrix-meta", repo: "meta", tag: "v0.2607.0"},
  {binary: "mautrix-gmessages", repo: "gmessages", tag: "v0.2605.0"},
  {binary: "mautrix-linkedin", repo: "linkedin", tag: "v0.2604.0"},
  {binary: "mautrix-twitter", repo: "twitter", tag: "v0.2606.0"},
  {binary: "mautrix-bluesky", repo: "bluesky", tag: "v0.2510.0"},
  {binary: "mautrix-gvoice", repo: "gvoice", tag: "v0.2605.0"},
];

/**
 * Two networks publish no GitHub release a Mac can use, but do build one in
 * CI, so they come from mau.dev instead:
 *
 *   iMessage   — has no releases at all. Its CI builds a *universal* binary
 *                (arm64 + amd64 lipo'd together), which is the one bridge that
 *                also works on an Intel Mac. It links libolm dynamically, so
 *                the dylib is fetched alongside it and lands in the same
 *                directory, which is where its rpath looks.
 *   Google Chat — its releases are still the old Python bridge; the Go rewrite
 *                lives on the `megabridge` branch and only CI builds it.
 *
 * CI artifacts are not immutable the way a release tag is, so these are pinned
 * to a commit and checked against a recorded hash. There is no upstream sums
 * file to consult, so the first fetch of a new pin has to be trusted once with
 * --trust-new, which prints the hash to paste back in here.
 */
const CI_FLEET = [
  {
    binary: "mautrix-imessage",
    project: "imessage",
    commit: "300ba6d0e5566d1f841d42ee1555779a9b6fa4be",
    job: "build universal",
    extras: ["libolm.3.dylib"],
    sha256: "91240cc992bc36eae4945f75e93b6689af694f14ef398335f742b20f8d55ab1a",
  },
  {
    binary: "mautrix-googlechat",
    project: "googlechat",
    commit: "c58955059800e4510414ff02253f0b96403701c2",
    job: "build macos arm64",
    extras: [],
    sha256: "17c4aa9d7a1ac36c91bfb07084cf167183141f61b983fe35b6cd3839edad4871",
  },
];

/**
 * macOS builds are arm64 only, and not by choice: every mautrix release
 * publishes `<binary>-darwin-arm64` and nothing else for macOS. The `amd64`
 * assets alongside it are Linux. So an Intel build cannot be assembled by
 * fetching different assets — the binaries do not exist — and packaging one
 * would produce an app that installs, opens, and has no messaging at all.
 *
 * Supporting Intel means building the fleet from source for darwin/amd64,
 * which also means shipping binaries nobody has published a checksum for.
 * That is a deliberate decision, not a flag, so this refuses instead.
 */
const requestedArch = process.argv.find((flag) => flag.startsWith("--arch="))?.slice(7);
if (requestedArch && requestedArch !== "arm64") {
  console.error(
    [
      `No macOS ${requestedArch} bridge binaries exist upstream — every mautrix release`,
      "publishes darwin-arm64 only. Packaging that architecture would ship an app",
      "with no working messaging. See AGENTS.md, Packaging and signing.",
    ].join("\n"),
  );
  process.exit(1);
}

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const trustNew = process.argv.includes("--trust-new");
const asset = (entry) => `${entry.binary}-darwin-arm64`;
const url = (entry, file) =>
  `https://github.com/mautrix/${entry.repo}/releases/download/${entry.tag}/${file}`;

async function sha256Of(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** The checksum the release itself publishes for this asset. */
async function expectedChecksum(entry) {
  const response = await fetch(url(entry, "sha256sums.txt"));
  if (!response.ok) throw new Error(`no sha256sums.txt (HTTP ${response.status})`);
  const line = (await response.text())
    .split("\n")
    .find((row) => row.trim().endsWith(asset(entry)));
  if (!line) throw new Error(`sha256sums.txt does not list ${asset(entry)}`);
  return line.trim().split(/\s+/)[0];
}

async function alreadyHave(entry, checksum) {
  const target = path.join(outputDirectory, entry.binary);
  const existing = await readFile(target).catch(() => null);
  return existing !== null && (await sha256Of(existing)) === checksum;
}

async function fetchOne(entry) {
  const checksum = await expectedChecksum(entry);
  if (!force && (await alreadyHave(entry, checksum))) return {skipped: true, checksum};

  if (dryRun) {
    const head = await fetch(url(entry, asset(entry)), {method: "HEAD"});
    if (!head.ok) throw new Error(`asset unavailable (HTTP ${head.status})`);
    return {size: Number(head.headers.get("content-length") ?? 0), checksum, dryRun: true};
  }

  const response = await fetch(url(entry, asset(entry)));
  if (!response.ok) throw new Error(`download failed (HTTP ${response.status})`);
  const body = Buffer.from(await response.arrayBuffer());
  const actual = await sha256Of(body);
  if (actual !== checksum)
    throw new Error(`checksum mismatch: expected ${checksum}, got ${actual}`);

  const target = path.join(outputDirectory, entry.binary);
  await writeFile(target, body);
  await chmod(target, 0o755);
  return {size: body.length, checksum};
}

const megabytes = (bytes) => `${(bytes / 1_000_000).toFixed(1)}MB`;

/** A file from a pinned mau.dev CI job. */
const ciUrl = (entry, file) =>
  `https://mau.dev/mautrix/${entry.project}/-/jobs/artifacts/${entry.commit}/raw/${file}` +
  `?job=${encodeURIComponent(entry.job)}`;

async function fetchFromCi(entry) {
  if (!entry.sha256 && !trustNew && !dryRun)
    throw new Error(
      "no pinned sha256 for this commit — run once with --trust-new and record the hash printed",
    );

  if (dryRun) {
    const head = await fetch(ciUrl(entry, entry.binary), {method: "HEAD"});
    if (!head.ok) throw new Error(`artifact unavailable (HTTP ${head.status})`);
    for (const extra of entry.extras) {
      const side = await fetch(ciUrl(entry, extra), {method: "HEAD"});
      if (!side.ok) throw new Error(`${extra} unavailable (HTTP ${side.status})`);
    }
    return {size: Number(head.headers.get("content-length") ?? 0), checksum: entry.sha256 ?? "unpinned", dryRun: true};
  }

  const response = await fetch(ciUrl(entry, entry.binary));
  if (!response.ok) throw new Error(`download failed (HTTP ${response.status})`);
  const body = Buffer.from(await response.arrayBuffer());
  const actual = await sha256Of(body);
  if (entry.sha256 && actual !== entry.sha256)
    throw new Error(`checksum mismatch: expected ${entry.sha256}, got ${actual}`);

  await writeFile(path.join(outputDirectory, entry.binary), body);
  await chmod(path.join(outputDirectory, entry.binary), 0o755);

  // Shared libraries the binary loads from its own directory at runtime.
  for (const extra of entry.extras) {
    const side = await fetch(ciUrl(entry, extra));
    if (!side.ok) throw new Error(`${extra} download failed (HTTP ${side.status})`);
    await writeFile(path.join(outputDirectory, extra), Buffer.from(await side.arrayBuffer()));
  }

  return {size: body.length, checksum: actual, unpinned: !entry.sha256};
}

async function main() {
  await mkdir(outputDirectory, {recursive: true});
  let total = 0;
  let failed = 0;

  for (const entry of FLEET) {
    process.stdout.write(`${entry.binary.padEnd(20)} ${entry.tag.padEnd(12)} `);
    try {
      const result = await fetchOne(entry);
      if (result.skipped) {
        const {size} = await stat(path.join(outputDirectory, entry.binary));
        total += size;
        console.log(`already current (${megabytes(size)})`);
      } else {
        total += result.size;
        console.log(`${result.dryRun ? "available" : "ok"} ${megabytes(result.size)}  ${result.checksum.slice(0, 12)}…`);
      }
    } catch (error) {
      failed += 1;
      console.log(`FAILED — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  for (const entry of CI_FLEET) {
    process.stdout.write(`${entry.binary.padEnd(20)} ${entry.commit.slice(0, 8).padEnd(12)} `);
    try {
      const result = await fetchFromCi(entry);
      total += result.size;
      console.log(
        `${result.dryRun ? "available" : "ok"} ${megabytes(result.size)}  ` +
          (result.unpinned ? `RECORD THIS: sha256: "${result.checksum}"` : `${String(result.checksum).slice(0, 12)}…`),
      );
    } catch (error) {
      failed += 1;
      console.log(`FAILED — ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const count = FLEET.length + CI_FLEET.length;
  console.log(`\n${count - failed}/${count} bridges, ${megabytes(total)} total.`);
  console.log(
    "\nmacOS builds are arm64 only: upstream publishes darwin-arm64 and nothing\n" +
      "else, so an Intel Mac would get iMessage (universal) and nothing else.",
  );
  if (failed > 0) process.exitCode = 1;
}

await main();
