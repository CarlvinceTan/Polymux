#!/usr/bin/env node
/**
 * Prepares the pinned whisper.cpp runtime bundled with Polymux.
 *
 * Windows and Linux use the official release archives. Upstream publishes a
 * macOS XCFramework but not the command-line/server executables Polymux runs,
 * so the arm64 macOS runtime is built from the pinned, hash-verified source
 * archive. End users never need whisper.cpp, CMake, Homebrew or a CLI on PATH.
 */

import {createHash} from "node:crypto";
import {execFileSync} from "node:child_process";
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

export const WHISPER_RELEASE = "b4938";
export const WHISPER_SOURCE_SHA256 =
  "6d8d70a014ca2b10f8a6d006b8f423e5f5ef2afcfbe92b57ab4e01107238112a";
const WHISPER_LICENSE_SHA256 =
  "94f29bbed6a22c35b992c5c6ebf0e7c92f13b836b90f36f461c9cf2f0f1d010d";

export const WHISPER_ARCHIVES = {
  "win32-x64": {
    name: "whisper-bin-x64.zip",
    sha256: "c2a4b60edb11f7e11a9191ffb50929535527d4d91c9903dbe3e554583bbbc63d",
    directory: "Release",
  },
  "linux-x64": {
    name: "whisper-bin-ubuntu-x64.tar.gz",
    sha256: "f4cfc1f969a13805908fb72043ce7cc896eb42e0b8afbe841dc8e7298923b061",
    directory: "whisper-bin-ubuntu-x64",
  },
  "linux-arm64": {
    name: "whisper-bin-ubuntu-arm64.tar.gz",
    sha256: "94a33318650c57cc3d9a91439e0e3f0b94ba96bacd34203a06db395cf9204e40",
    directory: "whisper-bin-ubuntu-arm64",
  },
};

