/**
 * Rebrands the development Electron bundle as "Midas.app".
 *
 * `app.setName` fixes the menu bar, but the macOS Dock names a tile from the
 * bundle and executable identity of the process — editing CFBundleName alone
 * verifiably does not change the hover label. So the dev bundle is renamed
 * wholesale: Electron.app -> Midas.app, its executable Electron -> Midas,
 * CFBundleExecutable updated, and electron's `path.txt` launcher indirection
 * pointed at the new location. The bundle is ad-hoc re-signed because both
 * edits invalidate the signature.
 *
 * Runs as `prestart`: a no-op when already applied, self-healing after
 * `npm install` restores the stock bundle. The packaged app is unaffected.
 */
import {execFileSync} from 'node:child_process';
import {copyFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

if (process.platform !== 'darwin') process.exit(0);

const NAME = 'Midas';
const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const electronDir = path.join(projectRoot, 'node_modules/electron');
const dist = path.join(electronDir, 'dist');
const pathFile = path.join(electronDir, 'path.txt');
const stockApp = path.join(dist, 'Electron.app');
const brandedApp = path.join(dist, `${NAME}.app`);
const PLIST_BUDDY = '/usr/libexec/PlistBuddy';

if (!existsSync(pathFile) || !existsSync(PLIST_BUDDY)) process.exit(0);

const wanted = `${NAME}.app/Contents/MacOS/${NAME}`;
const appIcon = path.join(projectRoot, 'assets/appicon.icns');
const bundleIcon = () => path.join(brandedApp, 'Contents/Resources/electron.icns');

/** The Dock draws the tile from the bundle's own .icns once the bundle is the
 * app's identity, so the rebrand must carry the icon as well as the name. */
const syncIcon = () => {
  if (!existsSync(appIcon) || !existsSync(bundleIcon())) return false;
  if (statSync(appIcon).size === statSync(bundleIcon()).size) return false;
  copyFileSync(appIcon, bundleIcon());
  return true;
};

const resign = () => {
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', brandedApp], {stdio: 'ignore'});
  } catch {
    // An unsigned dev bundle still launches locally; the rename is what matters.
  }
};

if (existsSync(brandedApp) && readFileSync(pathFile, 'utf8').trim() === wanted) {
  if (syncIcon()) {
    resign();
    console.log(`Refreshed the ${NAME}.app development icon.`);
  }
  process.exit(0);
}
if (!existsSync(stockApp)) process.exit(0);

const plistSet = (key, value) => {
  const plist = path.join(brandedApp, 'Contents/Info.plist');
  try {
    execFileSync(PLIST_BUDDY, ['-c', `Set :${key} ${value}`, plist]);
  } catch {
    execFileSync(PLIST_BUDDY, ['-c', `Add :${key} string ${value}`, plist]);
  }
};

renameSync(stockApp, brandedApp);
renameSync(
  path.join(brandedApp, 'Contents/MacOS/Electron'),
  path.join(brandedApp, `Contents/MacOS/${NAME}`),
);
plistSet('CFBundleExecutable', NAME);
plistSet('CFBundleName', NAME);
plistSet('CFBundleDisplayName', NAME);
syncIcon();
writeFileSync(pathFile, wanted);
resign();
console.log(`Rebranded the development Electron bundle as ${NAME}.app.`);
