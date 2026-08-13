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
    extraResource: ['skills'],
    extendInfo: {
      NSLocationUsageDescription: 'Midas uses your location only when Location access is enabled in General settings.',
      NSLocationWhenInUseUsageDescription: 'Midas uses your location only when Location access is enabled in General settings.',
      NSMicrophoneUsageDescription: 'Midas uses the microphone only when you start voice input or speech mode.',
      NSSpeechRecognitionUsageDescription: 'Midas converts speech to text only when you start voice dictation.',
    },
    appBundleId: 'com.polymux.midas',
    executableName: 'Midas',
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
};

export default config;
