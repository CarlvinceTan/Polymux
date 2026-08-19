import type {ForgeConfig} from '@electron-forge/shared-types';
import {MakerSquirrel} from '@electron-forge/maker-squirrel';
import {MakerZIP} from '@electron-forge/maker-zip';
import {MakerDeb} from '@electron-forge/maker-deb';
import {MakerRpm} from '@electron-forge/maker-rpm';
import {VitePlugin} from '@electron-forge/plugin-vite';
import {FusesPlugin} from '@electron-forge/plugin-fuses';
import {FuseV1Options, FuseVersion} from '@electron/fuses';
import {PERMISSION_USAGE_DESCRIPTIONS} from './src/main/system/permission-usage.js';

// Forge runs from the repo root (package.json's `config.forge` points here),
// so every path in this file is written relative to that root rather than to
// this file's own directory.
const app = 'apps/desktop';
const icon = process.platform === 'win32'
  ? `${app}/assets/appicon.ico`
  : `${app}/assets/appicon.icns`;

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
const signingIdentity = process.env.APPLE_SIGNING_IDENTITY;
const notarising = Boolean(
  signingIdentity && process.env.APPLE_ID && process.env.APPLE_ID_PASSWORD && process.env.APPLE_TEAM_ID,
);

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Everything shipped beside the code: skills, the native helpers, and the
    // mautrix binaries under `resources/bridges`. Those binaries are not in git
    // (half a gigabyte of build output); run `npm run bridges` before
    // packaging, which the prepackage hook does.
    extraResource: ['resources'],
    extendInfo: {
      NSLocationUsageDescription: 'FlareAI uses your location only when Location access is enabled in General settings.',
      NSLocationWhenInUseUsageDescription: 'FlareAI uses your location only when Location access is enabled in General settings.',
      NSMicrophoneUsageDescription: 'FlareAI uses the microphone only when you start voice input or speech mode.',
      NSSpeechRecognitionUsageDescription: 'FlareAI converts speech to text only when you start voice dictation.',
      // Reminders, Calendars, Contacts, Photos and controlling other apps. The
      // same record is linked into the native permission helper, which is what
      // actually raises these prompts: macOS kills a process that touches a
      // privacy class it has no description for, so the two must not drift.
      ...PERMISSION_USAGE_DESCRIPTIONS,
    },
    appBundleId: 'com.flarehq.flareai',
    executableName: 'FlareAI',
    icon,
    ...(signingIdentity
      ? {
          osxSign: {
            identity: signingIdentity,
            // Every Mach-O in the bundle is signed, the bridge binaries
            // included: notarisation rejects a bundle holding an executable
            // signed by anyone else, and they arrive ad-hoc signed from their
            // own releases.
            optionsForFile: () => ({
              entitlements: `${app}/assets/entitlements.plist`,
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
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
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
          `FlareAI cannot be packaged for macOS ${arch}: the bridge fleet is published ` +
            'for darwin-arm64 only, so this build would ship without messaging. ' +
            'See AGENTS.md, Packaging and signing.',
        );
      const {execFileSync} = await import('node:child_process');
      execFileSync(process.execPath, ['scripts/fetch-bridges.mjs'], {stdio: 'inherit'});
      // The skill scripts' interpreter. The RunAsNode fuse below is off, so a
      // packaged FlareAI cannot lend itself out as Node the way a dev run
      // does — it ships a real one instead.
      execFileSync(process.execPath, ['scripts/fetch-node.mjs'], {stdio: 'inherit'});
    },
  },
};

export default config;
