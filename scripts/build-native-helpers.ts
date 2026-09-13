#!/usr/bin/env node
/**
 * Builds every macOS native helper that ships with Polymux: Swift helpers and
 * the POSIX PTY host used by the Terminal workspace app.
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
  {name: "permission-guide", privacy: false},
  {name: "reminders", privacy: true},
  {name: "wechat-media-prepare", privacy: false},
  {name: "wechat-launch-hidden", privacy: false},
  {name: "wechat-prime", privacy: false},
  {name: "wechat-session-state", privacy: false},
] as const;
const C_HELPERS = [{name: "pty-host", source: "pty-host.c"}] as const;
const CONTROL_HELPERS = [
  {name: "state", library: false},
  {name: "helper", library: true},
  {name: "window", library: true},
  {name: "background", library: true},
] as const;
const weChatPrimeLibrary = (version: string) => `libpolymux-wechat-prime-${version}.dylib`;
const weChatMessageLibrary = (version: string) => `libpolymux-wechat-message-${version}.dylib`;
const weChatKeyCaptureLibrary = (version: string) => `libpolymux-wechat-key-capture-${version}.dylib`;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = path.join(root, "resources", "native");
const wechatSourceDirectory = path.join(root, "packages", "wechat", "src", "native");
const outputDirectory = path.join(sourceDirectory, "bin");
const controlSourceDirectory = path.join(root, "resources/skills/core/control/scripts/macos");

async function controlHelpers() {
  return Promise.all(CONTROL_HELPERS.map(async (helper) => {
    const source = path.join(controlSourceDirectory, `${helper.name}.swift`);
    const digest = createHash("sha256")
      .update(helper.library ? "library\0" : "script\0")
      .update(await readFile(source)).digest("hex");
    return {...helper, source, filename: `control-${helper.name}-${digest}`};
  }));
}

function helperSourcePath(name: string): string {
  if (name.startsWith("wechat-")) {
    return path.join(wechatSourceDirectory, `${name}.swift`);
  }
  return path.join(sourceDirectory, `${name}.swift`);
}

async function revision(): Promise<string> {
  const hash = createHash("sha256").update("polymux-native-helpers-v1\0");
  for (const helper of NATIVE_HELPERS) {
    hash.update(helper.name).update("\0");
    hash.update(await readFile(helperSourcePath(helper.name)));
  }
  for (const helper of C_HELPERS) {
    hash.update(helper.name).update("\0");
    hash.update(await readFile(path.join(sourceDirectory, helper.source)));
  }
  hash.update("libpolymux-wechat-prime").update("\0");
  hash.update(await readFile(path.join(wechatSourceDirectory, "wechat-prime-inject.m")));
  hash.update("libpolymux-wechat-message").update("\0");
  hash.update(await readFile(path.join(wechatSourceDirectory, "wechat-message-service.mm")));
  hash.update(await readFile(path.join(wechatSourceDirectory, "wechat-background-safety.swift")));
  hash.update(await readFile(path.join(wechatSourceDirectory, "wechat-key-capture.c")));
  for (const helper of await controlHelpers()) hash.update(helper.filename).update("\0");
  hash.update(permissionUsagePlist());
  return hash.digest("hex");
}

async function ready(version: string): Promise<boolean> {
  try {
    const existing = (await readFile(path.join(outputDirectory, "VERSION"), "utf8")).trim();
    if (existing !== version) return false;
    await Promise.all(
      [
        ...NATIVE_HELPERS.map(({name}) => stat(path.join(outputDirectory, name))),
        ...C_HELPERS.map(({name}) => stat(path.join(outputDirectory, name))),
        ...(await controlHelpers()).map(({filename}) => stat(path.join(outputDirectory, filename))),
        stat(path.join(outputDirectory, weChatPrimeLibrary(version))),
        stat(path.join(outputDirectory, weChatMessageLibrary(version))),
        stat(path.join(outputDirectory, weChatKeyCaptureLibrary(version))),
      ],
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
      const source = helperSourcePath(helper.name);
      const needsBackgroundSafety = ["wechat-prime", "wechat-launch-hidden"].includes(helper.name);
      const mainSource = path.join(pending, "main.swift");
      if (needsBackgroundSafety) await writeFile(mainSource,
        (await readFile(path.join(wechatSourceDirectory, "wechat-background-safety.swift"), "utf8")) + "\n" + (await readFile(source, "utf8")));
      execFileSync(
        "swiftc",
        [
          "-O",
          "-target", "arm64-apple-macos12.0",
          "-o", destination,
          ...linkPlist,
          needsBackgroundSafety ? mainSource : source,
        ],
        {stdio: "inherit"},
      );
      if (needsBackgroundSafety) await rm(mainSource);
      await chmod(destination, 0o755);
    }
    for (const helper of C_HELPERS) {
      const destination = path.join(pending, helper.name);
      execFileSync(
        "cc",
        [
          "-O2",
          "-target", "arm64-apple-macos12.0",
          "-o", destination,
          path.join(sourceDirectory, helper.source),
        ],
        {stdio: "inherit"},
      );
      await chmod(destination, 0o755);
    }
    const control = await controlHelpers();
    for (const helper of control) {
      const destination = path.join(pending, helper.filename);
      execFileSync("swiftc", [
        "-O", "-target", "arm64-apple-macos12.0",
        ...(helper.library ? ["-parse-as-library"] : []),
        helper.source, "-o", destination,
      ], {stdio: "inherit"});
      await chmod(destination, 0o755);
    }
    const primeLibrary = path.join(pending, weChatPrimeLibrary(version));
    execFileSync(
      "clang",
      [
        "-O",
        "-target", "arm64-apple-macos12.0",
        "-fobjc-arc",
        "-dynamiclib",
        "-framework", "AppKit",
        "-framework", "Foundation",
        "-install_name", `@rpath/${weChatPrimeLibrary(version)}`,
        `-DPOLYMUX_NATIVE_HELPER_REVISION="${version}"`,
        "-o", primeLibrary,
        path.join(wechatSourceDirectory, "wechat-prime-inject.m"),
      ],
      {stdio: "inherit"},
    );
    await chmod(primeLibrary, 0o755);
    const keyCaptureLibrary = path.join(pending, weChatKeyCaptureLibrary(version));
    execFileSync("clang", [
      "-O2", "-target", "arm64-apple-macos12.0", "-dynamiclib",
      "-install_name", `@rpath/${weChatKeyCaptureLibrary(version)}`,
      path.join(wechatSourceDirectory, "wechat-key-capture.c"), "-o", keyCaptureLibrary,
    ], {stdio: "inherit"});
    await chmod(keyCaptureLibrary, 0o755);
    execFileSync("clang++", [
      "-O", "-std=c++17", "-target", "arm64-apple-macos12.0",
      "-fobjc-arc", "-dynamiclib", "-framework", "Foundation",
      "-install_name", `@rpath/${weChatMessageLibrary(version)}`,
      `-DPOLYMUX_NATIVE_HELPER_REVISION="${version}"`,
      "-framework", "CoreGraphics",
      "-o", path.join(pending, weChatMessageLibrary(version)),
      path.join(wechatSourceDirectory, "wechat-message-service.mm"),
    ], {stdio: "inherit"});
    await rm(plistPath, {force: true});
    await writeFile(
      path.join(pending, "MANIFEST.json"),
      `${JSON.stringify({
        platform: "darwin",
        arch: "arm64",
        minimumMacOS: "12.0",
        revision: version,
        files: [
          ...NATIVE_HELPERS.map(({name}) => name),
          ...C_HELPERS.map(({name}) => name),
          ...control.map(({filename}) => filename),
          weChatPrimeLibrary(version),
          weChatMessageLibrary(version),
          weChatKeyCaptureLibrary(version),
        ],
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
