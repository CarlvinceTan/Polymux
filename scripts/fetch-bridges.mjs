#!/usr/bin/env node
/**
 * Prepares the mautrix bridge binaries that ship inside Polymux.
 *
 * Bridges are bundled rather than fetched at runtime: setup has to work on a
 * machine that is not online yet, and an app that downloads and then executes
 * code on first use is a much bigger promise to the user than one that ships
 * what it runs. The cost is bundle size, which is why this is a build step and
 * not a dependency.
 *
 * Versions are pinned. Release downloads are checked against their published
 * sha256sums; Windows binaries are built from immutable source commit hashes
 * with CGO and the pure-Go encryption backend. A mismatch or failed build is
 * fatal: a bridge is a supervised child process with access to the user's
 * accounts, so "probably fine" is not a state worth packaging.
 *
 *   node scripts/fetch-bridges.mjs            # download into ./resources/bridges
 *   node scripts/fetch-bridges.mjs --dry-run  # resolve and verify availability
 *   node scripts/fetch-bridges.mjs --force    # re-prepare what is present
 *
 * Windows packaging needs Go plus a CGO-compatible compiler. The release job
 * supplies Go and MSYS2 MinGW; local Windows packagers need the same.
 */

import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
import {existsSync} from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputOverride = process.argv.find((flag) => flag.startsWith("--output="))?.slice(9);
const outputDirectory = outputOverride
  ? path.resolve(outputOverride)
  : path.join(root, "resources", "bridges");

/**
 * Pinned releases from GitHub. `binary` is the name BridgeHost looks for; the
 * asset name depends on the target. Mautrix's unsuffixed `amd64`/`arm64`
 * artifacts are Linux binaries; macOS artifacts are `darwin-arm64`.
 */
export const FLEET = [
  {
    binary: "mautrix-whatsapp",
    repo: "whatsapp",
    tag: "v0.2607.0",
    commit: "a86f5eb9bf7d5a4a6cc7a1c4e42d322bdcb03aa2",
  },
  {
    binary: "mautrix-telegram",
    repo: "telegram",
    tag: "v0.2607.0",
    commit: "9b65027dd9ecc0412373ea3f2f6324e6f8dd6849",
  },
  {
    binary: "mautrix-signal",
    repo: "signal",
    tag: "v0.2607.0",
    commit: "df6f954a62174640e82ef5c3457e8858f038f6c6",
  },
  {
    binary: "mautrix-discord",
    repo: "discord",
    tag: "v0.7.6",
    commit: "19e26674e6624a02bced982aafe845cb20e43827",
    command: ".",
  },
  {
    binary: "mautrix-slack",
    repo: "slack",
    tag: "v0.2607.0",
    commit: "bb9702249df2bdbad7d7f3b4651a51a024653de3",
  },
  {
    binary: "mautrix-meta",
    repo: "meta",
    tag: "v0.2608.0",
    commit: "9e6484d7bb46078fda661b03e2aa28c0a1b4db70",
  },
  // Instagram moved to its own executable in v26.07. It is published from the
  // same repository and can use the existing Instagram config/database.
  {
    binary: "mautrix-instagram",
    repo: "meta",
    tag: "v0.2608.0",
    commit: "9e6484d7bb46078fda661b03e2aa28c0a1b4db70",
  },
  {
    binary: "mautrix-gmessages",
    repo: "gmessages",
    tag: "v0.2605.0",
    commit: "986c579fcfd7cc91acb8374677cf85d2c48d9e8c",
  },
  {
    binary: "mautrix-linkedin",
    repo: "linkedin",
    tag: "v0.2604.0",
    commit: "979b37b0f16a790f0a95ca7fbc73d9190a91c8d4",
  },
  {
    binary: "mautrix-twitter",
    repo: "twitter",
    tag: "v0.2606.0",
    commit: "85632ad118532590c04fe7b67cde0e48a56e1743",
  },
  {
    binary: "mautrix-bluesky",
    repo: "bluesky",
    tag: "v0.2510.0",
    commit: "d702a4089088ac9717902d6d2c089fafd4c7f4c4",
  },
  {
    binary: "mautrix-gvoice",
    repo: "gvoice",
    tag: "v0.2605.0",
    commit: "699dabf37613e82a18a2732cb8b6910a75db5dd0",
  },
  {
    binary: "mautrix-zulip",
    repo: "zulip",
    tag: "v0.2511.0",
    commit: "ed18e9e35fde96fe47519a1dcf23ead70a255a3c",
  },
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
    repo: "googlechat",
    commit: "c58955059800e4510414ff02253f0b96403701c2",
    job: "build macos arm64",
    extras: [],
    sha256: "17c4aa9d7a1ac36c91bfb07084cf167183141f61b983fe35b6cd3839edad4871",
  },
];

