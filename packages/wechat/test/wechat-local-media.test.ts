import assert from 'node:assert/strict';
import test from 'node:test';
import {createCipheriv,createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import type {WeChatNativeStore} from '../src/wechat-native-store.js';
import {decodeWeChatDat,resourceImageDigest,readLocalWeChatPhoto,readLocalWeChatSticker} from '../src/wechat-local-media.js';
const plain = Buffer.concat([Buffer.from([255,216,255,224]),Buffer.alloc(80, 42),Buffer.from([255,217])]);
function envelope(bytes:Buffer,key:Buffer,xor:number){
 const size=32,tail=10,cipher=createCipheriv('aes-128-ecb',key,null);
 const encoded=Buffer.concat([cipher.update(bytes.subarray(0,size)),cipher.final()]);
 const header=Buffer.alloc(15);Buffer.from([7,8,86,50,8,7]).copy(header);header.writeUInt32LE(size,6);header.writeUInt32LE(tail,10);
 return Buffer.concat([header,encoded,bytes.subarray(size,bytes.length-tail),Buffer.from(bytes.subarray(-tail).map(b=>b^xor))]);
}
test('local photo envelope preserves all bytes and rejects wrong keys or malformed boundaries',()=>{
 const key=Buffer.from('0123456789abcdef');const data=envelope(plain,key,59);
 assert.deepEqual(decodeWeChatDat(data,key,59),plain);
 assert.equal(decodeWeChatDat(data,Buffer.alloc(16),59),null);
 const malformed=Buffer.from(data);malformed.writeUInt32LE(0xffffffff,10);
 assert.equal(decodeWeChatDat(malformed,key,59),null);
 assert.equal(resourceImageDigest(Buffer.from('a'.repeat(32))),null);
 const record=(d:string)=>Buffer.concat([Buffer.from([18,34,10,32]),Buffer.from(d)]);
 assert.equal(resourceImageDigest(Buffer.concat([record('a'.repeat(32)),record('b'.repeat(32))])),null);
});
test('local lookup uses exact message time and resource identity, validates stickers and confines paths',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'wechat-local-media-'));
 const account=path.join(root,'Documents/xwechat_files/wxid_fixture_abcd');
 const chat='wxid_peer',digest='a'.repeat(32),stamp=1788886800000,code=12345;
 const folder=path.join(account,'msg/attach',createHash('md5').update(chat).digest('hex'),'2026-09/Img');
 const meta=path.join(root,'Documents/app_data/net/kvcomm');
 await mkdir(folder,{recursive:true});await mkdir(meta,{recursive:true});await writeFile(path.join(meta,`key_${code}_test.statistic`),'');
 const key=Buffer.from(createHash('md5').update(`${code}wxid_fixture`).digest('hex').slice(0,16));
 const file=path.join(folder,`${digest}.dat`);await writeFile(file,envelope(plain,key,code&255));
 const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE ChatName2Id(user_name TEXT);CREATE TABLE MessageResourceInfo(chat_id INTEGER,message_local_id INTEGER,message_local_type INTEGER,message_create_time INTEGER,packed_info BLOB)');
 db.prepare('INSERT INTO ChatName2Id VALUES (?)').run(chat);
 db.prepare('INSERT INTO MessageResourceInfo VALUES (1,1,3,?,?)').run(stamp/1000,Buffer.concat([Buffer.from([18,34,10,32]),Buffer.from(digest)]));
 let pendingCommit:(()=>void)|undefined;
 const snapshot={refresh:async()=>{pendingCommit?.();pendingCommit=undefined;return true;},query:async(fn:any)=>fn(db)};
 const store={dbDir:path.join(account,'db_storage'),wxid:'wxid_fixture_abcd',has:()=>true,snapshot:async()=>snapshot} as unknown as WeChatNativeStore;
 try{
  assert.deepEqual((await readLocalWeChatPhoto(store,chat,'1',stamp))?.bytes,plain);
  assert.equal(await readLocalWeChatPhoto(store,chat,'1',stamp+1000),null);
  assert.equal(await readLocalWeChatPhoto(store,chat,'2',stamp),null);
  pendingCommit=()=>{db.prepare('INSERT INTO MessageResourceInfo VALUES (1,2,3,?,?)').run(stamp/1000,Buffer.concat([Buffer.from([18,34,10,32]),Buffer.from(digest)]));};
  assert.deepEqual((await readLocalWeChatPhoto(store,chat,'2',stamp))?.bytes,plain,
   'a later resource commit is visible without recreating the store');
  const stickerDigest=createHash('md5').update(plain).digest('hex');const sticker=path.join(account,'cache/2026-09/Emoticon',stickerDigest.slice(0,2),stickerDigest);
  await mkdir(path.dirname(sticker),{recursive:true});await writeFile(sticker,plain);
  assert.deepEqual((await readLocalWeChatSticker(store,stickerDigest))?.bytes,plain);
  await writeFile(sticker,Buffer.concat([plain,Buffer.from('changed')]));
  assert.equal(await readLocalWeChatSticker(store,stickerDigest),null);
  const outside=path.join(root,'outside');await writeFile(outside,plain);await rm(file);await symlink(outside,file);
  assert.equal(await readLocalWeChatPhoto(store,chat,'1',stamp),null);
 }finally{db.close();await rm(root,{recursive:true,force:true});}
});
