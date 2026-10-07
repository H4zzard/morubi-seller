import { describe, expect, it } from 'vitest';
import { payloadHash, sourceIdempotencyKey } from './commercial.js';

describe('commercial source identity', () => {
  it('hashes equivalent payloads deterministically', () => {
    expect(payloadHash({ b: 2, a: { y: 2, x: 1 } })).toBe(payloadHash({ a: { x: 1, y: 2 }, b: 2 }));
  });

  it('prefers a provider idempotency key over the payload fallback', () => {
    expect(
      sourceIdempotencyKey({
        provider: 'fixture',
        externalId: '1',
        idempotencyKey: ' event-1 ',
        rawPayload: {}
      })
    ).toBe('event-1');
  });

  it('namespaces the fingerprint fallback by external resource', () => {
    const payload = { state: 'same' };
    const first = sourceIdempotencyKey({
      provider: 'fixture',
      externalId: '1',
      rawPayload: payload
    });
    const second = sourceIdempotencyKey({
      provider: 'fixture',
      externalId: '2',
      rawPayload: payload
    });
    expect(first).not.toBe(second);
  });
});
