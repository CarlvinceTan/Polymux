import assert from 'node:assert/strict';
import test from 'node:test';
import {createShareHandler} from '../api/shares.js';
import {conversationSnapshot, SHARE_TTL_SECONDS} from '../lib/conversation-snapshot.js';
const chat = () => ({title: 'Example', messages: [
  {id: 'u1', role: 'user', text: 'First', filePaths: ['/private/file'], files: ['file.txt']},
  {id: 'a1', role: 'assistant', text: 'Answer', runId: 'private-run', activities: [{id: 'tool', kind: 'reading', status: 'completed', label: 'Read file', preview: {runId: 'private'}}]},
  {id: 'u2', role: 'user', text: 'Later'},
  {id: 'a2', role: 'assistant', text: 'Last'},
]});
function response() { return {statusCode: 200, headers: {}, body: null, setHeader(k,v) {this.headers[k]=v;}, status(n) {this.statusCode=n;return this;}, json(v) {this.body=v;return this;}, end() {return this;}}; }
function fixture() {
  let clock = 1000;
  const calls = [];
  const values = new Map();
  let count = 0;
  const handler = createShareHandler({now: () => clock, token: () => 'a'.repeat(32), command: async (...args) => {
    calls.push(args);
    if (args[0] === 'EVAL') return ++count;
    if (args[0] === 'SET') {values.set(args[1], args[2]); return 'OK';}
    return values.get(args[1]) ?? null;
  }});
  return {handler, calls, setTime: (n) => clock=n};
}
test('response snapshot stops inclusively and freezes only public display fields', () => {
  const source = chat(); const snapshot = conversationSnapshot(source, 'a1');
  source.messages[0].text = 'Edited';
  assert.deepEqual(snapshot.messages.map(m => m.text), ['First', 'Answer']);
  assert.equal(snapshot.messages[0].filePaths, undefined);
  assert.equal(snapshot.messages[1].runId, undefined);
  assert.equal(snapshot.messages[1].activities[0].preview, undefined);
  assert.throws(() => conversationSnapshot(source, 'missing'));
  assert.throws(() => conversationSnapshot(source, 'u1'));
});
test('rejects empty, invalid and oversized snapshots', () => {
  for (const source of [{title:'x', messages:[]}, {title:'x', messages:[{role:'system', text:'secret'}]}, {title:'x', messages:[{role:'user', text:'x'.repeat(200001)}]}]) assert.throws(() => conversationSnapshot(source));
});
test('creates immutable one-day link and sets physical storage TTL', async () => {
  const f = fixture(); const result=response();
  await f.handler({method:'POST', headers:{}, body:chat()},result);
  assert.equal(result.statusCode,201);
  assert.equal(result.body.url,'https://polymux.com/share/'+'a'.repeat(32));
  assert.equal(result.body.expiresAt,1000+SHARE_TTL_SECONDS*1000);
  assert.deepEqual(f.calls.find(c => c[0]==='SET').slice(3), ['EX',86400,'NX']);
  const read=response(); await f.handler({method:'GET',query:{id:'a'.repeat(32)}},read);
  assert.equal(read.body.messages.length,4);
  assert.equal(read.headers['Cache-Control'],'no-store');
  f.setTime(result.body.expiresAt);
  const expired=response(); await f.handler({method:'GET',query:{id:'a'.repeat(32)}},expired);
  assert.equal(expired.statusCode,404);
});
test('invalid and missing links share the unavailable response', async () => {
  const f=fixture();
  for (const id of ['bad','b'.repeat(32)]) {const r=response();await f.handler({method:'GET',query:{id}},r);assert.equal(r.statusCode,404);}
});
test('caps anonymous creation per client and fails closed if storage is unavailable', async () => {
  const handler=createShareHandler({command:async () => 31});const r=response();
  await handler({method:'POST',headers:{},body:chat()},r);assert.equal(r.statusCode,429);
  const unavailable=createShareHandler({command:async () => {throw new Error('secret connection string');}});const failed=response();
  await unavailable({method:'GET',query:{id:'a'.repeat(32)}},failed);assert.equal(failed.statusCode,503);assert.doesNotMatch(JSON.stringify(failed.body),/secret/);
});
test('preflight, method and payload failures do not touch storage', async () => {
  const f=fixture();
  for (const [request,status] of [[{method:'OPTIONS'},204],[{method:'DELETE'},405],[{method:'POST',headers:{},body:{}},400],[{method:'POST',headers:{'content-length':1000001}},413]]) {const r=response();await f.handler(request,r);assert.equal(r.statusCode,status);}
  assert.equal(f.calls.length,0);
});
