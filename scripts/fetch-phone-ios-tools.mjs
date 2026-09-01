#!/usr/bin/env node
/**
 * Prepares the pinned go-ios runtime bundled with Polymux.
 *
 * go-ios is a single MIT-licensed executable that covers device discovery,
 * userspace iOS 17+ tunnels, app installation, XCUITest launch, port
 * forwarding, and recursive WDA signing on macOS, Windows, and Linux. The npm
 * release carries all supported binaries; this script verifies the package
 * and selected executable before installing only the current target.
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
  writeFile,
} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const GO_IOS_RELEASE = "1.3.2";
const GO_IOS_PACKAGE = `https://registry.npmjs.org/go-ios/-/go-ios-${GO_IOS_RELEASE}.tgz`;
const GO_IOS_PACKAGE_SHA256 = "c7c5fcb984347a954741cd78e40e0c39fd5985dababcadbbc40cdb08d8e8630a";
const GO_IOS_LICENSE = `https://raw.githubusercontent.com/danielpaulus/go-ios/v${GO_IOS_RELEASE}/LICENSE`;
const GO_IOS_LICENSE_SHA256 = "d368be6f632f8f928369c6f1923cf2f884a1ae42a5f0dd218acd96f9bcfa75b4";

export const GO_IOS_TARGETS = {
  "darwin-arm64": {
    source: "package/dist/go-ios-darwin-arm64_darwin_arm64/ios",
    executable: "ios",
    sha256: "0b841d42da8d98141efcb0a63f0abab90c86b36e7b90011b1b68eee2c2d1c234",
  },
  "darwin-x64": {
    source: "package/dist/go-ios-darwin-amd64_darwin_amd64/ios",
    executable: "ios",
    sha256: "0b841d42da8d98141efcb0a63f0abab90c86b36e7b90011b1b68eee2c2d1c234",
  },
  "linux-arm64": {
    source: "package/dist/go-ios-linux-arm64_linux_arm64/ios",
    executable: "ios",
    sha256: "ae0553a2c74e1271b55ca90f317030df14eb6a141208002b6905ca4b2d6afe1b",
  },
  "linux-x64": {
    source: "package/dist/go-ios-linux-amd64_linux_amd64/ios",
    executable: "ios",
    sha256: "24d6149a9d9ab65e17e55313312bcc59c98a7d51d692f9c37b0a0ba26f57623e",
  },
  "win32-x64": {
    source: "package/dist/go-ios-windows-amd64_windows_amd64/ios.exe",
    executable: "ios.exe",
    sha256: "c99b04f1d615fa716637efae457d5c554f32259f9d249375de0086e3cc1a1df5",
  },
};

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function goIosTarget(platform, arch) {
  const key = `${platform}-${arch}`;
  const target = GO_IOS_TARGETS[key];
  if (!target) throw new Error(`No pinned iOS phone runtime for ${key}`);
  return target;
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function runtimeStamp(platform, arch) {
  return `${GO_IOS_RELEASE}-${platform}-${arch}`;
}

async function ready(outputDirectory, platform, arch, target) {
  try {
    const stamp = (await readFile(path.join(outputDirectory, "VERSION"), "utf8")).trim();
    const manifest = JSON.parse(await readFile(path.join(outputDirectory, "MANIFEST.json"), "utf8"));
    if (
      stamp !== runtimeStamp(platform, arch) ||
      manifest.release !== GO_IOS_RELEASE ||
      manifest.platform !== platform ||
      manifest.arch !== arch ||
      manifest.executableSha256 !== target.sha256
    ) return false;
    const executable = await readFile(path.join(outputDirectory, target.executable));
    return digest(executable) === target.sha256;
  } catch {
    return false;
  }
}

export async function fetchPhoneIosTools(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = goIosTarget(platform, arch);
  const outputDirectory = options.outputDirectory ?? path.join(root, "resources", "phone", "ios", "tools");
  if (!options.force && await ready(outputDirectory, platform, arch, target)) {
    console.log(`iOS phone tools ${runtimeStamp(platform, arch)} already present, skipping`);
    return outputDirectory;
  }

  console.log(`fetching go-ios ${GO_IOS_RELEASE}`);
  const [archiveBytes, licenseBytes] = await Promise.all([
    fetchBytes(GO_IOS_PACKAGE),
    fetchBytes(GO_IOS_LICENSE),
  ]);
  if (digest(archiveBytes) !== GO_IOS_PACKAGE_SHA256)
    throw new Error("go-ios package sha256 mismatch");
  if (digest(licenseBytes) !== GO_IOS_LICENSE_SHA256)
    throw new Error("go-ios license sha256 mismatch");

  const staging = await mkdtemp(path.join(tmpdir(), "polymux-phone-ios-"));
  const pending = path.join(
    path.dirname(outputDirectory),
    `.${path.basename(outputDirectory)}.pending-${process.pid}`,
  );
  try {
    const archivePath = path.join(staging, `go-ios-${GO_IOS_RELEASE}.tgz`);
    await writeFile(archivePath, archiveBytes);
    execFileSync("tar", ["-xzf", archivePath, "-C", staging], {stdio: "inherit"});
    const source = path.join(staging, target.source);
    const executableBytes = await readFile(source);
    if (digest(executableBytes) !== target.sha256)
      throw new Error(`${target.executable}: sha256 mismatch`);

    await rm(pending, {recursive: true, force: true});
    await mkdir(pending, {recursive: true});
    await copyFile(source, path.join(pending, target.executable));
    await chmod(path.join(pending, target.executable), 0o755);
    await writeFile(path.join(pending, "LICENSE.go-ios.txt"), licenseBytes, {mode: 0o644});
    await writeFile(
      path.join(pending, "MANIFEST.json"),
      `${JSON.stringify({
        release: GO_IOS_RELEASE,
        platform,
        arch,
        package: GO_IOS_PACKAGE,
        packageSha256: GO_IOS_PACKAGE_SHA256,
        executable: target.executable,
        executableSha256: target.sha256,
        files: [target.executable, "LICENSE.go-ios.txt", "MANIFEST.json", "VERSION"].sort(),
      }, null, 2)}\n`,
    );
    await writeFile(path.join(pending, "VERSION"), `${runtimeStamp(platform, arch)}\n`);
    await rm(outputDirectory, {recursive: true, force: true});
    await rename(pending, outputDirectory);
  } finally {
    await rm(pending, {recursive: true, force: true});
    await rm(staging, {recursive: true, force: true});
  }
  console.log(`iOS phone tools ${runtimeStamp(platform, arch)} → ${path.relative(root, outputDirectory)}`);
  return outputDirectory;
}

async function main() {
  const platform = process.argv.find((flag) => flag.startsWith("--platform="))?.slice(11) ?? process.platform;
  const arch = process.argv.find((flag) => flag.startsWith("--arch="))?.slice(7) ?? process.arch;
  const output = process.argv.find((flag) => flag.startsWith("--output="))?.slice(9);
  await fetchPhoneIosTools({
    platform,
    arch,
    outputDirectory: output ? path.resolve(output) : undefined,
    force: process.argv.includes("--force"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
