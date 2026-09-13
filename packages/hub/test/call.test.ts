import assert from 'node:assert/strict';
import test from 'node:test';
import {callOf} from '../src/call.js';

const native = (caption: string) => ({body: '[Call]', 'co.polymux.wechat.remote': true,
  'co.polymux.wechat.native': {kind: 'call', body: `<voipmsg><VoIPBubbleMsg><duration>0</duration><msg><![CDATA[${caption}]]></msg></VoIPBubbleMsg></voipmsg>`}});

test('cached WeChat calls recover the visible duration instead of the zero transport field', () => {
  assert.deepEqual(callOf(native('Duration: 18:55')), {kind:'voice',status:'ended',durationSeconds:1135});
  assert.equal(callOf(native('Duration: 01:31:16'))?.durationSeconds,5476);
  assert.equal(callOf(native('Call ended 20:19'))?.durationSeconds,1219);
  assert.equal(callOf(native('通话时长 18:55'))?.durationSeconds,1135);
});

test('missed and declined calls never acquire a fabricated duration', () => {
  assert.deepEqual(callOf(native("Call wasn't answered")),{kind:'voice',status:'missed',durationSeconds:null});
  assert.equal(callOf(native('Declined'))?.status,'declined');
  assert.equal(callOf(native('Call canceled by caller'))?.status,'cancelled');
  assert.equal(callOf(native('Call ended'))?.durationSeconds,null);
  assert.equal(callOf(native('Duration: 18:99'))?.durationSeconds,null);
});

test('shared Beeper call markers work for bridge text and notice events', () => {
  for(const msgtype of ['m.text','m.notice']) {
    const event={msgtype,body:'Incoming voice call. Use the WhatsApp app to answer.',
      'com.beeper.action_message':{type:'call',call_type:'voice'}};
    assert.deepEqual(callOf(event),{kind:'voice',status:'incoming',durationSeconds:null});
  }
  assert.equal(callOf({body:'Started a video call','com.beeper.action_message':{type:'call',call_type:'video'}})?.kind,'video');
});

test('legacy bridge call notices preserve durations and do not turn ordinary chat text into calls', () => {
  assert.equal(callOf({msgtype:'m.notice',body:'Call ended (18:55)'})?.durationSeconds,1135);
  assert.equal(callOf({msgtype:'m.notice',body:'Call ended (18 minutes, 55 seconds)'})?.durationSeconds,1135);
  assert.equal(callOf({msgtype:'m.notice',body:'Call ended (18m55s)'})?.durationSeconds,1135);
  assert.equal(callOf({msgtype:'m.notice',body:'Video call rejected'})?.kind,'video');
  assert.equal(callOf({msgtype:'m.text',body:'Call ended (18:55)'}),null);
  assert.equal(callOf({msgtype:'m.text',body:'[Call]'}),null);
  assert.equal(callOf({msgtype:'m.notice',body:'Please call me at 18:55'}),null);
});

test('structured call summaries validate durations and reject unrelated metadata', () => {
  assert.deepEqual(callOf({'co.polymux.call':{kind:'voice',status:'ended',durationSeconds:1135}}),{kind:'voice',status:'ended',durationSeconds:1135});
  assert.equal(callOf({'co.polymux.call':{kind:'voice',durationSeconds:-1}})?.durationSeconds,null);
  assert.equal(callOf({'com.beeper.action_message':{type:'other'},body:'18:55'}),null);
  assert.equal(callOf({...native('Duration: 18:55'),'co.polymux.wechat.remote':false}),null);
});
