#!/usr/bin/env node

import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {
  SURFACE_PROTOCOL,
  negotiateSurfaceProtocol,
} from "../packages/browser/src/protocol.js";
import {
  compareStoreVersions,
  parseStoreVersion,
} from "./browser-compatibility.mjs";

const manifest = JSON.parse(readFileSync("apps/extension/manifest.json", "utf8"));

function fail(message) {
  console.error(`Browser compatibility check failed: ${message}`);
  process.exit(1);
}

function validatePeer(peer, label) {
  if (!Number.isInteger(peer.minVersion) || !Number.isInteger(peer.maxVersion) ||
      peer.minVersion < 1 || peer.minVersion > peer.maxVersion)
    fail(`${label} protocol range is invalid.`);
  for (const field of ["capabilities"]) {
    if (!Array.isArray(peer[field]) ||
        peer[field].some((value) => typeof value !== "string" || value.length === 0) ||
        new Set(peer[field]).size !== peer[field].length)
      fail(`${label} ${field} must contain unique, non-empty strings.`);
  }
}

try {
  parseStoreVersion(manifest.version);
  parseStoreVersion(
    SURFACE_PROTOCOL.minimumPublishedExtension.version,
    "Minimum published extension version",
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
validatePeer(SURFACE_PROTOCOL.desktop, "Desktop");
validatePeer(SURFACE_PROTOCOL.extension, "Extension");
validatePeer(
  SURFACE_PROTOCOL.minimumPublishedExtension,
  "Minimum published extension",
);
if (!Array.isArray(SURFACE_PROTOCOL.desktop.requiredExtensionCapabilities))
  fail("Desktop required extension capabilities are invalid.");
if (!Array.isArray(SURFACE_PROTOCOL.extension.requiredDesktopCapabilities))
  fail("Extension required desktop capabilities are invalid.");

const negotiation = negotiateSurfaceProtocol(SURFACE_PROTOCOL.extension);
if (!negotiation.compatible)
  fail(`source desktop and extension are incompatible: ${negotiation.reason}`);
const publishedNegotiation = negotiateSurfaceProtocol(
  SURFACE_PROTOCOL.minimumPublishedExtension,
);
if (!publishedNegotiation.compatible)
  fail(
    `minimum published extension does not satisfy the desktop: ${publishedNegotiation.reason}`,
  );
const desktopCapabilities = new Set(SURFACE_PROTOCOL.desktop.capabilities);
const missingDesktop = SURFACE_PROTOCOL.extension.requiredDesktopCapabilities
  .filter((capability) => !desktopCapabilities.has(capability));
if (missingDesktop.length > 0)
  fail(`desktop is missing extension requirements: ${missingDesktop.join(", ")}`);
if (compareStoreVersions(
  SURFACE_PROTOCOL.minimumPublishedExtension.version,
  manifest.version,
) > 0)
  fail("minimum published extension version is newer than the package manifest.");

const baseArgument = process.argv.find((entry) => entry.startsWith("--base="));
if (baseArgument) {
  const base = baseArgument.slice("--base=".length);
  let previousManifest;
  try {
    previousManifest = JSON.parse(execFileSync(
      "git",
      ["show", `${base}:apps/extension/manifest.json`],
      {encoding: "utf8"},
    ));
  } catch {
    fail(`could not read the extension manifest at ${base}.`);
  }
  let source = null;
  try {
    execFileSync("git", ["cat-file", "-e", `${base}^{commit}`], {stdio: "ignore"});
  } catch {
    fail(`could not inspect the base commit ${base}.`);
  }
  try {
    source = execFileSync(
      "git",
      ["show", `${base}:packages/browser/src/protocol.js`],
      {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]},
    );
  } catch {
    let listed;
    try {
      listed = execFileSync(
        "git",
        ["ls-tree", "--name-only", base, "packages/browser/src/protocol.js"],
        {encoding: "utf8", stdio: ["ignore", "pipe", "ignore"]},
      ).trim();
    } catch {
      fail(`could not inspect the browser protocol at ${base}.`);
    }
    if (listed) fail(`could not read the browser protocol at ${base}.`);
    // A valid pre-negotiation base can genuinely lack this file.
    source = null;
  }
  let baseProtocol;
  if (source === null) {
    // The first negotiated release follows the known protocol-1 desktop.
    baseProtocol = {desktop: {
      minVersion: 1,
      maxVersion: 1,
      capabilities: ["surface-feed-v1"],
      requiredExtensionCapabilities: ["surface-commands-v1"],
    }};
  } else {
    try {
      baseProtocol = (await import(
        `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`
      )).SURFACE_PROTOCOL;
    } catch (error) {
      fail(`could not load the browser protocol at ${base}: ${error}`);
    }
  }
  const previousDesktop = negotiateSurfaceProtocol(
    SURFACE_PROTOCOL.extension,
    baseProtocol.desktop,
  );
  if (!previousDesktop.compatible)
    fail(
      `extension would break the previously released desktop: ${previousDesktop.reason}`,
    );
  const previousDesktopCapabilities = new Set(baseProtocol.desktop.capabilities);
  const missingForExtension = SURFACE_PROTOCOL.extension.requiredDesktopCapabilities
    .filter((capability) => !previousDesktopCapabilities.has(capability));
  if (missingForExtension.length > 0)
    fail(
      `extension requires capabilities absent from the previously released desktop: ${missingForExtension.join(", ")}`,
    );
  const packageInputs = [
    "apps/extension/background.js",
    "apps/extension/content.js",
    "apps/extension/lib",
    "apps/extension/icons",
    "apps/extension/manifest.json",
    "packages/browser/src",
    "scripts/package-chrome-extension.sh",
  ];
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", base, "--", ...packageInputs],
    {encoding: "utf8"},
  ).trim();
  if (changed && compareStoreVersions(manifest.version, previousManifest.version) <= 0)
    fail(
      `extension package changes require a version newer than ${previousManifest.version}; found ${manifest.version}.`,
    );
}

console.log(JSON.stringify({
  extensionVersion: manifest.version,
  minimumPublishedExtensionVersion:
    SURFACE_PROTOCOL.minimumPublishedExtension.version,
  negotiatedProtocolVersion: negotiation.negotiatedVersion,
}));
