import type {ForgeConfig} from '@electron-forge/shared-types';
import {MakerSquirrel} from '@electron-forge/maker-squirrel';
import {MakerZIP} from '@electron-forge/maker-zip';
import {MakerDeb} from '@electron-forge/maker-deb';
import {MakerRpm} from '@electron-forge/maker-rpm';
import {VitePlugin} from '@electron-forge/plugin-vite';
import {FusesPlugin} from '@electron-forge/plugin-fuses';
import {FuseV1Options, FuseVersion} from '@electron/fuses';

const icon = process.platform === 'win32'
  ? 'assets/appicon.ico'
  : 'assets/appicon.icns';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // `bridges` holds the mautrix binaries fetched by scripts/fetch-bridges.mjs.
    // They are not in git (half a gigabyte of build output); run
    // `npm run bridges:fetch` before packaging, which the prepackage hook does.
    extraResource: ['skills', 'native', 'bridges'],
    extendInfo: {
      NSLocationUsageDescription: 'FlareAI uses your location only when Location access is enabled in General settings.',
      NSLocationWhenInUseUsageDescription: 'FlareAI uses your location only when Location access is enabled in General settings.',
      NSMicrophoneUsageDescription: 'FlareAI uses the microphone only when you start voice input or speech mode.',
      NSSpeechRecognitionUsageDescription: 'FlareAI converts speech to text only when you start voice dictation.',
    },
    appBundleId: 'com.flarehq.flareai',
    executableName: 'FlareAI',
    icon,
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
          entry: 'src/main/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
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
    async prePackage() {
      const {execFileSync} = await import('node:child_process');
      execFileSync(process.execPath, ['scripts/fetch-bridges.mjs'], {stdio: 'inherit'});
    },
  },
};

export default config;
