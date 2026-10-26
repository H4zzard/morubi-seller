import { describe, expect, it } from 'vitest';
import {
  createOrganizationSchema,
  liveCallHeartbeatSchema,
  signInSchema,
  startLiveCallSchema
} from './index.js';

describe('foundation validation', () => {
  it('rejeita slug inseguro', () => {
    expect(createOrganizationSchema.safeParse({ name: 'Acme', slug: '../acme' }).success).toBe(
      false
    );
  });

  it('normaliza email de login', () => {
    const value = signInSchema.parse({ email: 'SELLER@EXAMPLE.COM', password: '12345678' });
    expect(value.email).toBe('seller@example.com');
  });

  it('accepts explicit dual capture consent and content-free capture metrics', () => {
    expect(
      startLiveCallSchema.parse({
        consentConfirmed: true,
        captureMode: 'MIXED',
        transcriptionMode: 'DISABLED',
        captureSources: ['LOCAL_MIC', 'SYSTEM_AUDIO']
      }).captureSources
    ).toEqual(['LOCAL_MIC', 'SYSTEM_AUDIO']);
    expect(
      liveCallHeartbeatSchema.parse({
        bufferedBytes: 256,
        droppedChunks: 1,
        capturedChunks: 2,
        sources: []
      })
    ).toMatchObject({ bufferedBytes: 256, droppedChunks: 1, capturedChunks: 2 });
  });
});
