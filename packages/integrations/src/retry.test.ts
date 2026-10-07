import { describe, expect, it, vi } from 'vitest';
import { classifyHttpError, redactCredentials, safeConnectorError } from './errors.js';
import { withConnectorRetry } from './retry.js';

describe('connector retry and redaction', () => {
  it('retries 429, honors retry-after and eventually recovers', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(classifyHttpError({ statusCode: 429, retryAfterMs: 900 }))
      .mockResolvedValue('ok');
    const delays: number[] = [];
    await expect(
      withConnectorRetry(
        operation,
        { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 },
        { random: () => 0, sleep: (delay) => (delays.push(delay), Promise.resolve()) }
      )
    ).resolves.toBe('ok');
    expect(delays).toEqual([900]);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry authentication, scope or invalid responses', async () => {
    const sleep = vi.fn<() => Promise<void>>().mockResolvedValue();
    await expect(
      withConnectorRetry(() => Promise.reject(classifyHttpError({ statusCode: 401 })), undefined, {
        sleep
      })
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED', retryable: false });
    expect(sleep).not.toHaveBeenCalled();
  });

  it('redacts nested credential keys and returns only safe errors', () => {
    const value = redactCredentials({
      accessToken: 'secret-a',
      nested: { refresh_token: 'secret-b', account: 'visible' }
    });
    expect(value).toEqual({
      accessToken: '[REDACTED]',
      nested: { refresh_token: '[REDACTED]', account: 'visible' }
    });
    expect(safeConnectorError(new Error('token=secret-a'))).toEqual({
      code: 'UNKNOWN',
      message: 'A integração não pôde concluir a operação.',
      retryable: false
    });
  });
});
