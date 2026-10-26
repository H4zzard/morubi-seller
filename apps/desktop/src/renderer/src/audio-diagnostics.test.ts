import { describe, expect, it, vi } from 'vitest';
import { inspectDiagnosticStream, signalDetected } from './audio-diagnostics';

describe('audio diagnostics', () => {
  it('requires a measurable finite signal', () => {
    expect(signalDetected(0)).toBe(false);
    expect(signalDetected(0.014)).toBe(false);
    expect(signalDetected(0.015)).toBe(true);
    expect(signalDetected(Number.NaN)).toBe(false);
  });

  it('always releases every diagnostic track, including after an inspection failure', async () => {
    const stopAudio = vi.fn();
    const stopVideo = vi.fn();
    const stream = {
      getTracks: () => [{ stop: stopAudio }, { stop: stopVideo }]
    } as unknown as MediaStream;
    await expect(
      inspectDiagnosticStream(
        () => Promise.resolve(stream),
        () => Promise.reject(new Error('DIAGNOSTIC_FAILED'))
      )
    ).rejects.toThrow('DIAGNOSTIC_FAILED');
    expect(stopAudio).toHaveBeenCalledOnce();
    expect(stopVideo).toHaveBeenCalledOnce();
  });
});
