import './forge-vite-watch-close.js';
import type {ForgeConfig} from '@electron-forge/shared-types';
import {MakerSquirrel} from '@electron-forge/maker-squirrel';
import {MakerZIP} from '@electron-forge/maker-zip';
import {MakerDMG} from '@electron-forge/maker-dmg';
import {VitePlugin} from '@electron-forge/plugin-vite';
import {FusesPlugin} from '@electron-forge/plugin-fuses';
import {FuseV1Options, FuseVersion} from '@electron/fuses';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {X509Certificate} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {PERMISSION_USAGE_DESCRIPTIONS} from './src/main/system/permission-usage.js';

// Forge runs from the repo root (package.json's `config.forge` points here),
// so every path in this file is written relative to that root rather than to
// this file's own directory.
const app = 'apps/desktop';
const appBundleId = 'com.flarehq.polymux';
const version = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
const icon = process.platform === 'win32'
  ? `${app}/assets/appicon.ico`
  : process.platform === 'darwin'
    ? `${app}/assets/appicon.icns`
    : `${app}/assets/appicon.png`;

/**
 * Signing is switched on by the environment, not by editing this file. Without
 * a Developer ID the app is ad-hoc signed, which is fine for running a build
 * locally and fatal for shipping one: Gatekeeper refuses a downloaded app that
 * is not signed and notarised, and macOS keys permission grants to the signing
 * identity, so an ad-hoc build asks for microphone and accessibility again
 * after every update.
 *
 * When the certificate exists, set these and nothing else changes:
 *
 *   APPLE_SIGNING_IDENTITY="Developer ID Application: Name (TEAMID)"
 *   APPLE_ID=you@example.com          # notarisation, optional
 *   APPLE_ID_PASSWORD=abcd-efgh-...   # an app-specific password
 *   APPLE_TEAM_ID=TEAMID
 *
 * Notarisation is separate on purpose: signing alone is enough to keep TCC
 * grants stable on the machine that built it, and notarising costs a round
 * trip to Apple that a local build does not need.
 */
/** A stable local development signature is enough for Keychain-backed
 * safeStorage and persistent macOS permissions. Prefer an explicitly supplied
 * release identity, then use an installed Apple Development/Polymux Dev
 * identity for local packages. CI machines without either remain ad-hoc. */
function localSigningIdentity(): string | undefined {
  if (process.platform !== 'darwin') return undefined;
  try {
    const listing = execFileSync('security', ['find-identity', '-p', 'codesigning', '-v'], {encoding: 'utf8'});
    return listing.match(/^\s*\d+\)\s+[0-9A-F]{40}\s+"((?:Polymux Dev|Apple Development)[^"]*)"/m)?.[1];
  } catch {
    return undefined;
  }
}

const releaseSigningIdentity = process.env.APPLE_SIGNING_IDENTITY;
const signingIdentity = releaseSigningIdentity ?? localSigningIdentity();

/** The display name's parenthesised value is not reliably the certificate's
 * team identifier (Apple Development certificates can differ). The OU in the
 * actual signing certificate is the value codesign writes as TeamIdentifier. */
function teamIdentifierFor(identity: string | undefined): string | undefined {
  if (!identity || process.platform !== 'darwin') return undefined;
  try {
    const certificate = execFileSync(
      'security',
      ['find-certificate', '-c', identity, '-p'],
      {encoding: 'utf8'},
    );
    return /^OU=([A-Z0-9]+)$/m.exec(new X509Certificate(certificate).subject)?.[1];
  } catch {
    return undefined;
  }
}

/** Injects the one entitlement whose value is necessarily build-specific.
 * Keeping the checked-in plist free of a developer's team id lets local Apple
 * Development packages and Developer ID releases both receive a valid group. */