// The Google Chat megabridge CI also publishes a native Linux amd64 artifact
// from the same pinned commit. It is a separate job, so its checksum is pinned
// independently from the macOS build above.
const LINUX_CI_FLEET = [
  {
    binary: "mautrix-googlechat",
    project: "googlechat",
    commit: "c58955059800e4510414ff02253f0b96403701c2",
    job: "build amd64",
    extras: [],
    sha256: "ceea7f0cd79dca09bf372bad436d38bf7a8906545abf80d12cfa2b912362d589",
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
const requestedPlatform =
  process.argv.find((flag) => flag.startsWith("--platform="))?.slice(11) ??
  process.platform;
const requestedArch =
  process.argv.find((flag) => flag.startsWith("--arch="))?.slice(7) ?? process.arch;
if (requestedPlatform === "darwin" && requestedArch !== "arm64") {
  console.error(
    [
      `No macOS ${requestedArch} bridge binaries exist upstream — every mautrix release`,
      "publishes darwin-arm64 only. Packaging that architecture would ship an app",
      "with no working messaging. See AGENTS.md, Packaging and signing.",
    ].join("\n"),
  );
  process.exit(1);
}
if (requestedPlatform === "linux" && !["x64", "arm64"].includes(requestedArch))
  throw new Error(
    `No complete Linux bridge fleet for ${requestedArch}; supported architectures are x64 and arm64`,
  );
if (requestedPlatform === "win32" && requestedArch !== "x64")
  throw new Error(`No pinned Windows bridge fleet for ${requestedArch}`);
if (!["darwin", "linux", "win32"].includes(requestedPlatform))
  throw new Error(`Unsupported bridge target ${requestedPlatform}-${requestedArch}`);

const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");
const trustNew = process.argv.includes("--trust-new");
const linuxArch = {x64: "amd64", arm64: "arm64", arm: "arm"}[requestedArch];
const asset = (entry) =>
  `${entry.binary}-${requestedPlatform === "darwin" ? "darwin-arm64" : linuxArch}`;
const installedName = (entry) =>
  `${entry.binary}${requestedPlatform === "win32" ? ".exe" : ""}`;
const installedPath = (entry) => path.join(outputDirectory, installedName(entry));
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
  const target = installedPath(entry);
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

  const target = installedPath(entry);
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

  await writeFile(installedPath(entry), body);
  await chmod(installedPath(entry), 0o755);

  // Shared libraries the binary loads from its own directory at runtime.
  for (const extra of entry.extras) {
    const side = await fetch(ciUrl(entry, extra));
    if (!side.ok) throw new Error(`${extra} download failed (HTTP ${side.status})`);
    await writeFile(path.join(outputDirectory, extra), Buffer.from(await side.arrayBuffer()));
  }

  return {size: body.length, checksum: actual, unpinned: !entry.sha256};
}

/**
 * Upstream release assets do not include Windows, but the current bridges are
 * ordinary Go programs and do support it. Build the pinned source commits with
 * CGO for SQLite and mautrix's pure-Go `goolm` backend, so the packaged app has
 * the same local bridge fleet rather than a Hub full of dead rows.
 *
 * Google Chat joins the release fleet here: its pinned megabridge commit is
 * already the source of the macOS/Linux CI artifact, and it builds natively on
 * Windows too. iMessage is intentionally absent because it reads Apple's local
 * Messages database and has no meaning on Windows.
 */
const WINDOWS_SOURCE_FLEET = [
  ...FLEET.filter((entry) => !["signal", "discord"].includes(entry.repo)),
  {
    binary: "mautrix-googlechat",
    repo: "googlechat",
    tag: "c5895505",
    commit: "c58955059800e4510414ff02253f0b96403701c2",
  },
];
const windowsManifestPath = path.join(outputDirectory, ".windows-sources.json");
let windowsSourceRoot;
const windowsSources = new Map();

async function readWindowsManifest() {
  const source = await readFile(windowsManifestPath, "utf8").catch(() => "");
  try {
    const parsed = JSON.parse(source);
    return parsed?.schema === 1 && parsed?.arch === requestedArch && parsed?.builds
      ? parsed
      : {schema: 1, arch: requestedArch, builds: {}};
  } catch {
    return {schema: 1, arch: requestedArch, builds: {}};
  }
}

async function alreadyHaveWindows(entry, manifest) {
  const recorded = manifest.builds[entry.binary];
  if (recorded?.commit !== entry.commit || recorded?.tags !== "goolm") return false;
  const body = await readFile(installedPath(entry)).catch(() => null);
  return body !== null && (await sha256Of(body)) === recorded.sha256;
}

function windowsCompilerEnvironment() {
  if (process.env.CC) return process.env;
  const mingwDirectory = "C:\\msys64\\mingw64\\bin";
  const mingwCompiler = path.join(mingwDirectory, "gcc.exe");
  if (process.platform === "win32" && existsSync(mingwCompiler))
    return {
      ...process.env,
      CC: mingwCompiler,
      PATH: `${mingwDirectory}${path.delimiter}${process.env.PATH ?? ""}`,
    };
  try {
    execFileSync("gcc", ["--version"], {stdio: "ignore"});
    return {...process.env, CC: "gcc"};
  } catch {
    throw new Error(
      "building Windows bridges needs a CGO-compatible compiler (the release runner uses MSYS2 MinGW)",
    );
  }
}

async function windowsSource(entry) {
  const key = `${entry.repo}@${entry.commit}`;
  if (!windowsSources.has(key))
    windowsSources.set(key, (async () => {
      const sourceUrl = `https://github.com/mautrix/${entry.repo}/archive/${entry.commit}.tar.gz`;
      if (dryRun) {
        const response = await fetch(sourceUrl, {method: "HEAD"});
        if (!response.ok) throw new Error(`source unavailable (HTTP ${response.status})`);
        return {dryRun: true, size: Number(response.headers.get("content-length") ?? 0)};
      }
      windowsSourceRoot ??= await mkdtemp(path.join(tmpdir(), "polymux-windows-bridges-"));
      const directory = path.join(windowsSourceRoot, `${entry.repo}-${entry.commit.slice(0, 12)}`);
      const archive = path.join(windowsSourceRoot, `${entry.repo}-${entry.commit.slice(0, 12)}.tar.gz`);
      await mkdir(directory, {recursive: true});
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`source download failed (HTTP ${response.status})`);
      await writeFile(archive, Buffer.from(await response.arrayBuffer()));
      execFileSync("tar", ["-xzf", archive, "--strip-components=1", "-C", directory], {
        stdio: "ignore",
      });
      return {directory};
    })());
  return windowsSources.get(key);
}

