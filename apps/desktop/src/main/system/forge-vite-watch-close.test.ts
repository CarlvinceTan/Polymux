import {strict as assert} from 'node:assert';
import {mkdtemp, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {build} from 'vite';
import {closeWatcherBundleOnError} from '../../../forge-vite-watch-close.js';

test('a failed Vite watch build still closes so Forge can leave the spinner', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'polymux-forge-watch-'));
  const entry = path.join(directory, 'missing.ts');
  await writeFile(entry, "import 'this-package-definitely-does-not-exist';\nexport const x = 1;\n");
  let watcher: ({close: () => Promise<void>} & Parameters<typeof closeWatcherBundleOnError>[0]) | undefined;
  try {
    const signal = await Promise.race([
      new Promise<string>((resolve, reject) => {
        build({
          configFile: false,
          logLevel: 'silent',
          root: directory,
          build: {
            lib: {entry, fileName: () => 'x.js', formats: ['es']},
            outDir: path.join(directory, 'out'),
            watch: {},
            minify: false,
          },
          plugins: [{
            name: 'forge-like',
            buildEnd(error) {
              if (error instanceof Error) reject(error);
            },
            closeBundle() {
              resolve('closeBundle');
            },
          }],
        }).then((result) => {
          if (result && typeof result === 'object' && 'on' in result && 'close' in result) {
            watcher = result as {close: () => Promise<void>; on: (event: string, listener: (event: {code?: string}) => void) => void};
            closeWatcherBundleOnError(watcher);
          }
        }).catch(reject);
      }),
      new Promise<string>((_, reject) => {
        setTimeout(() => reject(new Error('watch build did not close after an error')), 5_000);
      }),
    ]);
    assert.equal(signal, 'closeBundle');
  } finally {
    await watcher?.close();
  }
});
