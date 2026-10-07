import { describe, expect, it } from 'vitest';
import { runFixtureSpeechToCardBenchmark, runSyntheticLiveLoad } from './index.js';

describe('synthetic concurrent live calls', () => {
  for (const sessions of [10, 25, 50]) {
    it(`${sessions} sessions remain bounded`, async () => {
      const result = await runSyntheticLiveLoad({ sessions, turnsPerSession: 20 });
      console.info('LIVE_LOAD_RESULT', JSON.stringify(result));
      expect(result.turns).toBe(sessions * 20);
      expect(result.finalTurns).toBe(sessions * 20);
      expect(result.peakBufferedBytes).toBeLessThanOrEqual(64 * 1024);
    });
  }

  it('measures the CPU-only fixture speech-to-card path without claiming a network SLA', async () => {
    const result = await runFixtureSpeechToCardBenchmark(100);
    console.info('LIVE_SPEECH_TO_CARD_FIXTURE', JSON.stringify(result));
    expect(result.samples).toBe(100);
    expect(result.p95Ms).toBeLessThan(50);
  });
});
