import assert from 'node:assert/strict';
import test from 'node:test';
import {monoPcm16Wav} from './voiceWav';

test('encodes a clipped mono PCM16 WAV with a valid header', () => {
  const bytes = monoPcm16Wav(new Float32Array([-2, -0.5, 0, 0.5, 2]), 24_000);
  const view = new DataView(bytes);
  const text = (offset: number, length: number): string =>
    String.fromCharCode(...new Uint8Array(bytes, offset, length));
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(view.getUint32(24, true), 24_000);
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 10);
  assert.equal(view.getInt16(44, true), -32_768);
  assert.equal(view.getInt16(52, true), 32_767);
});
