import { describe, expect, it } from 'vitest';
import {
  FixtureTranscriptionProvider,
  assertAudioPayload,
  detectAudioMime,
  estimateTranscriptionCost,
  validateTranscription
} from './transcription.js';

const wav = new Uint8Array([
  ...new TextEncoder().encode('RIFF'),
  0,
  0,
  0,
  0,
  ...new TextEncoder().encode('WAVEfmt MORUBI_FIXTURE:O lead perguntou sobre o prazo.')
]);

describe('audio validation', () => {
  it('matches MIME against magic bytes and caps size', () => {
    expect(detectAudioMime(wav)).toBe('audio/wav');
    expect(() => assertAudioPayload(wav, 'audio/mpeg', 10_000)).toThrow('AUDIO_MAGIC_MISMATCH');
    expect(() => assertAudioPayload(wav, 'audio/wav', 2)).toThrow('AUDIO_TOO_LARGE');
  });
});

describe('transcription providers', () => {
  it('produces a deterministic validated fixture transcript', async () => {
    const result = validateTranscription(
      await new FixtureTranscriptionProvider().transcribe({
        audio: wav,
        mimeType: 'audio/wav',
        durationMs: 1_000
      })
    );
    expect(result.text).toContain('prazo');
  });
  it('rejects empty output and computes cost', async () => {
    await expect(
      new FixtureTranscriptionProvider('EMPTY')
        .transcribe({ audio: wav, mimeType: 'audio/wav', durationMs: 1_000 })
        .then(validateTranscription)
    ).rejects.toThrow();
    expect(
      estimateTranscriptionCost(
        { inputTokens: 1_000, outputTokens: 500, audioDurationMs: 60_000, measurement: 'ACTUAL' },
        {
          inputMicrosPerMillionTokens: 1000n,
          outputMicrosPerMillionTokens: 2000n,
          audioMicrosPerMinute: 3000n
        }
      )
    ).toBe(3002n);
  });
  it('covers non-retryable corruption and unknown language fixtures', async () => {
    await expect(
      Promise.resolve().then(() =>
        new FixtureTranscriptionProvider('CORRUPT').transcribe({
          audio: wav,
          mimeType: 'audio/wav',
          durationMs: 1_000
        })
      )
    ).rejects.toMatchObject({ retryable: false });
    const result = await new FixtureTranscriptionProvider('WRONG_LANGUAGE').transcribe({
      audio: wav,
      mimeType: 'audio/wav',
      durationMs: 1_000
    });
    expect(result.language).toBe('und');
  });
});