async function buildWindows(entry, manifest, compilerEnvironment) {
  if (!force && (await alreadyHaveWindows(entry, manifest))) {
    const {size} = await stat(installedPath(entry));
    return {skipped: true, size, checksum: manifest.builds[entry.binary].sha256};
  }
  const source = await windowsSource(entry);
  if (source.dryRun)
    return {dryRun: true, size: source.size, checksum: entry.commit};

  const goMod = await readFile(path.join(source.directory, "go.mod"), "utf8");
  const mautrixVersion = goMod.match(/^\s*maunium\.net\/go\/mautrix\s+(\S+)/m)?.[1] ?? "";
  const staging = path.join(outputDirectory, `.${entry.binary}.installing.exe`);
  await rm(staging, {force: true});
  const ldflags = [
    "-s",
    "-w",
    `-X main.Tag=${entry.tag}`,
    `-X main.Commit=${entry.commit}`,
    `-X main.BuildTime=${new Date().toISOString()}`,
    ...(mautrixVersion
      ? [`-X maunium.net/go/mautrix.GoModVersion=${mautrixVersion}`]
      : []),
  ].join(" ");
  execFileSync(
    "go",
    [
      "build",
      "-tags", "goolm",
      "-trimpath",
      "-ldflags", ldflags,
      "-o", staging,
      entry.command ?? `./cmd/${entry.binary}`,
    ],
    {
      cwd: source.directory,
      stdio: "inherit",
      env: {
        ...compilerEnvironment,
        CGO_ENABLED: "1",
        GOOS: "windows",
        GOARCH: "amd64",
        GOTOOLCHAIN: "auto",
      },
    },
  );
  const body = await readFile(staging);
  const checksum = await sha256Of(body);
  await rm(installedPath(entry), {force: true});
  await rename(staging, installedPath(entry));
  await chmod(installedPath(entry), 0o755);
  return {size: body.length, checksum};
}

