import assert from 'node:assert/strict';
import test from 'node:test';
import {weChatCallText} from '../src/wechat-call.js';

test('call caption extraction ignores transport fields and rejects malformed or ambiguous XML',()=>{
  assert.equal(weChatCallText('<voipmsg><duration>0</duration><msg><![CDATA[Duration: 18:55]]></msg></voipmsg>'),'Duration: 18:55');
  for(const xml of ['<msg>Duration: 18:55</msg>','<voipmsg><msg>x</voipmsg>',
    '<voipmsg><msg>x</msg><msg>y</msg></voipmsg>',
    '<!DOCTYPE voipmsg [<!ENTITY x "bad">]><voipmsg><msg>&x;</msg></voipmsg>',
    `<voipmsg><msg>${'x'.repeat(129*1024)}</msg></voipmsg>`]) assert.equal(weChatCallText(xml),null);
});