function signingEntitlements(teamId: string | undefined): string {
  const sourcePath = `${app}/assets/entitlements.plist`;
  if (!teamId) return sourcePath;
  const group = `${teamId}.${appBundleId}.webauthn`;
  const source = readFileSync(sourcePath, 'utf8');
  const directory = mkdtempSync(path.join(tmpdir(), 'polymux-entitlements-'));
  const target = path.join(directory, 'entitlements.plist');
  writeFileSync(
    target,
    source.replace(
      '</dict>',
      `  <key>keychain-access-groups</key>\n  <array>\n    <string>${group}</string>\n  </array>\n</dict>`,
    ),
  );
  process.once('exit', () => rmSync(directory, {recursive: true, force: true}));
  return target;
}

const signingTeamId = signingIdentity
  ? (process.env.APPLE_TEAM_ID ?? teamIdentifierFor(signingIdentity))
  : undefined;
if (signingIdentity && !signingTeamId)
  throw new Error(
    `Could not determine the Apple team identifier for signing identity ${signingIdentity}. ` +
      'Set APPLE_TEAM_ID explicitly so the main app receives its WebAuthn keychain entitlement.',
  );
const entitlements = signingEntitlements(signingTeamId);

/** Only the application process uses the WebAuthn keychain group. Electron's
 * helpers and bundled native tools receive their normal hardened-runtime
 * signatures without inheriting that privileged application entitlement. */
