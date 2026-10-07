import { describe, expect, it } from 'vitest';
import { assertLiveSessionTransition, liveCommercialEventSource } from './live-calls.js';

describe('live call domain helpers', () => {
  it('allows the expected lifecycle and rejects turns after end', () => {
    expect(() => assertLiveSessionTransition('DETECTED', 'STARTING')).not.toThrow();
    expect(() => assertLiveSessionTransition('ACTIVE', 'ENDING')).not.toThrow();
    expect(() => assertLiveSessionTransition('ENDING', 'ENDED')).not.toThrow();
    expect(() => assertLiveSessionTransition('ENDED', 'ACTIVE')).toThrow(
      'LIVE_SESSION_INVALID_TRANSITION'
    );
  });

  it('maps Meet and Zoom without inventing a Teams source enum', () => {
    expect(liveCommercialEventSource('MEET')).toBe('MEET');
    expect(liveCommercialEventSource('ZOOM')).toBe('ZOOM');
    expect(liveCommercialEventSource('TEAMS')).toBe('OTHER');
  });
});
