/**
 * Electron Forge's Vite plugin finishes the "Building … target" spinner from
 * the first watch build's `closeBundle` hook. Rolldown does not call
 * `event.result.close()` on ERROR, so that hook never runs and `npm start`
 * hangs. Close the failed bundle so Forge can leave the spinner.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);

type WatchEvent = {
  code?: string;
  result?: {close?: () => unknown};
};

export function closeWatcherBundleOnError(watcher: {
  on(event: string, listener: (event: WatchEvent) => void): void;
}): void {
  watcher.on('event', (event) => {
    if (event.code === 'ERROR') void event.result?.close?.();
  });
}

export function ensureForgeViteWatchClosesOnError(): void {
  const pluginPath = require.resolve('@electron-forge/plugin-vite/dist/VitePlugin.js');
  const source = readFileSync(pluginPath, 'utf8');
  if (source.includes('event.result?.close?.()')) return;
  const needle = "if (event.code === 'ERROR' &&";
  if (!source.includes(needle)) {
    throw new Error(
      'Could not patch @electron-forge/plugin-vite to close failed watch builds. ' +
        'npm start will hang on a main-process bundle error.',
    );
  }
  writeFileSync(
    pluginPath,
    source.replace(
      needle,
      "if (event.code === 'ERROR') {\n                        event.result?.close?.();\n                    }\n                    if (event.code === 'ERROR' &&",
    ),
  );
}

ensureForgeViteWatchClosesOnError();
