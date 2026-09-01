#!/usr/bin/env node
/**
 * Prepares the pinned Android phone runtime bundled with Polymux.
 *
 * Genymobile's official scrcpy archives already contain matching ADB and
 * scrcpy binaries (plus the Windows DLLs they need). Normalising those
 * archives here keeps Phone usable without Android Studio, a package manager,
 * or anything on PATH. Downloads are pinned and hash verified before they are
 * copied into the application resources.
 */

import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {fileURLToPath} from "node:url";

export const SCRCPY_RELEASE = "4.1";

export const PHONE_TOOL_ARCHIVES = {
  "darwin-arm64": {
    archive: `scrcpy-macos-aarch64-v${SCRCPY_RELEASE}.tar.gz`,
    directory: `scrcpy-macos-aarch64-v${SCRCPY_RELEASE}`,
    sha256: "20fd47c9014dd5e0fa77091f3cb7adbda8445a360c4584aeaa0150b5b3988ff3",
  },
  "darwin-x64": {
    archive: `scrcpy-macos-x86_64-v${SCRCPY_RELEASE}.tar.gz`,
    directory: `scrcpy-macos-x86_64-v${SCRCPY_RELEASE}`,
    sha256: "ee2a7223bc8dbdc4f482db1134bcf441178dafb833492b71ca4c22090c58ce72",
  },
  "linux-x64": {
    archive: `scrcpy-linux-x86_64-v${SCRCPY_RELEASE}.tar.gz`,
    directory: `scrcpy-linux-x86_64-v${SCRCPY_RELEASE}`,
    sha256: "ad56ae8bfeedf41e824945c11dbf55fcb092b3e615b9b486f48a50e30d389635",
  },
  "win32-x64": {
    archive: `scrcpy-win64-v${SCRCPY_RELEASE}.zip`,
    directory: `scrcpy-win64-v${SCRCPY_RELEASE}`,
    sha256: "5b12172b3264b2889f4583ee64752ce832e29bc8b1089dca81093459697165db",
  },
};

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function phoneToolsTarget(platform, arch) {
  const key = `${platform}-${arch}`;
  const target = PHONE_TOOL_ARCHIVES[key];
  if (!target)
    throw new Error(`No pinned Android phone runtime for ${key}`);
  return {
    ...target,
    url:
      `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_RELEASE}/` +
      target.archive,
  };
}

/** Select only runtime files. Documentation launchers and icons do not belong
 * in the app; Windows DLLs do because both adb.exe and scrcpy.exe load them. */
export function phoneRuntimeFileNames(names, platform) {
  const required = platform === "win32"
    ? ["adb.exe", "scrcpy.exe", "scrcpy-server"]
    : ["adb", "scrcpy", "scrcpy-server"];
  const available = new Set(names);
  for (const name of required) {
    if (!available.has(name)) throw new Error(`scrcpy archive is missing ${name}`);
  }
  const dlls = platform === "win32"
    ? names.filter((name) => name.toLowerCase().endsWith(".dll"))
    : [];
  const license = platform === "win32" ? "LICENSE.txt" : "LICENSE";
  if (!available.has(license)) throw new Error("scrcpy archive is missing its license");
  return [...required, ...dlls.sort(), license];
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
  return `${SCRCPY_RELEASE}-${platform}-${arch}`;
}

async function ready(outputDirectory, platform, arch) {
  try {
    const stamp = (await readFile(path.join(outputDirectory, "VERSION"), "utf8")).trim();
    const manifest = JSON.parse(await readFile(path.join(outputDirectory, "MANIFEST.json"), "utf8"));
    if (
      stamp !== runtimeStamp(platform, arch) ||
      manifest.release !== SCRCPY_RELEASE ||
      manifest.platform !== platform ||
      manifest.arch !== arch ||
      !Array.isArray(manifest.files) ||
      manifest.files.length < 4
    ) return false;
    await Promise.all(manifest.files.map((name) => stat(path.join(outputDirectory, name))));
    return true;
  } catch {
    return false;
  }
}

export async function fetchPhoneTools(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = phoneToolsTarget(platform, arch);
  const outputDirectory = options.outputDirectory ??
    path.join(root, "resources", "phone", "android");
  if (!options.force && await ready(outputDirectory, platform, arch)) {
    console.log(`Android phone tools ${runtimeStamp(platform, arch)} already present, skipping`);
    return outputDirectory;
  }

  console.log(`fetching ${target.archive} (${SCRCPY_RELEASE})`);
  const archiveBytes = await fetchBytes(target.url);
  const archiveHash = digest(archiveBytes);
  if (archiveHash !== target.sha256)
    throw new Error(
      `${target.archive}: sha256 mismatch\n` +
        `  expected ${target.sha256}\n  actual   ${archiveHash}`,
    );

  const staging = await mkdtemp(path.join(tmpdir(), "polymux-phone-android-"));
  const pending = path.join(
    path.dirname(outputDirectory),
    `.${path.basename(outputDirectory)}.pending-${process.pid}`,
  );
  try {
    const archivePath = path.join(staging, target.archive);
    await writeFile(archivePath, archiveBytes);
    execFileSync("tar", ["-xf", archivePath, "-C", staging], {stdio: "inherit"});
    const sourceDirectory = path.join(staging, target.directory);
    const names = await readdir(sourceDirectory);
    const files = phoneRuntimeFileNames(names, platform);

    await rm(pending, {recursive: true, force: true});
    await mkdir(pending, {recursive: true});
    const installed = [];
    for (const name of files) {
      const installedName = name.startsWith("LICENSE") ? "LICENSE.scrcpy.txt" : name;
      const destination = path.join(pending, installedName);
      await copyFile(path.join(sourceDirectory, name), destination);
      const executable = installedName === "adb" || installedName === "scrcpy" ||
        installedName.endsWith(".exe");
      await chmod(destination, executable ? 0o755 : 0o644);
      installed.push(installedName);
    }
    await writeFile(
      path.join(pending, "MANIFEST.json"),
      `${JSON.stringify({
        release: SCRCPY_RELEASE,
        platform,
        arch,
        sourceArchive: target.archive,
        sourceSha256: target.sha256,
        files: [...installed, "MANIFEST.json", "VERSION"].sort(),
      }, null, 2)}\n`,
    );
    await writeFile(path.join(pending, "VERSION"), `${runtimeStamp(platform, arch)}\n`);
    await rm(outputDirectory, {recursive: true, force: true});
    await rename(pending, outputDirectory);
  } finally {
    await rm(pending, {recursive: true, force: true});
    await rm(staging, {recursive: true, force: true});
  }
  console.log(
    `Android phone tools ${runtimeStamp(platform, arch)} → ${path.relative(root, outputDirectory)}`,
  );
  return outputDirectory;
}

async function main() {
  const platform =
    process.argv.find((flag) => flag.startsWith("--platform="))?.slice(11) ??
    process.platform;
  const arch =
    process.argv.find((flag) => flag.startsWith("--arch="))?.slice(7) ??
    process.arch;
  const output = process.argv.find((flag) => flag.startsWith("--output="))?.slice(9);
  await fetchPhoneTools({
    platform,
    arch,
    outputDirectory: output ? path.resolve(output) : undefined,
    force: process.argv.includes("--force"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