async function main() {
  await mkdir(outputDirectory, {recursive: true});
  // This directory is cached between builds. Keep verified files for repeated
  // builds of the same target, but clear every managed binary when the target
  // changes so a Windows or Linux package can never inherit macOS code.
  const targetId = `${requestedPlatform}-${requestedArch}`;
  const targetStamp = path.join(outputDirectory, ".platform");
  const previousTarget = (await readFile(targetStamp, "utf8").catch(() => "")).trim();
  if (!dryRun && previousTarget !== targetId) {
    for (const entry of [...FLEET, ...CI_FLEET, ...LINUX_CI_FLEET]) {
      await rm(path.join(outputDirectory, entry.binary), {force: true});
      await rm(path.join(outputDirectory, `${entry.binary}.exe`), {force: true});
      await rm(path.join(outputDirectory, `.${entry.binary}.installing.exe`), {force: true});
      for (const extra of entry.extras ?? [])
        await rm(path.join(outputDirectory, extra), {force: true});
    }
    await rm(windowsManifestPath, {force: true});
  }
  let total = 0;
  let failed = 0;

  // Upstream publishes ready-made release binaries for Linux and Apple
  // silicon. Windows is built from the same pinned source below.
  const releaseFleet = requestedPlatform === "win32" ? [] : FLEET;
  for (const entry of releaseFleet) {
    process.stdout.write(`${entry.binary.padEnd(20)} ${entry.tag.padEnd(12)} `);
    try {
      const result = await fetchOne(entry);
      if (result.skipped) {
        const {size} = await stat(installedPath(entry));
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

  let windowsManifest;
  if (requestedPlatform === "win32") {
    const previousManifest = await readWindowsManifest();
    windowsManifest = {schema: 1, arch: requestedArch, builds: {}};
    let compilerEnvironment;
    const needsCompiler = !dryRun &&
      !(await Promise.all(
        WINDOWS_SOURCE_FLEET.map((entry) => alreadyHaveWindows(entry, previousManifest)),
      )).every(Boolean);
    if (needsCompiler) {
      try {
        execFileSync("go", ["version"], {stdio: "ignore"});
        compilerEnvironment = windowsCompilerEnvironment();
      } catch (error) {
        failed = WINDOWS_SOURCE_FLEET.length;
        console.log(
          `Windows bridge toolchain FAILED — ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    if (dryRun || !needsCompiler || compilerEnvironment) {
      for (const entry of WINDOWS_SOURCE_FLEET) {
        process.stdout.write(`${entry.binary.padEnd(20)} ${entry.tag.padEnd(12)} `);
        try {
          const result = await buildWindows(entry, previousManifest, compilerEnvironment);
          total += result.size;
          windowsManifest.builds[entry.binary] = {
            commit: entry.commit,
            tags: "goolm",
            sha256: result.checksum,
          };
          // Checkpoint every verified binary. A Windows fleet build is long
          // enough for a runner or network interruption to be realistic; the
          // next attempt should resume from completed bridges rather than
          // compiling them all again. The target stamp remains an all-or-none
          // package marker and is written only after the complete fleet passes.
          if (!dryRun)
            await writeFile(
              windowsManifestPath,
              `${JSON.stringify(windowsManifest, null, 2)}\n`,
            );
          console.log(
            result.skipped
              ? `already current (${megabytes(result.size)})`
              : `${result.dryRun ? "source available" : "built"} ${megabytes(result.size)}  ${result.checksum.slice(0, 12)}…`,
          );
        } catch (error) {
          failed += 1;
          console.log(`FAILED — ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  // iMessage remains macOS-only. Google Chat has independently pinned CI
  // outputs for macOS arm64 and Linux amd64.
  const ciFleet = requestedPlatform === "darwin"
    ? CI_FLEET
    : requestedPlatform === "linux" && requestedArch === "x64"
      ? LINUX_CI_FLEET
      : [];
  for (const entry of ciFleet) {
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

  const count = releaseFleet.length + ciFleet.length +
    (requestedPlatform === "win32" ? WINDOWS_SOURCE_FLEET.length : 0);
  console.log(`\n${count - failed}/${count} bridges, ${megabytes(total)} total.`);
  if (requestedPlatform === "darwin")
    console.log("\nmacOS builds are arm64 only: upstream publishes darwin-arm64 and nothing else.");
  else if (requestedPlatform === "linux")
    console.log(
      requestedArch === "x64"
        ? "\nLinux includes 14 native bridges; only iMessage is unavailable."
        : "\nLinux arm64 includes 13 native bridges; Google Chat has no pinned " +
          "artifact and iMessage is unavailable.",
    );
  else
    console.log(
      "\nWindows includes 12 native bridges; Signal and the legacy Discord bridge remain unsupported upstream, while iMessage is Apple-only.",
    );
  if (windowsSourceRoot)
    await rm(windowsSourceRoot, {recursive: true, force: true});
  if (failed > 0) process.exitCode = 1;
  else if (!dryRun) {
    if (windowsManifest)
      await writeFile(windowsManifestPath, `${JSON.stringify(windowsManifest, null, 2)}\n`);
    await writeFile(targetStamp, `${targetId}\n`);
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