function isMainApplication(filePath: string): boolean {
  return path.basename(filePath) === 'Polymux.app';
}
const notarising = Boolean(
  releaseSigningIdentity && process.env.APPLE_ID && process.env.APPLE_ID_PASSWORD && process.env.APPLE_TEAM_ID,
);

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Local benchmark builds can carry a distinct numeric bundle build without
    // changing the product version. The window-control registry keys launch
    // evidence to this value, so a repaired binary never inherits either trust
    // or quarantine from the binary it replaced.
    ...(process.env.POLYMUX_BUILD_VERSION
      ? {buildVersion: process.env.POLYMUX_BUILD_VERSION}
      : {}),
    // Everything shipped beside the code: skills, the native helpers, and the
    // mautrix binaries under `resources/bridges`. Those binaries are not in git
    // (half a gigabyte of build output); run `npm run bridges` before
    // packaging, which the prepackage hook does.
    extraResource: process.platform === 'darwin'
      ? ['resources', 'scripts/wechat/wxcdn_fileid_capture.py']
      : ['resources'],
    extendInfo: {
      NSLocationUsageDescription: 'Polymux uses your location only when Location access is enabled in General settings.',
      NSLocationWhenInUseUsageDescription: 'Polymux uses your location only when Location access is enabled in General settings.',
      NSCameraUsageDescription: 'Polymux uses the camera only when you scan a device pairing QR code.',
      NSMicrophoneUsageDescription: 'Polymux uses the microphone only when you start voice input or speech mode.',
      NSSpeechRecognitionUsageDescription: 'Polymux converts speech to text only when you start voice dictation.',
      // Reminders, Calendars, Contacts, Photos and controlling other apps. The
      // same record is linked into the native permission helper, which is what
      // actually raises these prompts: macOS kills a process that touches a
      // privacy class it has no description for, so the two must not drift.
      ...PERMISSION_USAGE_DESCRIPTIONS,
    },
    appBundleId,
    // electron-installer-debian and electron-installer-redhat derive their
    // payload binary from package.json.name. Keep that internal Linux filename
    // aligned; productName still presents the app as Polymux everywhere.
    executableName: process.platform === 'linux' ? 'polymux-desktop' : 'Polymux',
    icon,
    ...(signingIdentity
      ? {
          osxSign: {
            identity: signingIdentity,
            // Every Mach-O in the bundle is signed, the bridge binaries
            // included: notarisation rejects a bundle holding an executable
            // signed by anyone else, and they arrive ad-hoc signed from their
            // own releases.
            optionsForFile: (filePath) => ({
              ...(isMainApplication(filePath) ? {entitlements} : {}),
              hardenedRuntime: true,
            }),
          },
        }
      : {}),
    ...(notarising
      ? {
          osxNotarize: {
            appleId: process.env.APPLE_ID!,
            appleIdPassword: process.env.APPLE_ID_PASSWORD!,
            teamId: process.env.APPLE_TEAM_ID!,
          },
        }
      : {}),
  },
  rebuildConfig: {},
  makers: [
    // The downloaded file carries its version; after installation the app
    // itself remains the clean `Polymux.exe` configured above.
    new MakerSquirrel({setupExe: `Polymux-${version}-Setup.exe`}),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({format: 'ULFO'}, ['darwin']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: `${app}/src/main/main.ts`,
          config: `${app}/vite.main.config.ts`,
          target: 'main',
        },
        {
          entry: `${app}/src/preload/preload.ts`,
          config: `${app}/vite.preload.config.ts`,
          target: 'preload',
        },
        {
          // The second preload runs inside embedded browser tabs rather than
          // the app window: Electron ships no credential autofill, so finding
          // and filling login forms has to happen in the page itself.
          entry: `${app}/src/preload/autofill.ts`,
          config: `${app}/vite.preload.config.ts`,
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: `${app}/vite.renderer.config.ts`,
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
  hooks: {
    /**
     * The bridges are pinned downloads rather than checked-in files, so the
     * bundle is only complete if they have been fetched. Doing it here means a
     * plain `npm run make` cannot quietly ship an app with no messaging.
     */
    async prePackage(_config, platform, arch) {
      // Refused rather than warned: an Intel macOS build would package and
      // open perfectly well, and have no messaging in it, because upstream
      // publishes no darwin-amd64 bridge binaries at all.
      if (platform === 'darwin' && arch !== 'arm64')
        throw new Error(
          `Polymux cannot be packaged for macOS ${arch}: the bridge fleet is published ` +
            'for darwin-arm64 only, so this build would ship without messaging. ' +
            'See AGENTS.md, Packaging and signing.',
        );
      const {execFileSync} = await import('node:child_process');
      execFileSync(
        process.execPath,
        ['scripts/fetch-bridges.mjs', `--platform=${platform}`, `--arch=${arch}`],
        {stdio: 'inherit'},
      );
      if (platform === 'darwin')
        {
          execFileSync(
            process.execPath,
            ['--import', 'tsx', 'scripts/build-native-helpers.ts'],
            {stdio: 'inherit'},
          );
          execFileSync(
            process.execPath,
            ['scripts/wechat/build-wechat-writer.mjs'],
            {stdio: 'inherit'},
          );
        }
      else {
        rmSync('resources/native/bin', {recursive: true, force: true});
        rmSync('resources/wechat-writer', {recursive: true, force: true});
      }
      execFileSync(
        process.execPath,
        ['scripts/fetch-whisper.mjs', `--platform=${platform}`, `--arch=${arch}`],
        {stdio: 'inherit'},
      );
      execFileSync(
        process.execPath,
        ['scripts/phone/fetch-phone-tools.mjs', `--platform=${platform}`, `--arch=${arch}`],
        {stdio: 'inherit'},
      );
      execFileSync(
        process.execPath,
        ['scripts/phone/fetch-phone-ios-tools.mjs', `--platform=${platform}`, `--arch=${arch}`],
        {stdio: 'inherit'},
      );
      execFileSync(
        process.execPath,
        ['scripts/phone/build-phone-ios-signer-runtime.mjs'],
        {stdio: 'inherit'},
      );
      execFileSync(
        process.execPath,
        ['scripts/phone/build-phone-ios-device.mjs'],
        {stdio: 'inherit'},
      );
      if (platform === 'darwin') {
        execFileSync(process.execPath, ['scripts/phone/build-phone-wda.mjs'], {stdio: 'inherit'});
      } else if (!existsSync('resources/phone/ios/WebDriverAgentRunner-Runner.app')) {
        throw new Error(
          'The cross-platform package is missing the unsigned WebDriverAgent artifact. ' +
            'Build it on macOS with `npm run phone:wda` and copy resources/phone/ios before packaging.',
        );
      }
      // The skill scripts' interpreter. The RunAsNode fuse below is off, so a
      // packaged Polymux cannot lend itself out as Node the way a dev run
      // does — it ships a real one instead.
      execFileSync(process.execPath, ['scripts/fetch-node.mjs'], {stdio: 'inherit'});
    },
  },
};

export default config;
