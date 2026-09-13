/** Encodes one mono Float32 channel as the PCM WAV accepted by the native
 * WeChat voice preparer. Samples are clipped before conversion. */
export function monoPcm16Wav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const bytes = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(bytes);
  const text = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1)
      view.setUint8(offset + index, value.charCodeAt(index));
  };
  text(0, 'RIFF');
  view.setUint32(4, bytes.byteLength - 8, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, index) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      44 + index * 2,
      clipped < 0 ? Math.round(clipped * 0x8000) : Math.round(clipped * 0x7fff),
      true,
    );
  });
  return bytes;
}

/** Chromium can decode its own MediaRecorder WebM/Opus output even though
 * AVFoundation cannot. Decode and resample here, then cross IPC as WAV. */
export async function recordedVoiceWav(clip: Blob, sampleRate = 24_000): Promise<ArrayBuffer> {
  const context = new OfflineAudioContext(1, 1, sampleRate);
  const decoded = await context.decodeAudioData(await clip.arrayBuffer());
  return monoPcm16Wav(decoded.getChannelData(0), decoded.sampleRate);
}
