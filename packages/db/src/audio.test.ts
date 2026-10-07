import { describe, expect, it } from 'vitest';
import { TranscriptionProviderError } from '@morubi/ai';
import {
  audioIdempotencyKey,
  commercialEventSourceFromProvider,
  syntheticWavFixture,
  transcriptionFailureState
} from './audio.js';
import { canEventAdvanceState } from './intelligence.js';

describe('audio intelligence invariants', () => {
  it('derives stable, message-scoped idempotency without cross-context deduplication', () => {
    const bytes = syntheticWavFixture('Gostei, mas achei o valor muito alto.');
    expect(audioIdempotencyKey('message-a', bytes)).toEqual(
      audioIdempotencyKey('message-a', bytes)
    );
    expect(audioIdempotencyKey('message-a', bytes).key).not.toBe(
      audioIdempotencyKey('message-b', bytes).key
    );
  });

  it('retries transient provider failures only up to maxAttempts', () => {
    const transient = new TranscriptionProviderError('GEMINI_500', true, 500);
    expect(transcriptionFailureState({ attempts: 1, maxAttempts: 3 }, transient)).toBe('RETRY');
    expect(transcriptionFailureState({ attempts: 3, maxAttempts: 3 }, transient)).toBe('FAILED');
    expect(
      transcriptionFailureState({ attempts: 1, maxAttempts: 3 }, new Error('AUDIO_CORRUPT'))
    ).toBe('FAILED');
  });

  it('does not let an older late transcript regress the current commercial state', () => {
    const latest = new Date('2026-01-01T10:02:00Z');
    expect(canEventAdvanceState(latest, '2026-01-01T10:01:00Z')).toBe(false);
    expect(canEventAdvanceState(latest, '2026-01-01T10:03:00Z')).toBe(true);
  });

  it('preserves the canonical source when promoting a transcript', () => {
    expect(commercialEventSourceFromProvider('whatsapp-cloud')).toBe('WHATSAPP');
    expect(commercialEventSourceFromProvider('fixture-audio')).toBe('MANUAL');
  });
});
