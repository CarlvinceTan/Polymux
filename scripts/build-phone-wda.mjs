#!/usr/bin/env node
/** Build the unsigned WebDriverAgent app shipped on every desktop platform.
 *
 * Only release/build infrastructure needs Xcode. End users receive this
 * already-compiled app and sign it locally for their own iPhone with go-ios.
 */

import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
  chmod,
  cp,
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

export const WDA_RELEASE = "16.11.4";
export const WDA_BUNDLE_ID = "com.flarehq.polymux.wda";
export const WDA_PATCH_LEVEL = 1;
const WDA_ARCHIVE = `https://registry.npmjs.org/appium-webdriveragent/-/appium-webdriveragent-${WDA_RELEASE}.tgz`;
const WDA_ARCHIVE_SHA256 = "3dcd8b4e9005d1b6396bec7c75d316451751c77190c430f0ff412e8f68c905ea";
const RUNNER_APP = "WebDriverAgentRunner-Runner.app";
const SOURCE_METADATA = "WDA_SOURCE.json";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export function wdaBuildArguments(source, derivedData) {
  return [
    "-project", path.join(source, "WebDriverAgent.xcodeproj"),
    "-scheme", "WebDriverAgentRunner",
    "-sdk", "iphoneos",
    "-destination", "generic/platform=iOS",
    "-derivedDataPath", derivedData,
    "CODE_SIGNING_ALLOWED=NO",
    "CODE_SIGNING_REQUIRED=NO",
    `PRODUCT_BUNDLE_IDENTIFIER=${WDA_BUNDLE_ID}`,
    "COMPILER_INDEX_STORE_ENABLE=NO",
    "build-for-testing",
  ];
}

