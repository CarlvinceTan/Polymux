/**
 * Rebrands the development Electron bundle as "Polymux.app".
 *
 * `app.setName` fixes the menu bar, but the macOS Dock names a tile from the
 * bundle and executable identity of the process — editing CFBundleName alone
 * verifiably does not change the hover label. So the dev bundle is renamed
 * wholesale: Electron.app -> Polymux.app, its executable Electron -> Polymux,
 * CFBundleExecutable updated, and electron's `path.txt` launcher indirection
 * pointed at the new location. The bundle is ad-hoc re-signed because both
 * edits invalidate the signature.
 *
 * Runs as `prestart`: a no-op when already applied, self-healing after
 * `npm install` restores the stock bundle. The packaged app is unaffected.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_BUNDLE_ID, devIconResourceName } from "./dev-bundle-identity.mjs";

if (process.platform !== "darwin") process.exit(0);

const NAME = "Polymux";
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const electronDir = path.join(projectRoot, "node_modules/electron");
const dist = path.join(electronDir, "dist");
const pathFile = path.join(electronDir, "path.txt");
const brandedApp = path.join(dist, `${NAME}.app`);
const PLIST_BUDDY = "/usr/libexec/PlistBuddy";

/**
 * The bundle to rebrand: normally the stock Electron.app, but after the app is
 * renamed a checkout still carries the *previous* brand's bundle. Adopting
 * whatever single .app is in dist means a rename does not need a clean
 * `npm install` to take effect — otherwise the rebrand silently no-ops and the
 * Dock keeps showing the old name.
 */
const sourceApp = () => {
  const stock = path.join(dist, "Electron.app");
  if (existsSync(stock)) return stock;
  if (!existsSync(dist)) return undefined;
  const apps = readdirSync(dist).filter((entry) => entry.endsWith(".app"));
  return apps.length === 1 ? path.join(dist, apps[0]) : undefined;
};

if (!existsSync(pathFile)) {
  throw new Error(
    "Electron is not installed correctly: node_modules/electron/path.txt is missing. Run npm install before starting Polymux.",
  );
}
if (!existsSync(PLIST_BUDDY)) {
  throw new Error(
    "Cannot prepare the Polymux development bundle: PlistBuddy is unavailable.",
  );
}

const wanted = `${NAME}.app/Contents/MacOS/${NAME}`;
const appIcon = path.join(projectRoot, "apps/desktop/assets/appicon.icns");
const plist = () => path.join(brandedApp, "Contents/Info.plist");
const resources = () => path.join(brandedApp, "Contents/Resources");

const plistValue = (key) => {
  const result = spawnSync(PLIST_BUDDY, ["-c", `Print :${key}`, plist()], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
};

const plistEnsure = (key, value) => {
  if (plistValue(key) === value) return false;
  try {
    execFileSync(PLIST_BUDDY, ["-c", `Set :${key} ${value}`, plist()]);
  } catch {
    execFileSync(PLIST_BUDDY, ["-c", `Add :${key} string ${value}`, plist()]);
  }
  return true;
};

/** The Dock draws the tile from the bundle's own .icns once the bundle is the
 * app's identity, so the rebrand must carry the icon as well as the name. */
const syncIcon = () => {
  if (!existsSync(appIcon)) {
    throw new Error(
      `Cannot start with a stale icon: the current source icon is missing at ${appIcon}.`,
    );
  }
  if (!existsSync(resources())) {
    throw new Error(
      `Cannot update the development icon: bundle resources are missing at ${resources()}.`,
    );
  }
  const bytes = readFileSync(appIcon);
  const resourceName = devIconResourceName(bytes);
  const target = path.join(resources(), resourceName);
  const changed = !existsSync(target) || !bytes.equals(readFileSync(target));
  if (changed) copyFileSync(appIcon, target);
  const metadataChanged = plistEnsure("CFBundleIconFile", resourceName);
  return changed || metadataChanged;
};

/** Refresh Launch Services after bundle metadata or icon contents change. */
const registerBundle = () => {
  const lsregister =
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";
  try {
    const now = new Date();
    utimesSync(brandedApp, now, now);
    if (existsSync(lsregister)) {
      spawnSync(lsregister, ["-u", brandedApp], { stdio: "ignore" });
      spawnSync(lsregister, ["-f", brandedApp], { stdio: "ignore" });
    }
  } catch {
    // Registration is a cache refresh only; the correctly branded bundle can
    // still launch if Launch Services is unavailable.
  }
};

/**
 * Ad-hoc signatures get a new identity on every resign, which invalidates the
 * Keychain ACL guarding Electron's "Safe Storage" key — each icon tweak used
 * to break saved API keys until the user re-approved access. A stable local
 * identity (Apple Development, or a self-signed "Polymux Dev" certificate)
 * keeps the same designated requirement across resigns, so one "Always
 * Allow" lasts. Ad-hoc remains the fallback when no identity exists.
 */
const signingIdentity = () => {
  try {
    const listing = execFileSync(
      "security",
      ["find-identity", "-p", "codesigning", "-v"],
      { encoding: "utf8" },
    );
    const match = listing.match(
      /^\s*\d+\)\s+([0-9A-F]{40})\s+"((?:Polymux Dev|Apple Development)[^"]*)"/m,
    );
    return match
      ? { hash: match[1], authority: match[2] }
      : { hash: "-", authority: undefined };
  } catch {
    return { hash: "-", authority: undefined };
  }
};

const currentSigningIdentity = () => {
  const result = spawnSync("codesign", ["-dv", "--verbose=4", brandedApp], {
    encoding: "utf8",
  });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
};

const needsStableResign = (identity) => {
  if (!identity.authority) return false;
  return !currentSigningIdentity().includes(`Authority=${identity.authority}`);
};

const resign = (identity = signingIdentity()) => {
  try {
    execFileSync(
      "codesign",
      ["--force", "--deep", "--sign", identity.hash, brandedApp],
      { stdio: "ignore" },
    );
  } catch {
    // An unsigned dev bundle still launches locally; the rename is what matters.
  }
};

if (
  existsSync(brandedApp) &&
  readFileSync(pathFile, "utf8").trim() === wanted
) {
  const metadataChanged = plistEnsure("CFBundleIdentifier", DEV_BUNDLE_ID);
  const iconChanged = syncIcon();
  const identity = signingIdentity();
  const signatureChanged = needsStableResign(identity);
  if (metadataChanged || iconChanged || signatureChanged) {
    resign(identity);
    registerBundle();
  }
  if (iconChanged) {
    console.log(`Refreshed the ${NAME}.app development icon.`);
  }
  if (signatureChanged) {
    console.log(
      `Migrated the ${NAME}.app development signature to a stable identity.`,
    );
  }
  process.exit(0);
}
const source = sourceApp();
if (!source) {
  throw new Error(
    `Cannot prepare the Polymux development bundle: expected exactly one Electron app in ${dist}.`,
  );
}

renameSync(source, brandedApp);
// The executable inside carries the bundle's old identity, whatever that was.
const macOS = path.join(brandedApp, "Contents/MacOS");
const [executable] = readdirSync(macOS);
if (executable !== NAME) {
  renameSync(path.join(macOS, executable), path.join(macOS, NAME));
}
plistEnsure("CFBundleExecutable", NAME);
plistEnsure("CFBundleName", NAME);
plistEnsure("CFBundleDisplayName", NAME);
plistEnsure("CFBundleIdentifier", DEV_BUNDLE_ID);
syncIcon();
writeFileSync(pathFile, wanted);
resign();
registerBundle();
console.log(`Rebranded the development Electron bundle as ${NAME}.app.`);
