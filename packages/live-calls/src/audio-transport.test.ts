import { describe, expect, it } from 'vitest';
import {
  LiveAudioSequenceGuard,
  decodeLiveAudioAcknowledgement,
  decodeLiveAudioPacket,
  encodeLiveAudioAcknowledgement,
  encodeLiveAudioPacket
} from './audio-transport.js';

describe('live audio binary protocol', () => {
  it('round-trips authenticated transport metadata without encoding audio as JSON', () => {
    const encoded = encodeLiveAudioPacket({
      source: 'SYSTEM_AUDIO',
      sequence: 42,
      capturedAtMs: 1_700_000_000_123,
      durationMs: 100,
      sampleRate: 16_000,
      channels: 1,
      data: new Uint8Array([1, 2, 3, 4])
    });
    expect(decodeLiveAudioPacket(encoded)).toEqual({
      source: 'SYSTEM_AUDIO',
      sequence: 42,
      capturedAtMs: 1_700_000_000_123,
      durationMs: 100,
      sampleRate: 16_000,
      channels: 1,
      data: new Uint8Array([1, 2, 3, 4])
    });
    expect(decodeLiveAudioAcknowledgement(encodeLiveAudioAcknowledgement('LOCAL_MIC', 7))).toEqual({
      source: 'LOCAL_MIC',
      sequence: 7
    });
  });

  it('rejects malformed, oversized and replayed packets', () => {
    const encoded = encodeLiveAudioPacket({
      source: 'LOCAL_MIC',
      sequence: 3,
      capturedAtMs: Date.now(),
      durationMs: 100,
      sampleRate: 16_000,
      channels: 1,
      data: new Uint8Array(3_200)
    });
    expect(() => decodeLiveAudioPacket(encoded, 1_000)).toThrow('LIVE_AUDIO_PAYLOAD_SIZE_INVALID');
    encoded[0] = 0;
    expect(() => decodeLiveAudioPacket(encoded)).toThrow('LIVE_AUDIO_MAGIC_INVALID');

    const guard = new LiveAudioSequenceGuard();
    expect(guard.accept('LOCAL_MIC', 3)).toEqual({ accepted: true, missing: 0 });
    expect(guard.accept('LOCAL_MIC', 3)).toEqual({ accepted: false, missing: 0 });
    expect(guard.accept('LOCAL_MIC', 5)).toEqual({ accepted: true, missing: 1 });
  });
});
