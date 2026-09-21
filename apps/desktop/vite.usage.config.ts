import path from 'node:path';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import {nodeBuiltins, workspacePackageAliases} from './vite.main.config.js';

const appRoot = path.dirname(fileURLToPath(import.meta.url));
const license = readFileSync(path.join(appRoot, 'src/main/usage/codeburn/LICENSE'), 'utf8');
export default defineConfig({
  root: path.join(appRoot, '../..'),
  resolve: {alias: workspacePackageAliases()},
  build: {
    rolldownOptions: {platform: 'node', external: nodeBuiltins, output: {codeSplitting: false, banner: `/*! CodeBurn\n${license}*/`}},
    lib: {entry: path.join(appRoot, 'src/main/usage/usage-worker.ts'), fileName: () => 'usage-worker.js', formats: ['es']},
  },
});
