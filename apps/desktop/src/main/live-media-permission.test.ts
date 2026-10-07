import { describe, expect, it } from 'vitest';
import { LiveMediaPermissionGate } from './live-media-permission.js';

describe('live media permission gate', () => {
  it('grants one short-lived audio-only request from the authorized renderer', () => {
    let now = 1_000;
    const gate = new LiveMediaPermissionGate(true, 30_000, () => now);
    expect(gate.authorize()).toBe(new Date(31_000).toISOString());
    expect(
      gate.check({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaType: 'audio'
      })
    ).toBe(true);
    expect(
      gate.consume({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaTypes: ['audio']
      })
    ).toBe(true);
    expect(
      gate.consume({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaTypes: ['audio']
      })
    ).toBe(false);
    now += 1;
  });

  it('rejects video, another renderer, expiration, disabled capture, and reset after crash', () => {
    let now = 1_000;
    const gate = new LiveMediaPermissionGate(true, 100, () => now);
    gate.authorize();
    expect(
      gate.check({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaType: 'video'
      })
    ).toBe(false);
    expect(
      gate.consume({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaTypes: ['audio', 'video']
      })
    ).toBe(false);
    expect(
      gate.consume({
        requestingWebContentsId: 8,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaTypes: ['audio']
      })
    ).toBe(false);
    now = 1_101;
    expect(
      gate.consume({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaTypes: ['audio']
      })
    ).toBe(false);
    now = 2_000;
    gate.authorize();
    gate.reset();
    expect(
      gate.consume({
        requestingWebContentsId: 7,
        allowedWebContentsId: 7,
        permission: 'media',
        mediaTypes: ['audio']
      })
    ).toBe(false);
    expect(() => new LiveMediaPermissionGate(false).authorize()).toThrow('LIVE_CAPTURE_DISABLED');
  });
});
