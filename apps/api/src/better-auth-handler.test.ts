import { describe, expect, it } from 'vitest';
import { trustedAuthOrigins } from './better-auth-handler.js';

describe('trustedAuthOrigins', () => {
  const origins = {
    WEB_ORIGIN: 'https://app.example.com',
    DESKTOP_DEV_ORIGIN: 'http://localhost:5173',
    DESKTOP_APP_ORIGIN: 'morubi-app://app'
  } as const;

  it('allows only web and local Electron origins outside production', () => {
    expect(trustedAuthOrigins({ ...origins, NODE_ENV: 'development' })).toEqual([
      origins.WEB_ORIGIN,
      origins.DESKTOP_DEV_ORIGIN
    ]);
  });

  it('replaces localhost with the secure Electron protocol in production', () => {
    expect(trustedAuthOrigins({ ...origins, NODE_ENV: 'production' })).toEqual([
      origins.WEB_ORIGIN,
      origins.DESKTOP_APP_ORIGIN
    ]);
  });
});
