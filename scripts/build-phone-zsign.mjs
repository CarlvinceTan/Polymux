#!/usr/bin/env node
/** Build the pinned macOS iPhone signer with OpenSSL linked statically.
 *
 * Upstream's tiny macOS release binary points into the maintainer's Homebrew
 * prefix. Building from the verified source archive produces a relocatable
 * binary that end users can run without Homebrew, Xcode, or other libraries.
 */

import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
  chmod,
  copyFile,
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

export const ZSIGN_RELEASE = "1.1.1";
const ZSIGN_SOURCE_URL =
  `https://github.com/zhlynn/zsign/archive/refs/tags/v${ZSIGN_RELEASE}.tar.gz`;
const ZSIGN_SOURCE_SHA256 =
  "5e1a24116ca6875d6786703a7fb129d6afde06822f6a859de47d44eff4ad7c05";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function commandOutput(command, args) {
  try {
    return execFileSync(command, args, {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]}).trim();
  } catch {
    return "";
  }
}

export function zsignBuildArguments(opensslPrefix) {
  return [
    `VERSION=${ZSIGN_RELEASE}`,
    `OPENSSL_INCLUDE=-I${path.join(opensslPrefix, "include")}`,
    `OPENSSL_LIB=${path.join(opensslPrefix, "lib", "libssl.a")} ${path.join(opensslPrefix, "lib", "libcrypto.a")}`,
    `-j${Math.max(2, Number(process.env.POLYMUX_BUILD_JOBS) || 4)}`,
  ];
}

async function opensslPrefix(override) {
  const candidates = [
    override,
    process.env.OPENSSL_PREFIX,
    commandOutput("pkg-config", ["--variable=prefix", "openssl"]),
    commandOutput("brew", ["--prefix", "openssl@3"]),
    "/opt/homebrew/opt/openssl@3",
    "/usr/local/opt/openssl@3",
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await Promise.all([
        stat(path.join(candidate, "include", "openssl", "ssl.h")),
        stat(path.join(candidate, "lib", "libssl.a")),
        stat(path.join(candidate, "lib", "libcrypto.a")),
      ]);
      return candidate;
    } catch {
      // Try the next normal build-machine location.
    }
  }
  throw new Error(
    "Building the macOS iPhone signer requires the OpenSSL 3 static libraries on the build machine.",
  );
}

function runtimeStamp(platform, arch) {
  return `${ZSIGN_RELEASE}-${platform}-${arch}-static`;
}

async function ready(outputDirectory, platform, arch) {
  try {
    const executable = path.join(outputDirectory, "zsign");
    const [version, manifest] = await Promise.all([
      readFile(path.join(outputDirectory, "VERSION"), "utf8"),
      readFile(path.join(outputDirectory, "MANIFEST.json"), "utf8").then(JSON.parse),
      stat(executable),
      stat(path.join(outputDirectory, "LICENSE.zsign.txt")),
    ]);
    if (
      version.trim() !== runtimeStamp(platform, arch) ||
      manifest.release !== ZSIGN_RELEASE ||
      manifest.sourceSha256 !== ZSIGN_SOURCE_SHA256
    ) return false;
    return digest(await readFile(executable)) === manifest.executableSha256;
  } catch {
    return false;
  }
}

export async function buildPhoneZsign(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== "darwin" || arch !== "arm64" || process.platform !== platform || process.arch !== arch)
    throw new Error("The static Polymux macOS iPhone signer must be built on an Apple Silicon Mac.");
  const outputDirectory = options.outputDirectory ??
    path.join(root, "resources", "phone", "ios", "signer-tools");
  if (!options.force && await ready(outputDirectory, platform, arch)) {
    console.log(`zsign ${runtimeStamp(platform, arch)} already present, skipping`);
    return outputDirectory;
  }

  console.log(`building static zsign ${ZSIGN_RELEASE}`);
  const sourceBytes = await fetchBytes(ZSIGN_SOURCE_URL);
  if (digest(sourceBytes) !== ZSIGN_SOURCE_SHA256)
    throw new Error("zsign source sha256 mismatch");

  const staging = await mkdtemp(path.join(tmpdir(), "polymux-phone-zsign-"));
  const pending = path.join(
    path.dirname(outputDirectory),
    `.${path.basename(outputDirectory)}.pending-${process.pid}`,
  );
  try {
    const archive = path.join(staging, `zsign-${ZSIGN_RELEASE}.tar.gz`);
    await writeFile(archive, sourceBytes);
    execFileSync("tar", ["-xzf", archive, "-C", staging], {stdio: "inherit"});
    const source = path.join(staging, `zsign-${ZSIGN_RELEASE}`);
    const prefix = await opensslPrefix(options.opensslPrefix);
    execFileSync(
      "make",
      ["-C", path.join(source, "build", "macos"), ...zsignBuildArguments(prefix)],
      {stdio: "inherit"},
    );
    const built = path.join(source, "bin", "zsign");
    const dependencies = commandOutput("otool", ["-L", built]);
    if (/\/opt\/homebrew|\/usr\/local/u.test(dependencies))
      throw new Error("The built zsign binary still contains a build-machine library path.");

    await rm(pending, {recursive: true, force: true});
    await mkdir(pending, {recursive: true});
    await copyFile(built, path.join(pending, "zsign"));
    await chmod(path.join(pending, "zsign"), 0o755);
    await copyFile(path.join(source, "LICENSE"), path.join(pending, "LICENSE.zsign.txt"));
    const executableSha256 = digest(await readFile(built));
    await writeFile(
      path.join(pending, "MANIFEST.json"),
      `${JSON.stringify({
        release: ZSIGN_RELEASE,
        platform,
        arch,
        source: ZSIGN_SOURCE_URL,
        sourceSha256: ZSIGN_SOURCE_SHA256,
        executableSha256,
        staticOpenSsl: true,
      }, null, 2)}\n`,
    );
    await writeFile(path.join(pending, "VERSION"), `${runtimeStamp(platform, arch)}\n`);
    await rm(outputDirectory, {recursive: true, force: true});
    await rename(pending, outputDirectory);
  } finally {
    await rm(pending, {recursive: true, force: true});
    await rm(staging, {recursive: true, force: true});
  }
  console.log(`zsign ${runtimeStamp(platform, arch)} → ${path.relative(root, outputDirectory)}`);
  return outputDirectory;
}

async function main() {
  const output = process.argv.find((flag) => flag.startsWith("--output="))?.slice(9);
  const openssl = process.argv.find((flag) => flag.startsWith("--openssl-prefix="))?.slice(17);
  await buildPhoneZsign({
    outputDirectory: output ? path.resolve(output) : undefined,
    opensslPrefix: openssl,
    force: process.argv.includes("--force"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
