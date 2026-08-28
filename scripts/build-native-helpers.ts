#!/usr/bin/env node
/**
 * Builds every macOS Swift helper that ships with Polymux.
 *
 * Packaged users should not need Xcode Command Line Tools. Forge runs this on
 * the macOS release host, then signs the resulting Mach-O files with the rest
 * of the app. Source files remain bundled for development fallback and review.
 */

import {execFileSync} from "node:child_process";
import {createHash} from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {permissionUsagePlist} from "../apps/desktop/src/main/system/permission-usage.js";

export const NATIVE_HELPERS = [
  {name: "app-permissions", privacy: true},
  {name: "ax-events", privacy: false},
  {name: "ax-reader", privacy: false},
  {name: "calendar", privacy: true},
  {name: "contacts", privacy: true},
  {name: "pill-image", privacy: false},
  {name: "reminders", privacy: true},
  {name: "wechat-media-prepare", privacy: false},
  {name: "wechat-paste-send", privacy: false},
] as const;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(root, "resources", "native");
const outputDirectory = path.join(sourceDirectory, "bin");

async function revision(): Promise<string> {
  const hash = createHash("sha256").update("polymux-native-helpers-v1\0");
  for (const helper of NATIVE_HELPERS) {
    hash.update(helper.name).update("\0");
    hash.update(await readFile(path.join(sourceDirectory, `${helper.name}.swift`)));
  }
  hash.update(permissionUsagePlist());
  return hash.digest("hex");
}

async function ready(version: string): Promise<boolean> {
  try {
    const existing = (await readFile(path.join(outputDirectory, "VERSION"), "utf8")).trim();
    if (existing !== version) return false;
    await Promise.all(
      NATIVE_HELPERS.map(({name}) => stat(path.join(outputDirectory, name))),
    );
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error(
      `Native macOS helpers must be built on darwin-arm64, not ${process.platform}-${process.arch}`,
    );
  const version = await revision();
  if (!process.argv.includes("--force") && await ready(version)) {
    console.log("macOS native helpers already present, skipping");
    return;
  }

  const pending = path.join(sourceDirectory, `.bin.pending-${process.pid}`);
  await rm(pending, {recursive: true, force: true});
  await mkdir(pending, {recursive: true});
  try {
    const plistPath = path.join(pending, "permissions.plist");
    await writeFile(plistPath, permissionUsagePlist(), "utf8");
    for (const helper of NATIVE_HELPERS) {
      const destination = path.join(pending, helper.name);
      const linkPlist = helper.privacy
        ? [
            "-Xlinker", "-sectcreate",
            "-Xlinker", "__TEXT",
            "-Xlinker", "__info_plist",
            "-Xlinker", plistPath,
          ]
        : [];
      execFileSync(
        "swiftc",
        [
          "-O",
          "-target", "arm64-apple-macos12.0",
          "-o", destination,
          ...linkPlist,
          path.join(sourceDirectory, `${helper.name}.swift`),
        ],
        {stdio: "inherit"},
      );
      await chmod(destination, 0o755);
    }
    await rm(plistPath, {force: true});
    await writeFile(
      path.join(pending, "MANIFEST.json"),
      `${JSON.stringify({
        platform: "darwin",
        arch: "arm64",
        minimumMacOS: "12.0",
        revision: version,
        files: NATIVE_HELPERS.map(({name}) => name),
      }, null, 2)}\n`,
    );
    await writeFile(path.join(pending, "VERSION"), `${version}\n`);
    await rm(outputDirectory, {recursive: true, force: true});
    await rename(pending, outputDirectory);
  } finally {
    await rm(pending, {recursive: true, force: true});
  }
  console.log(`macOS native helpers → ${path.relative(root, outputDirectory)}`);
}

await main();
