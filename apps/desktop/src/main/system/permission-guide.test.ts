import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import test from 'node:test';
import {build} from 'esbuild';

// Exercise the process lifecycle without starting AppKit or changing OS grants.
async function fixture() {
  let granted = false;
  let failSpawn = false;
  let binaryWait = Promise.resolve();
  const children: Array<EventEmitter & {stdout: PassThrough; stderr: PassThrough; kills: number; kill(): void}> = [];
  const key = `__permissionGuideTest${Math.random().toString(36).slice(2)}`;
  const state = {
    app: {getPath: () => '/Applications/Polymux.app/Contents/MacOS/Polymux'},
    systemPreferences: {getMediaAccessStatus: () => granted ? 'granted' : 'denied'},
    SwiftHelper: class {async binary() {await binaryWait; return '/permission-guide';}},
    spawn: (_binary: string, args: string[]) => {
      assert.equal(args[0], '/Applications/Polymux.app');
      assert.equal(args[1], String(process.pid));
      const child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(), stderr: new PassThrough(), kills: 0,
        kill() {this.kills++; this.emit('exit', 0);},
      });
      children.push(child);
      queueMicrotask(() => failSpawn ? child.emit('error', new Error('spawn failed')) : child.stdout.write('ready\n'));
      return child;
    },
  };
  (globalThis as Record<string, unknown>)[key] = state;
  const bundle = await build({
    entryPoints: ['apps/desktop/src/main/system/permission-guide.ts'], bundle: true,
    write: false, platform: 'node', format: 'esm',
    plugins: [{name: 'permission-guide-fixtures', setup(builder) {
      builder.onResolve({filter: /^(electron|node:child_process|\.\/swift-helper\.js)$/}, args => ({path: args.path, namespace: 'fixture'}));
      builder.onLoad({filter: /.*/, namespace: 'fixture'}, args => {
        const names = args.path === 'electron' ? 'app, systemPreferences' : args.path === 'node:child_process' ? 'spawn' : 'SwiftHelper';
        return {contents: `export const {${names}} = globalThis[${JSON.stringify(key)}];`, loader: 'js'};
      });
    }}],
  });
  const module = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0]!.text).toString('base64')}`);
  return {
    guide: new module.PermissionGuide('/source.swift', '/cache'), children,
    permissionAppBundle: module.permissionAppBundle as (path: string) => string,
    grant: () => {granted = true;},
    fail: (value: boolean) => {failSpawn = value;},
    delayBuild: (value: Promise<void>) => {binaryWait = value;},
    cleanup: () => {delete (globalThis as Record<string, unknown>)[key];},
  };
}

test('the drag payload identifies the running bundle and rejects loose executables', async () => {
  const f = await fixture();
  try {
    assert.equal(f.permissionAppBundle('/a build/Polymux.app/Contents/MacOS/Polymux'), '/a build/Polymux.app');
    assert.throws(() => f.permissionAppBundle('/usr/local/bin/polymux'), /bundle could not be found/);
  } finally {f.cleanup();}
});

test('repeated clicks share one panel and shutdown terminates its exact child', {skip: process.platform !== 'darwin'}, async () => {
  const f = await fixture();
  try {
    await Promise.all([f.guide.open(), f.guide.open()]);
    await f.guide.open();
    assert.equal(f.children.length, 1);
    f.guide.close();
    assert.equal(f.children[0]!.kills, 1);
    await f.guide.open();
    assert.equal(f.children.length, 1);
  } finally {f.guide.close(); f.cleanup();}
});

test('a failed launch can be retried and a dismissed panel can be reopened', {skip: process.platform !== 'darwin'}, async () => {
  const f = await fixture();
  try {
    f.fail(true);
    await assert.rejects(f.guide.open(), /spawn failed/);
    f.fail(false);
    await f.guide.open();
    f.children[1]!.emit('exit', 0);
    await f.guide.open();
    assert.equal(f.children.length, 3);
  } finally {f.guide.close(); f.cleanup();}
});

test('an existing screen grant never launches a helper', {skip: process.platform !== 'darwin'}, async () => {
  const f = await fixture();
  try {
    f.grant();
    await f.guide.open();
    assert.equal(f.children.length, 0);
  } finally {f.guide.close(); f.cleanup();}
});

test('leaving Screen Recording during compilation cancels the panel without poisoning the next click', {skip: process.platform !== 'darwin'}, async () => {
  const f = await fixture();
  try {
    let finishBuild!: () => void;
    f.delayBuild(new Promise<void>(resolve => {finishBuild = resolve;}));
    const cancelled = f.guide.open();
    f.guide.dismiss();
    const reopened = f.guide.open();
    finishBuild();
    await Promise.all([cancelled, reopened]);
    assert.equal(f.children.length, 1);
  } finally {f.guide.close(); f.cleanup();}
});

test('a newly detected screen grant dismisses the helper', {skip: process.platform !== 'darwin'}, async () => {
  const f = await fixture();
  try {
    await f.guide.open();
    const exited = new Promise<void>(resolve => f.children[0]!.once('exit', () => resolve()));
    f.grant();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([exited, new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new Error('Granted panel did not close')), 3000);
      })]);
    } finally {clearTimeout(deadline);}
    assert.equal(f.children[0]!.kills, 1);
  } finally {f.guide.close(); f.cleanup();}
});