export const WINDOWS_RUNTIME_FILES = [
  "whisper-cli.exe",
  "whisper-server.exe",
  "whisper.dll",
  "ggml.dll",
  "ggml-base.dll",
  "ggml-cpu-alderlake.dll",
  "ggml-cpu-cannonlake.dll",
  "ggml-cpu-cascadelake.dll",
  "ggml-cpu-haswell.dll",
  "ggml-cpu-icelake.dll",
  "ggml-cpu-sandybridge.dll",
  "ggml-cpu-skylakex.dll",
  "ggml-cpu-sse42.dll",
  "ggml-cpu-x64.dll",
];

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export function whisperTarget(platform, arch) {
  const key = `${platform}-${arch}`;
  if (platform === "darwin" && arch === "arm64") {
    return {
      kind: "source",
      archive: `whisper.cpp-${WHISPER_RELEASE}.tar.gz`,
      sha256: WHISPER_SOURCE_SHA256,
      url: `https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/refs/tags/${WHISPER_RELEASE}`,
    };
  }
  const archive = WHISPER_ARCHIVES[key];
  if (!archive)
    throw new Error(`No bundled whisper.cpp runtime for ${key}`);
  return {
    kind: "archive",
    archive: archive.name,
    sha256: archive.sha256,
    directory: archive.directory,
    url:
      `https://github.com/ggml-org/whisper.cpp/releases/download/` +
      `${WHISPER_RELEASE}/${archive.name}`,
  };
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function runtimeStamp(platform, arch) {
  return `${WHISPER_RELEASE}-${platform}-${arch}`;
}

async function ready(outputDirectory, platform, arch) {
  try {
    const stamp = (await readFile(path.join(outputDirectory, "VERSION"), "utf8")).trim();
    const manifest = JSON.parse(
      await readFile(path.join(outputDirectory, "MANIFEST.json"), "utf8"),
    );
    if (
      stamp !== runtimeStamp(platform, arch) ||
      manifest.release !== WHISPER_RELEASE ||
      manifest.platform !== platform ||
      manifest.arch !== arch ||
      !Array.isArray(manifest.files) ||
      manifest.files.length < 2
    ) return false;
    await Promise.all(
      [...manifest.files, "LICENSE.whisper.cpp.txt"].map((name) =>
        stat(path.join(outputDirectory, name)),
      ),
    );
    return true;
  } catch {
    return false;
  }
}

async function archiveRuntime(staging, target, platform) {
  const releaseDirectory = path.join(staging, target.directory);
  if (platform === "win32") return WINDOWS_RUNTIME_FILES.map((name) => ({
    name,
    source: path.join(releaseDirectory, name),
  }));

  const names = (await readdir(releaseDirectory)).filter((name) =>
    name === "whisper-cli" ||
    name === "whisper-server" ||
    /^lib(?:whisper|ggml).*\.so(?:\..*)?$/u.test(name),
  );
  if (!names.includes("whisper-cli") || !names.includes("whisper-server"))
    throw new Error(`${target.archive}: whisper executables are missing`);
  return names.map((name) => ({name, source: path.join(releaseDirectory, name)}));
}

function buildMacRuntime(staging) {
  const source = path.join(staging, `whisper.cpp-${WHISPER_RELEASE}`);
  const build = path.join(staging, "build-macos-arm64");
  execFileSync(
    "cmake",
    [
      "-S", source,
      "-B", build,
      "-DCMAKE_BUILD_TYPE=Release",
      "-DCMAKE_OSX_ARCHITECTURES=arm64",
      "-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0",
      "-DBUILD_SHARED_LIBS=OFF",
      "-DGGML_STATIC=ON",
      "-DGGML_NATIVE=OFF",
      "-DGGML_OPENMP=OFF",
      "-DGGML_BLAS=OFF",
      "-DGGML_CCACHE=OFF",
      "-DGGML_METAL=ON",
      "-DGGML_METAL_EMBED_LIBRARY=ON",
      "-DWHISPER_BUILD_TESTS=OFF",
      "-DWHISPER_BUILD_EXAMPLES=ON",
      "-DWHISPER_BUILD_SERVER=ON",
    ],
    {stdio: "inherit"},
  );
  execFileSync(
    "cmake",
    ["--build", build, "--config", "Release", "--target", "whisper-cli", "whisper-server", "-j"],
    {stdio: "inherit"},
  );
  return ["whisper-cli", "whisper-server"].map((name) => ({
    name,
    source: path.join(build, "bin", name),
  }));
}

export async function fetchWhisper(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const target = whisperTarget(platform, arch);
  const outputDirectory = options.outputDirectory ??
    path.join(root, "resources", "whisper");
  const force = options.force === true;

  if (!force && await ready(outputDirectory, platform, arch)) {
    console.log(`whisper.cpp ${runtimeStamp(platform, arch)} already present, skipping`);
    return outputDirectory;
  }
  if (target.kind === "source" && (platform !== process.platform || arch !== process.arch))
    throw new Error(`Building whisper.cpp for ${platform}-${arch} requires that host`);

  console.log(`fetching ${target.archive} (${WHISPER_RELEASE})`);
  const [archiveBytes, licenseBytes] = await Promise.all([
    fetchBytes(target.url),
    fetchBytes(
      `https://raw.githubusercontent.com/ggml-org/whisper.cpp/` +
        `${WHISPER_RELEASE}/LICENSE`,
    ),
  ]);
  const archiveHash = digest(archiveBytes);
  if (archiveHash !== target.sha256)
    throw new Error(
      `${target.archive}: sha256 mismatch\n` +
        `  expected ${target.sha256}\n  actual   ${archiveHash}`,
    );
  const licenseHash = digest(licenseBytes);
  if (licenseHash !== WHISPER_LICENSE_SHA256)
    throw new Error(`whisper.cpp LICENSE: sha256 mismatch (${licenseHash})`);

  const staging = await mkdtemp(path.join(tmpdir(), "polymux-whisper-"));
  const pending = path.join(
    path.dirname(outputDirectory),
    `.${path.basename(outputDirectory)}.pending-${process.pid}`,
  );
  try {
    const archivePath = path.join(staging, target.archive);
    await writeFile(archivePath, archiveBytes);
    execFileSync(
      "tar",
      [target.archive.endsWith(".tar.gz") ? "-xzf" : "-xf", archivePath, "-C", staging],
      {stdio: "inherit"},
    );
    const files = target.kind === "source"
      ? buildMacRuntime(staging)
      : await archiveRuntime(staging, target, platform);
    await Promise.all(files.map(({source}) => stat(source)));

    await rm(pending, {recursive: true, force: true});
    await mkdir(pending, {recursive: true});
    for (const {name, source} of files) {
      const destination = path.join(pending, name);
      await copyFile(source, destination);
      await chmod(
        destination,
        name === "whisper-cli" || name === "whisper-server" || name.endsWith(".exe")
          ? 0o755
          : 0o644,
      );
    }
    await writeFile(path.join(pending, "LICENSE.whisper.cpp.txt"), licenseBytes);
    await writeFile(
      path.join(pending, "MANIFEST.json"),
      `${JSON.stringify({
        release: WHISPER_RELEASE,
        platform,
        arch,
        sourceSha256: target.sha256,
        files: files.map(({name}) => name).sort(),
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
    `whisper.cpp ${runtimeStamp(platform, arch)} → ${path.relative(root, outputDirectory)}`,
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
  const output = process.argv
    .find((flag) => flag.startsWith("--output="))
    ?.slice(9);
  await fetchWhisper({
    platform,
    arch,
    outputDirectory: output ? path.resolve(output) : undefined,
    force: process.argv.includes("--force"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
