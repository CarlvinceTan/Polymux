import {Worker} from 'node:worker_threads';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {homedir} from 'node:os';
import type {UsageSource} from '@polymux/storage';
import type {UsageDiscoveryDto} from '@polymux/protocol';

const TTL = 10 * 60_000;
const emptySource = (): UsageSource => ({runs: [], conversations: [], toolCounts: [], skillTurns: []});

/** One lazy scan per app, shared by every Usage view. Parsing stays off the UI/main thread. */
export class LocalUsage {
  #worker: Worker | null = null;
  #source = emptySource();
  #lastAttempt = 0;
  #closed = false;
  #discovery: UsageDiscoveryDto = {status: 'scanning', updatedAt: null, detectedAgents: 0, supportedAgents: 0, estimated: false};
  constructor(private readonly dataDirectory: string) {}

  snapshot(refresh = false): {source: UsageSource; discovery: UsageDiscoveryDto} {
    if (!this.#closed && !this.#worker && (refresh || Date.now() - this.#lastAttempt > TTL)) this.#scan();
    return {source: this.#source, discovery: {...this.#discovery}};
  }

  #scan(): void {
    this.#lastAttempt = Date.now();
    this.#discovery = {...this.#discovery, status: 'scanning'};
    const fixtureHome = process.env.POLYMUX_DEV_INSTANCE ? process.env.POLYMUX_USAGE_TEST_HOME : undefined;
    // Isolates use an empty/synthetic home; they never scan the user's real logs.
    const testHome = process.env.POLYMUX_DEV_INSTANCE
      ? fixtureHome || path.join(this.dataDirectory, 'usage-test-home') : undefined;
    const env = testHome ? {
      PATH: process.env.PATH ?? '', HOME: testHome, USERPROFILE: testHome,
      XDG_CONFIG_HOME: path.join(testHome, '.config'), XDG_DATA_HOME: path.join(testHome, '.local/share'),
      XDG_STATE_HOME: path.join(testHome, '.local/state'), XDG_CACHE_HOME: path.join(testHome, '.cache'),
      APPDATA: path.join(testHome, 'AppData/Roaming'), LOCALAPPDATA: path.join(testHome, 'AppData/Local'),
    } : process.env;
    try {
      const worker = new Worker(path.join(path.dirname(fileURLToPath(import.meta.url)), 'usage-worker.js'), {
        env, workerData: {cacheDirectory: path.join(this.dataDirectory, 'usage-cache'),
          excludedRoots: [this.dataDirectory, path.join(homedir(), '.polymux')]},
        // Provider diagnostics can contain local paths; no transcript output in app logs.
        stdout: true, stderr: true,
      });
      this.#worker = worker;
      worker.stdout?.resume();
      worker.stderr?.resume();
      const timeout = setTimeout(() => { void worker.terminate(); }, 5 * 60_000);
      timeout.unref();
      let received = false;
      worker.on('message', (result: {source?: UsageSource; discovery?: UsageDiscoveryDto}) => {
        received = true;
        if (result.source && result.discovery) {
          this.#source = result.source;
          this.#discovery = result.discovery;
        } else this.#discovery = {...this.#discovery, status: 'error'};
        void worker.terminate();
      });
      worker.on('error', () => { this.#discovery = {...this.#discovery, status: 'error'}; });
      worker.on('exit', () => {
        clearTimeout(timeout);
        if (!received) this.#discovery = {...this.#discovery, status: 'error'};
        if (this.#worker === worker) this.#worker = null;
      });
    } catch {
      this.#discovery = {...this.#discovery, status: 'error'};
    }
  }

  close(): void {
    this.#closed = true;
    void this.#worker?.terminate();
    this.#worker = null;
  }
}
