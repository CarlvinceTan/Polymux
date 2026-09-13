import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {zstdCompressSync} from 'node:zlib';
import {desktopAccount} from './wechat-account-registry.mjs';
import {nativeHistoryRows, nativeMediaMetadata, readLocalCommand} from './wechat-local-reader.mjs';
import {loadDesktopStickers} from './wechat-desktop-store.mjs';

test('native media metadata retains digest, encoded byte length and duration without guessing', () => {
  assert.deepEqual(nativeMediaMetadata('video', '<msg><videomsg md5="'+'ab'.repeat(16)+'" length="456" playlength="12"/></msg>'),
    {md5:'ab'.repeat(16),length:456,durationMs:12000});
  assert.deepEqual(nativeMediaMetadata('audio', '<msg><voicemsg length="1564" voicelength="2750"/></msg>'),
    {length:1564,durationMs:2750});
  assert.deepEqual(nativeMediaMetadata('video', '<msg><videomsg length="3" length="4" md5="wrong" playlength="-1"/></msg>'), {});
  assert.deepEqual(nativeMediaMetadata('image', '<msg><img length="100" hdlength="200"/></msg>'), {length:100});
  assert.deepEqual(nativeMediaMetadata('video', '<msg><videomsg length="1"/><videomsg length="2"/></msg>'), {});
  assert.deepEqual(nativeMediaMetadata('video', '<msg><videomsg playlength="9007199254740991"/></msg>'), {});
});

test('group history strips only an authenticated native sender prefix', () => {
  const db=new DatabaseSync(':memory:'), chat='12345@chatroom', table='Msg_'+createHash('md5').update(chat).digest('hex');
  try {
    db.exec(`CREATE TABLE Name2Id(user_name TEXT); INSERT INTO Name2Id VALUES('wxid_self');
      CREATE TABLE ${table}(local_id INTEGER,server_id INTEGER,create_time INTEGER,local_type INTEGER,real_sender_id INTEGER,message_content TEXT);`);
    const insert=db.prepare(`INSERT INTO ${table} VALUES(?,?,?,1,1,?)`);
    insert.run(1,123,100,'wxid_self:\n中文 🙂'); insert.run(2,124,101,'wxid_other:\nkeep this text');
    const rows=nativeHistoryRows(db,chat);
    assert.equal(rows[0].message_content,'wxid_other:\nkeep this text');
    assert.equal(rows[1].message_content,'中文 🙂');
  } finally {db.close();}
});

test('native history keeps 64-bit ids, exact authors, bounds and compressed source', () => {
  const db = new DatabaseSync(':memory:');
  const table = `Msg_${createHash('md5').update('filehelper').digest('hex')}`;
  try {
    db.exec(`CREATE TABLE Name2Id(user_name TEXT); INSERT INTO Name2Id VALUES('wxid_self'),('wxid_peer');
      CREATE TABLE ${table}(local_id INTEGER,server_id INTEGER,create_time INTEGER,local_type INTEGER,real_sender_id INTEGER,
        message_content BLOB,WCDB_CT_message_content INTEGER,source BLOB,WCDB_CT_source INTEGER);`);
    const insert = db.prepare(`INSERT INTO ${table} VALUES(?,?,?,?,?,?,?,?,?)`);
    insert.run(1, 9072123356052134871n, 100, 1, 1, zstdCompressSync(Buffer.from('中文 🙂')), 4,
      zstdCompressSync(Buffer.from('<msgsource><atuserlist>wxid_peer</atuserlist></msgsource>')), 4);
    insert.run(2, 9072123356052134872n, 101, 1, 2, 'peer', null, null, null);
    const rows = nativeHistoryRows(db, 'filehelper', {since:100, until:100});
    assert.equal(rows.length, 1); assert.equal(rows[0].server_id, '9072123356052134871');
    assert.equal(rows[0].sender_wxid, 'wxid_self'); assert.equal(rows[0].message_content, '中文 🙂');
    assert.match(rows[0].message_source, /wxid_peer/);
    assert.equal(nativeHistoryRows(db, 'filehelper', {limit:1})[0].sender_wxid, 'wxid_peer');
    assert.throws(() => nativeHistoryRows(db, 'filehelper', {limit:-1}), /Invalid/);
    db.exec(`ALTER TABLE ${table} DROP COLUMN real_sender_id`);
    assert.throws(() => nativeHistoryRows(db, 'filehelper'), /format needs a Polymux update/);
  } finally {db.close();}
});

test('own registry supplies account and authenticated stickers with no legacy files', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'wechat-own-reader-'));
  try {
    const dbDir = path.join(home, 'wxid_fixture_1234', 'db_storage');
    await mkdir(path.join(dbDir, 'emoticon'), {recursive:true});
    const registryPath = path.join(home, 'store.json');
    const record = {dbDir, keys:{'emoticon/emoticon.db':'11'.repeat(32)}};
    await writeFile(registryPath, JSON.stringify({accounts:{wxid_fixture_1234:record}}));
    await writeFile(path.join(dbDir, 'emoticon/emoticon.db'), await readFile(new URL('./fixtures/wechat-desktop-store/catalog.db', import.meta.url)));
    await writeFile(path.join(dbDir, "emoticon/emoticon.db-wal"), await readFile(new URL("./fixtures/wechat-desktop-store/catalog.db-wal", import.meta.url)));
    const options = {home, registryPath};
    assert.equal((await desktopAccount(options)).wxid, 'wxid_fixture');
    assert.deepEqual(await readLocalCommand(['accounts','--json'], options), {accounts:[{wxid:'wxid_fixture'}]});
    assert.ok((await loadDesktopStickers({...options, accountWxid:'wxid_fixture'})).length);
    await assert.rejects(desktopAccount({...options, accountWxid:'wxid_other'}), /different account/);
    await writeFile(registryPath, JSON.stringify({accounts:{wxid_fixture_1234:record,wxid_second:{dbDir:path.join(home,'wxid_second','db_storage'),keys:{}}}}));
    await assert.rejects(desktopAccount(options), /exactly one/);
    await writeFile(registryPath, JSON.stringify({accounts:{wxid_fixture_1234:{...record,keys:{'../secret.db':'11'.repeat(32)}}}}));
    await assert.rejects(desktopAccount(options), /keys are invalid/);
  } finally {await rm(home,{recursive:true,force:true});}
});

test('native readiness rejects a changed binary before CLI or debugger execution', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'wechat-upgrade-'));
  try {
    const dylib = path.join(directory, 'wechat.dylib'); await writeFile(dylib, 'new unsupported WeChat build');
    const result = await promisify(execFile)(process.execPath, [new URL('./polymux-wechat-driver.mjs', import.meta.url).pathname,'ready','--json'], {
      env: {...process.env, POLYMUX_WECHAT_PROVIDER:'native', POLYMUX_WECHAT_WIRE_NATIVE:'1', POLYMUX_WECHAT_DYLIB:dylib,
        POLYMUX_WECHAT_CLI:'/nonexistent/provider',POLYMUX_WECHAT_LLDB:'/nonexistent/debugger'}, timeout:5000,
    });
    const answer = JSON.parse(result.stdout);
    assert.equal(answer.ready,false); assert.match(answer.reason,/version needs a Polymux update/);
    assert.doesNotMatch(answer.reason,/ENOENT|debugger|provider/);
  } finally {await rm(directory,{recursive:true,force:true});}
});
