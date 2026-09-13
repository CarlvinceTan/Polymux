import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createCipheriv} from 'node:crypto';
import {chmod, copyFile, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import test from 'node:test';
import {captureWeChatDatabaseKeys, prepareWeChatKeyCapture} from './wechat-key-capture.mjs';

const run = promisify(execFile);
const fixture = new URL('../../packages/wechat/test/fixtures/wechat/', import.meta.url);
const source = fileURLToPath(new URL('../../packages/wechat/src/native/wechat-key-capture.c', import.meta.url));

function cryptoCall(binary, library, environment, bytes, args = []) {
  return new Promise((resolve, reject) => {
    const env = {...process.env, ...environment};
    delete env.DYLD_INSERT_LIBRARIES;
    delete env.POLYMUX_WECHAT_KEY_CAPTURE_DIRECTORY;
    Object.assign(env, environment);
    if (library) env.DYLD_INSERT_LIBRARIES = library;
    const child = execFile(binary, args, {env, timeout: 10_000}, (error, stdout, stderr) => {
      if (error) reject(new Error(`Disposable capture fixture failed: ${error.code}`));
      else resolve({stdout, stderr});
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}

test('CommonCrypto observation captures only authenticated database keys and preserves encryption', {skip: process.platform !== 'darwin'}, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'polymux-key-capture-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const library = path.join(root, 'capture.dylib'), binary = path.join(root, 'crypto-fixture');
  await run('/usr/bin/clang', ['-O2', '-dynamiclib', source, '-o', library], {timeout: 60_000});
  const main = path.join(root, 'main.c');
  await writeFile(main, `
#include <CommonCrypto/CommonCryptor.h>
#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>
int main(int argc,char **argv) {
 unsigned char key[32],iv[16]={0},data[32]={0},output[64];
 unsigned int loops=argc>1?atoi(argv[1]):1;
 if(argc>2) {
  char file[4096],linked[4096];const char *directory=getenv("POLYMUX_WECHAT_KEY_CAPTURE_DIRECTORY");
  if(!directory)return 12;
  snprintf(file,sizeof(file),"%s/keys",directory);
  if(!strcmp(argv[2],"late-permissions"))chmod(file,0644);
  else {snprintf(linked,sizeof(linked),"%s/linked",directory);link(file,linked);}
 }
 while(fread(key,1,32,stdin)==32) for(unsigned int i=0;i<loops;i++) {
  CCCryptorRef c=NULL;size_t n=0,tail=0;errno=EBUSY;
  int invalid=CCCryptorCreate(kCCEncrypt,kCCAlgorithmAES,0,key,31,iv,&c);
  if(invalid==kCCSuccess)return 10;
  int status=CCCryptorCreate(kCCEncrypt,kCCAlgorithmAES,0,key,32,iv,&c);
  int observedErrno=errno;
  if(status || CCCryptorUpdate(c,data,sizeof(data),output,sizeof(output),&n) ||
     CCCryptorFinal(c,output+n,sizeof(output)-n,&tail))return 11;
  CCCryptorRelease(c);
  printf("%d %d ",status,observedErrno);
  for(size_t j=0;j<n+tail;j++)printf("%02x",output[j]);
  puts("");
 }
 return 0;
}
`);
  await run('/usr/bin/clang', ['-O2', main, '-o', binary], {timeout: 60_000});
  const dbDir = path.join(root, 'account'); await mkdir(dbDir);
  await copyFile(new URL('head_image.db', fixture), path.join(dbDir, 'first.db'));
  await copyFile(new URL('head_image.db', fixture), path.join(dbDir, 'second.db'));
  const key = Buffer.from((await readFile(new URL('head_image.key', fixture), 'utf8')).trim(), 'hex');
  t.after(() => key.fill(0));
  const before = await readFile(path.join(dbDir, 'first.db'));

  await t.test('correct keys authenticate each selected database without changing crypto results or source bytes', async () => {
    const capture = await prepareWeChatKeyCapture({dbDir, entries: ['first.db', 'second.db'], temporaryRoot: root});
    try {
      const input = Buffer.concat([Buffer.alloc(32, 7), key]);
      const baseline = await cryptoCall(binary, null, {}, input, ['40']);
      const observed = await cryptoCall(binary, library, capture.environment, input, ['40']);
      assert.deepEqual(observed, baseline);
      const cipher = createCipheriv('aes-256-cbc', key, Buffer.alloc(16)); cipher.setAutoPadding(false);
      const expected = Buffer.concat([cipher.update(Buffer.alloc(32)), cipher.final()]).toString('hex');
      assert.ok(observed.stdout.trim().endsWith(expected));
      const result = await capture.read();
      assert.deepEqual(result.missing, []);
      assert.deepEqual([...result.keys.keys()], ['first.db', 'second.db']);
      for (const found of result.keys.values()) { assert.deepEqual(found, key); found.fill(0); }
      assert.equal((await readFile(path.join(capture.directory, 'keys'))).length, 72);
      assert.deepEqual(await readFile(path.join(dbDir, 'first.db')), before);
    } finally { await capture.dispose(); }
    await assert.rejects(capture.read(), /closed/);
  });

  await t.test('wrong keys are never written and missing keys remain explicit', async () => {
    const capture = await prepareWeChatKeyCapture({dbDir, entries: ['first.db'], temporaryRoot: root});
    try {
      await cryptoCall(binary, library, capture.environment, Buffer.alloc(32, 9));
      assert.equal((await readFile(path.join(capture.directory, 'keys'))).length, 0);
      assert.deepEqual((await capture.read()).missing, ['first.db']);
    } finally { await capture.dispose(); }
  });

  await t.test('candidate work is bounded even when unrelated AES calls keep arriving', async () => {
    const capture = await prepareWeChatKeyCapture({dbDir, entries: ['first.db'], temporaryRoot: root});
    try {
      const candidates = Array.from({length: 512}, (_, index) => {
        const candidate = Buffer.alloc(32, 9); candidate.writeUInt32LE(index); return candidate;
      });
      await cryptoCall(binary, library, capture.environment, Buffer.concat([...candidates, key]));
      assert.equal((await readFile(path.join(capture.directory, 'keys'))).length, 0);
      assert.deepEqual((await capture.read()).missing, ['first.db']);
    } finally { await capture.dispose(); }
  });

  await t.test('unconfigured insertion is inert and emits no key material', async () => {
    assert.deepEqual(await cryptoCall(binary, library, {}, key), await cryptoCall(binary, null, {}, key));
  });

  await t.test('capture stops if the output loses privacy after initialization', async () => {
    for (const mode of ['late-permissions', 'late-link']) {
      const capture = await prepareWeChatKeyCapture({dbDir, entries: ['first.db'], temporaryRoot: root});
      try {
        await cryptoCall(binary, library, capture.environment, key, ['1', mode]);
        assert.equal((await readFile(path.join(capture.directory, 'keys'))).length, 0);
        await assert.rejects(capture.read(), /private/);
      } finally { await capture.dispose(); }
    }
  });

  await t.test('insecure, linked, pre-populated and malformed staging refuses capture', async () => {
    for (const mode of ['directory', 'output', 'symlink', 'hardlink', 'existing', 'pages', 'fifo']) {
      const capture = await prepareWeChatKeyCapture({dbDir, entries: ['first.db'], temporaryRoot: root});
      try {
        const file = path.join(capture.directory, 'keys');
        if (mode === 'directory') await chmod(capture.directory, 0o755);
        if (mode === 'output') await chmod(file, 0o644);
        if (mode === 'symlink') { await rm(file); await symlink(path.join(capture.directory, 'pages'), file); }
        if (mode === 'hardlink') await link(file, path.join(capture.directory, 'linked'));
        if (mode === 'existing') await writeFile(file, Buffer.from('existing'));
        if (mode === 'pages') await writeFile(path.join(capture.directory, 'pages'), Buffer.from('invalid'));
        if (mode === 'fifo') {
          await rm(file); await run('/usr/bin/mkfifo', ['-m', '600', file]);
          await cryptoCall(binary, library, capture.environment, key);
          await assert.rejects(capture.read(), /private/);
          continue;
        }
        const before = await readFile(file);
        await cryptoCall(binary, library, capture.environment, key);
        assert.deepEqual(await readFile(file), before, mode);
      } finally { await capture.dispose(); }
    }
  });

  await t.test('launcher rejects invalid staging before it can start an application', async () => {
    const launcher = await readFile(new URL('../../packages/wechat/src/native/wechat-launch-hidden.swift', import.meta.url), 'utf8');
    const validator = launcher.slice(launcher.indexOf('func validKeyCaptureDirectory'), launcher.indexOf('// Private UI handling'));
    const swift = path.join(root, 'validate.swift'), validate = path.join(root, 'validate');
    await writeFile(swift, 'import Foundation\nimport Darwin\n' + validator + '\nprint(validKeyCaptureDirectory(CommandLine.arguments[1]))\n');
    await run('/usr/bin/swiftc', [swift, '-o', validate], {timeout: 60_000});
    for (const mode of ['valid', 'permissions', 'missing', 'pages', 'existing', 'linked', 'fifo']) {
      const capture = await prepareWeChatKeyCapture({dbDir, entries: ['first.db'], temporaryRoot: root});
      try {
        const file = path.join(capture.directory, 'keys');
        if (mode === 'permissions') await chmod(capture.directory, 0o755);
        if (mode === 'missing') await rm(file);
        if (mode === 'pages') await writeFile(path.join(capture.directory, 'pages'), Buffer.alloc(20));
        if (mode === 'existing') await writeFile(file, Buffer.from('existing'));
        if (mode === 'linked') await link(file, path.join(capture.directory, 'linked'));
        if (mode === 'fifo') { await rm(file); await run('/usr/bin/mkfifo', ['-m', '600', file]); }
        assert.equal((await run(validate, [capture.directory], {timeout: 5000})).stdout.trim(), String(mode === 'valid'), mode);
      } finally { await capture.dispose(); }
    }
  });

  await t.test('one setup attempt reports partial results, rejects process changes and never repeats login', async () => {
    for (const mode of ['complete', 'pending', 'locked', 'unconfirmed', 'changed', 'warm', 'failed-launch', 'missing-birth', 'bad-status']) {
      let logins = 0, statuses = 0;
      const request = {
        dbDir, entries: ['first.db'], temporaryRoot: root, budgetMs: 100, pollMs: 1,
        launch: async directory => {
          if (mode === 'failed-launch') throw Error('launch failed');
          if (mode === 'complete') await cryptoCall(binary, library, {POLYMUX_WECHAT_KEY_CAPTURE_DIRECTORY: directory}, key);
          return {ok: true, guarded: true, alreadyRunning: mode === 'warm', pid: 4242,
            birthSeconds: mode === 'missing-birth' ? undefined : 1234, birthMicros: 567};
        },
        sessionState: async (pid, target) => {
          assert.equal(target.birthSeconds, 1234); assert.equal(target.birthMicros, 567);
          statuses++; return {ok: mode !== 'bad-status', pid: mode === 'changed' ? 4343 : pid, state: mode === 'locked' ? 'locked' : 'remembered_login'};
        },
        requestLogin: async (pid, target) => {
          assert.equal(target.birthSeconds, 1234); assert.equal(target.birthMicros, 567);
          logins++; return mode === 'unconfirmed' ? {ok: false, reason: 'login_unconfirmed'} : {ok: true, primed: true, pid};
        },
      };
      if (['changed', 'warm', 'failed-launch', 'missing-birth'].includes(mode)) await assert.rejects(captureWeChatDatabaseKeys(request));
      else {
        const result = await captureWeChatDatabaseKeys(request);
        assert.equal(result.keys.size, mode === 'complete' ? 1 : 0, mode);
        assert.equal(result.missing.length, mode === 'complete' ? 0 : 1, mode);
        for (const found of result.keys.values()) found.fill(0);
        if (mode === 'unconfirmed') assert.equal(result.state, 'login_unconfirmed');
      }
      assert.equal(logins, ['pending', 'unconfirmed'].includes(mode) ? 1 : 0, mode);
      if (mode === 'unconfirmed') assert.equal(statuses, 1);
      assert.deepEqual((await readdir(root)).filter(name => name.startsWith('polymux-wechat-key-capture-')), []);
    }
  });

  await t.test('setup captures keys through transient controls and a dispatched login without repeating it', async () => {
    for (const mode of ['startup', 'dispatched-login', 'qr']) {
      let directory, logins = 0, observations = 0;
      const states = mode === 'startup' ? ['unavailable', 'launching', 'signed_in']
        : mode === 'qr' ? ['interactive_login', 'unavailable', 'signed_in']
        : ['remembered_login', 'unavailable', 'remembered_login', 'signed_in'];
      const result = await captureWeChatDatabaseKeys({dbDir, entries: ['first.db'], temporaryRoot: root,
        budgetMs: 2_000, pollMs: 1,
        launch: async value => { directory = value;
          return {ok: true, guarded: true, alreadyRunning: false, pid: 4242, birthSeconds: 1234, birthMicros: 567}; },
        sessionState: async (pid, target) => {
          assert.equal(pid, 4242); assert.equal(target.birthSeconds, 1234); assert.equal(target.birthMicros, 567);
          const state = states[observations++];
          assert.ok(state, 'capture must finish after the authenticated key arrives');
          if (state === 'signed_in') await cryptoCall(binary, library, {POLYMUX_WECHAT_KEY_CAPTURE_DIRECTORY: directory}, key);
          return {ok: true, pid, state};
        },
        requestLogin: async pid => {
          logins++;
          return {ok: false, pid, reason: 'wechat_chat_list_unavailable', loginSubmissionAttempted: true};
        },
      });
      assert.equal(result.state, 'captured', mode);
      assert.equal(observations, states.length, mode);
      assert.equal(logins, mode === 'dispatched-login' ? 1 : 0, mode);
      assert.deepEqual(result.missing, []);
      assert.deepEqual(result.keys.get('first.db'), key);
      for (const found of result.keys.values()) found.fill(0);
      assert.deepEqual(await readFile(path.join(dbDir, 'first.db')), before);
      assert.deepEqual((await readdir(root)).filter(name => name.startsWith('polymux-wechat-key-capture-')), []);
    }
  });

  await t.test('pending capture rejects missing identities, guard failures and undispatched login results', async () => {
    const cases = [
      {login: {loginSubmissionAttempted: false}},
      {login: {loginSubmissionAttempted: 'true'}},
      {login: {reason: 'background_guard_unavailable'}},
      {login: {reason: 'wechat_took_focus'}},
      {login: {pid: undefined}},
      {login: {pid: 4343}, rejects: true},
      {status: {pid: undefined}},
      {status: {pid: 4343}, rejects: true},
      {status: {state: 'new_unknown_state'}},
      {status: {state: 'locked'}},
      {status: {state: 'signed_out'}},
    ];
    for (const scenario of cases) {
      let logins = 0, observations = 0;
      const operation = captureWeChatDatabaseKeys({dbDir, entries: ['first.db'], temporaryRoot: root,
        budgetMs: 1_000, pollMs: 1,
        launch: async () => ({ok: true, guarded: true, alreadyRunning: false, pid: 4242, birthSeconds: 1234, birthMicros: 567}),
        sessionState: async pid => { observations++;
          return {ok: true, pid, state: 'remembered_login', ...scenario.status}; },
        requestLogin: async pid => { logins++;
          return {ok: false, pid, reason: 'wechat_chat_list_unavailable', loginSubmissionAttempted: true, ...scenario.login}; },
      });
      if (scenario.rejects) await assert.rejects(operation, /process changed/);
      else {
        const result = await operation;
        assert.equal(result.keys.size, 0);
        assert.deepEqual(result.missing, ['first.db']);
        assert.notEqual(result.state, 'captured');
      }
      assert.equal(observations, 1);
      assert.equal(logins, scenario.status ? 0 : 1);
      assert.deepEqual((await readdir(root)).filter(name => name.startsWith('polymux-wechat-key-capture-')), []);
    }
  });

  await t.test('a dispatched login which never finishes expires with no captured keys or second submission', async () => {
    let logins = 0, observations = 0;
    const result = await captureWeChatDatabaseKeys({dbDir, entries: ['first.db'], temporaryRoot: root,
      budgetMs: 200, pollMs: 1,
      launch: async () => ({ok: true, guarded: true, alreadyRunning: false, pid: 4242, birthSeconds: 1234, birthMicros: 567}),
      sessionState: async pid => { observations++; return {ok: true, pid, state: 'remembered_login'}; },
      requestLogin: async pid => { logins++;
        return {ok: false, pid, reason: 'wechat_chat_list_unavailable', loginSubmissionAttempted: true}; },
    });
    assert.ok(observations > 1);
    assert.equal(logins, 1);
    assert.equal(result.state, 'remembered_login');
    assert.equal(result.keys.size, 0);
    assert.deepEqual(result.missing, ['first.db']);
    assert.deepEqual((await readdir(root)).filter(name => name.startsWith('polymux-wechat-key-capture-')), []);
  });

  await t.test('the complete setup CLI provisions its own registry without reading legacy keys', {skip: process.arch !== 'arm64'}, async () => {
    for (const mode of ['immediate', 'pending-login']) {
      const workspace = path.join(root, `workspace with spaces ${mode}`), scripts = path.join(workspace, 'scripts/wechat');
      const native = path.join(workspace, 'resources/native/bin'), home = path.join(workspace, 'home');
      const account = path.join(home, 'Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_demo_a1b2/db_storage');
      await mkdir(scripts, {recursive: true}); await mkdir(native, {recursive: true});
      await mkdir(path.join(account, 'head_image'), {recursive: true});
      await mkdir(path.join(home, '.wx-rs'), {recursive: true});
      // Reading the external registry would fail. This fixture exercises the
      // actual CLI and real crypto observer with disposable launch callbacks.
      await writeFile(path.join(home, '.wx-rs/keys.json'), 'invalid legacy data');
      for (const name of ['wechat-key-collect.mjs', 'wechat-key-capture.mjs', 'wechat-key-auth.mjs'])
        await copyFile(new URL(name, import.meta.url), path.join(scripts, name));
      await copyFile(new URL('head_image.db', fixture), path.join(account, 'head_image/head_image.db'));
      await writeFile(path.join(native, 'VERSION'), 'f'.repeat(64));
      const launcher = path.join(native, 'wechat-launch-hidden');
      const progress = path.join(workspace, 'progress.json');
      await writeFile(launcher, `#!/usr/bin/env node
  const fs=require('node:fs'), {spawnSync}=require('node:child_process');
  const args=process.argv.slice(2), index=args.indexOf('--key-capture');
  if(index<0)process.exit(10);
  fs.writeFileSync(${JSON.stringify(progress)},JSON.stringify({directory:args[index+1],polls:0,logins:0}),{mode:0o600});
  if(${JSON.stringify(mode)}==='immediate') {
  const key=Buffer.from(fs.readFileSync(${JSON.stringify(fileURLToPath(new URL('head_image.key', fixture)))},'utf8').trim(),'hex');
  const result=spawnSync(${JSON.stringify(binary)},[],{input:key,env:{...process.env,DYLD_INSERT_LIBRARIES:${JSON.stringify(library)},POLYMUX_WECHAT_KEY_CAPTURE_DIRECTORY:args[index+1]}});
  key.fill(0);if(result.status!==0)process.exit(11);
  }
  console.log(JSON.stringify({ok:true,guarded:true,alreadyRunning:false,pid:4242,birthSeconds:1234,birthMicros:567}));
  `, {mode: 0o700});
      await writeFile(path.join(native, 'wechat-prime'), `#!/usr/bin/env node
  const fs=require('node:fs'),{spawnSync}=require('node:child_process'),args=process.argv.slice(2);
  if(args[args.indexOf('--pid')+1]!=='4242' || args.slice(args.indexOf('--expected-birth')+1).join(',')!=='1234,567')process.exit(12);
  const file=${JSON.stringify(progress)},progress=JSON.parse(fs.readFileSync(file,'utf8'));
  let response;
  if(args.includes('--status-only')) {
   progress.polls++;
   if(progress.polls===4) {
    const key=Buffer.from(fs.readFileSync(${JSON.stringify(fileURLToPath(new URL('head_image.key', fixture)))},'utf8').trim(),'hex');
    const result=spawnSync(${JSON.stringify(binary)},[],{input:key,env:{...process.env,DYLD_INSERT_LIBRARIES:${JSON.stringify(library)},POLYMUX_WECHAT_KEY_CAPTURE_DIRECTORY:progress.directory}});
    key.fill(0);if(result.status!==0)process.exit(13);
   }
   response={ok:true,pid:4242,state:progress.polls===2?'unavailable':progress.polls>=4?'signed_in':'remembered_login'};
  } else {
   if(++progress.logins>1)process.exit(14);
   response={ok:false,pid:4242,reason:'wechat_chat_list_unavailable',loginSubmissionAttempted:true};
  }
  fs.writeFileSync(file,JSON.stringify(progress));console.log(JSON.stringify(response));
  `, {mode: 0o700});
      const registryPath = path.join(home, 'store.json');
      const result = await run(process.execPath, [path.join(scripts, 'wechat-key-collect.mjs'), '--capture', 'wxid_demo', '--home', home, '--out', registryPath], {timeout: 10_000});
      assert.match(result.stdout, /captured 1 authenticated keys; 0 pending/);
      assert.equal(result.stderr, '');
      const registry = JSON.parse(await readFile(registryPath, 'utf8'));
      assert.deepEqual(Object.keys(registry.accounts), ['wxid_demo']);
      assert.equal(registry.accounts.wxid_demo.keys['head_image/head_image.db'], key.toString('hex'));
      assert.deepEqual(await readFile(path.join(account, 'head_image/head_image.db')), before);
      const observed = JSON.parse(await readFile(progress, 'utf8'));
      assert.equal(observed.logins, mode === 'pending-login' ? 1 : 0);
      assert.equal(observed.polls, mode === 'pending-login' ? 4 : 0);
      await assert.rejects(readFile(path.join(observed.directory, 'keys')), {code: 'ENOENT'});
    }
  });

  await t.test('the reader rejects invalid records and keys after their encrypted source changes', async () => {
    for (const mode of ['truncated', 'index', 'wrong-key', 'duplicate', 'source']) {
      const capture = await prepareWeChatKeyCapture({dbDir, entries: ['first.db', 'second.db'], temporaryRoot: root});
      try {
        const record = Buffer.alloc(36); key.copy(record, 4);
        if (mode === 'index') record.writeUInt32LE(2);
        if (mode === 'wrong-key') record.fill(6, 4);
        const bytes = mode === 'truncated' ? record.subarray(0, 35) : mode === 'duplicate' ? Buffer.concat([record, record]) : record;
        await writeFile(path.join(capture.directory, 'keys'), bytes);
        if (mode === 'source') { const changed = Buffer.from(before); changed[20] ^= 1; await writeFile(path.join(dbDir, 'first.db'), changed); }
        await assert.rejects(capture.read(), /Invalid|authenticates/);
      } finally { await writeFile(path.join(dbDir, 'first.db'), before); await capture.dispose(); }
    }
  });

  await t.test('account traversal, duplicates, plaintext, short pages and external symlinks are rejected', async () => {
    for (const entries of [[], ['../first.db'], ['/first.db'], ['first.db', 'first.db'], ['a/./b.db']])
      await assert.rejects(prepareWeChatKeyCapture({dbDir, entries, temporaryRoot: root}));
    await writeFile(path.join(dbDir, 'short.db'), Buffer.alloc(40));
    const plaintext = Buffer.alloc(4096); plaintext.write('SQLite format 3\0');
    await writeFile(path.join(dbDir, 'plain.db'), plaintext);
    await copyFile(new URL('head_image.db', fixture), path.join(root, 'outside.db'));
    await symlink(path.join(root, 'outside.db'), path.join(dbDir, 'link.db'));
    for (const entry of ['short.db', 'plain.db', 'link.db'])
      await assert.rejects(prepareWeChatKeyCapture({dbDir, entries: [entry], temporaryRoot: root}));
  });
});
