import { describe, expect, it } from 'vitest';
import { parseDesktopRuntimeEnv } from './desktop-runtime-config.js';

describe('desktop runtime configuration', () => {
  it('enables consent-gated local capture in a packaged application', () => {
    expect(parseDesktopRuntimeEnv({}, true).MORUBI_LIVE_CAPTURE_ENABLED).toBe(true);
  });

  it('keeps local development disabled without an explicit opt-in', () => {
    expect(parseDesktopRuntimeEnv({}, false).MORUBI_LIVE_CAPTURE_ENABLED).toBe(false);
  });

  it('preserves an explicit packaged kill switch', () => {
    expect(
      parseDesktopRuntimeEnv({ MORUBI_LIVE_CAPTURE_ENABLED: 'false' }, true)
        .MORUBI_LIVE_CAPTURE_ENABLED
    ).toBe(false);
  });
});