async function ready(outputDirectory) {
  try {
    const metadata = JSON.parse(await readFile(path.join(outputDirectory, "WDA_SOURCE.json"), "utf8"));
    if (
      metadata.release !== WDA_RELEASE ||
      metadata.archiveSha256 !== WDA_ARCHIVE_SHA256 ||
      metadata.patchLevel !== WDA_PATCH_LEVEL ||
      metadata.bundleId !== `${WDA_BUNDLE_ID}.xctrunner`
    ) return false;
    await Promise.all([
      stat(path.join(outputDirectory, RUNNER_APP, "Info.plist")),
      stat(path.join(outputDirectory, RUNNER_APP, "WebDriverAgentRunner-Runner")),
      stat(path.join(outputDirectory, RUNNER_APP, "PlugIns", "WebDriverAgentRunner.xctest")),
      stat(path.join(outputDirectory, RUNNER_APP, SOURCE_METADATA)),
      stat(path.join(outputDirectory, "LICENSE.WebDriverAgent.txt")),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** WDA 16.11.4 asks XCTest for JPEG at screenshot quality 1/2, then converts
 * the result back to PNG unconditionally. Preserve the selected UTI and
 * compression quality so Phone can carry small frames over a wireless route. */
export function patchWdaScreenshotEncoding(source) {
  const original = `return [[[FBImageProcessor alloc] init] scaledImageWithData:screenshotData
                                                          uti:UTTypePNG
                                                scalingFactor:1.0 / scale
                                           compressionQuality:FBMaxCompressionQuality
                                                        error:error];`;
  const replacement = `return [[[FBImageProcessor alloc] init] scaledImageWithData:screenshotData
                                                          uti:uti
                                                scalingFactor:1.0 / scale
                                           compressionQuality:compressionQuality
                                                        error:error];`;
  const first = source.indexOf(original);
  if (first < 0 || source.indexOf(original, first + original.length) >= 0)
    throw new Error("WebDriverAgent screenshot patch no longer matches the pinned source");
  return source.replace(original, replacement);
}

async function pruneDebugArtifacts(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const target = path.join(directory, entry.name);
    if (entry.name === "_CodeSignature" || entry.name === "embedded.mobileprovision" || entry.name.endsWith(".dSYM")) {
      await rm(target, {recursive: true, force: true});
    } else if (entry.isDirectory()) {
      await pruneDebugArtifacts(target);
    }
  }
}

export async function buildPhoneWda(options = {}) {
  if (process.platform !== "darwin")
    throw new Error("The unsigned iPhone WDA runtime must be built on macOS with Xcode.");
  const outputDirectory = options.outputDirectory ?? path.join(root, "resources", "phone", "ios");
  if (!options.force && await ready(outputDirectory)) {
    console.log(`iPhone WDA ${WDA_RELEASE} already present, skipping`);
    return path.join(outputDirectory, RUNNER_APP);
  }

  console.log(`building unsigned WebDriverAgent ${WDA_RELEASE}`);
  const archiveBytes = await fetchBytes(WDA_ARCHIVE);
  if (digest(archiveBytes) !== WDA_ARCHIVE_SHA256)
    throw new Error("WebDriverAgent package sha256 mismatch");

  const staging = await mkdtemp(path.join(tmpdir(), "polymux-phone-wda-"));
  const target = path.join(outputDirectory, RUNNER_APP);
  const pending = path.join(outputDirectory, `.${RUNNER_APP}.pending-${process.pid}`);
  try {
    const archive = path.join(staging, `appium-webdriveragent-${WDA_RELEASE}.tgz`);
    await writeFile(archive, archiveBytes);
    execFileSync("tar", ["-xzf", archive, "-C", staging], {stdio: "inherit"});
    const source = path.join(staging, "package");
    const screenshotSource = path.join(source, "WebDriverAgentLib", "Utilities", "FBScreenshot.m");
    await writeFile(
      screenshotSource,
      patchWdaScreenshotEncoding(await readFile(screenshotSource, "utf8")),
    );
    const derivedData = path.join(staging, "DerivedData");
    try {
      execFileSync("xcodebuild", wdaBuildArguments(source, derivedData), {
        encoding: "utf8",
        maxBuffer: 128 * 1024 * 1024,
      });
    } catch (reason) {
      const error = reason;
      const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`.trim().split(/\r?\n/).slice(-80).join("\n");
      throw new Error(output || error.message);
    }
    const built = path.join(derivedData, "Build", "Products", "Debug-iphoneos", RUNNER_APP);
    await stat(path.join(built, "PlugIns", "WebDriverAgentRunner.xctest"));
    await mkdir(outputDirectory, {recursive: true});
    await rm(pending, {recursive: true, force: true});
    await cp(built, pending, {recursive: true, force: true, preserveTimestamps: true});
    await pruneDebugArtifacts(pending);
    await chmod(path.join(pending, "WebDriverAgentRunner-Runner"), 0o755);
    const metadata = `${JSON.stringify({
      release: WDA_RELEASE,
      package: WDA_ARCHIVE,
      archiveSha256: WDA_ARCHIVE_SHA256,
      patchLevel: WDA_PATCH_LEVEL,
      bundleId: `${WDA_BUNDLE_ID}.xctrunner`,
      signed: false,
    }, null, 2)}\n`;
    await writeFile(path.join(pending, SOURCE_METADATA), metadata);
    await rm(target, {recursive: true, force: true});
    await rename(pending, target);
    await cp(path.join(source, "LICENSE"), path.join(outputDirectory, "LICENSE.WebDriverAgent.txt"));
    await writeFile(path.join(outputDirectory, SOURCE_METADATA), metadata);
  } finally {
    await rm(pending, {recursive: true, force: true});
    await rm(staging, {recursive: true, force: true});
  }
  console.log(`iPhone WDA ${WDA_RELEASE} → ${path.relative(root, target)}`);
  return target;
}

async function main() {
  const output = process.argv.find((flag) => flag.startsWith("--output="))?.slice(9);
  await buildPhoneWda({
    outputDirectory: output ? path.resolve(output) : undefined,
    force: process.argv.includes("--force"),
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
