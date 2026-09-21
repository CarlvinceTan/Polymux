import assert from 'node:assert/strict';
import {test} from 'node:test';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {Worker} from 'node:worker_threads';
import type {UsageSource} from '@polymux/storage';
import type {UsageDiscoveryDto} from '@polymux/protocol';

// Exercise the shipped bundle, including dynamic adapters and Worker HOME
// isolation. No real agent histories or credentials are needed by this test.
test('bundled global scan discovers local logs, deduplicates archives, and excludes managed homes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'polymux-usage-test-'));
  try {
    const home = path.join(directory, 'home');
    const sessions = path.join(home, '.codex/sessions/2026/09/15');
    const archived = path.join(home, '.codex/archived_sessions');
    await mkdir(sessions, {recursive: true});
    await mkdir(archived, {recursive: true});
    const rows: unknown[] = [
      {type: 'session_meta', timestamp: '2026-09-15T10:00:00Z', payload: {session_id: 'fixture', cwd: directory, model: 'gpt-5'}},
      {type: 'turn_context', timestamp: '2026-09-15T10:00:00Z', payload: {model: 'gpt-5'}},
    ];
    for (let i = 1; i <= 3; i++) rows.push({type: 'event_msg', timestamp: `2026-09-15T10:0${i}:00Z`, payload: {type: 'token_count', info: {total_token_usage: {
      input_tokens: 1000 * i, cached_input_tokens: 400 * i, output_tokens: 200 * i, reasoning_output_tokens: 100 * i, total_tokens: 1200 * i,
    }}}});
    rows.push(rows.at(-1));
    const jsonl = rows.map(row => JSON.stringify(row)).join('\n') + '\n';
    await writeFile(path.join(sessions, 'rollout-fixture.jsonl'), jsonl);
    await writeFile(path.join(archived, 'rollout-fixture.jsonl'), jsonl);
    await writeFile(path.join(directory, 'package.json'), JSON.stringify({type: 'module'}));
    const output = path.join(directory, 'build');
    execFileSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--config', 'apps/desktop/vite.usage.config.ts', '--outDir', output], {stdio: 'pipe'});
    const scan = (excludedRoots: string[], suffix: string) => new Promise<{source: UsageSource; discovery: UsageDiscoveryDto}>((resolve, reject) => {
      const worker = new Worker(path.join(output, 'usage-worker.js'), {
        execArgv: [],
        env: {HOME: home, USERPROFILE: home, PATH: process.env.PATH ?? '',
          XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'),
          XDG_STATE_HOME: path.join(home, '.local/state'), APPDATA: path.join(home, 'AppData'), LOCALAPPDATA: path.join(home, 'LocalAppData')},
        workerData: {cacheDirectory: path.join(directory, `cache-${suffix}`), excludedRoots},
      });
      const timeout = setTimeout(() => { void worker.terminate(); reject(new Error('Scan did not finish')); }, 30_000);
      worker.on('message', result => { clearTimeout(timeout); void worker.terminate().then(() => resolve(result)); });
      worker.on('error', error => { clearTimeout(timeout); reject(error); });
    });
    const global = await scan([], 'global');
    assert.equal(global.discovery.status, 'ready');
    assert.equal(global.discovery.detectedAgents, 1);
    assert.equal(global.discovery.supportedAgents, 40);
    assert.equal(global.source.runs.reduce((sum, row) => sum + Number((row.usage as {totalTokens: number}).totalTokens), 0), 3600);
    assert.equal(global.source.runs.reduce((sum, row) => sum + (row.runCount ?? 1), 0), 3);
    const excluded = await scan([home], 'excluded');
    assert.equal(excluded.discovery.detectedAgents, 0);
    assert.equal(excluded.source.runs.length, 0);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
