import { describe, expect, it } from 'vitest';
import { GenerativeProviderError } from '@morubi/ai';
import { jobFailureIsTerminal, sanitizeJobErrorCode } from './job-failure.js';

describe('worker job failure policy', () => {
  it('retries recoverable failures until maxAttempts', () => {
    const recoverable = new GenerativeProviderError('DEEPSEEK_HTTP_503', true, 503);
    expect(jobFailureIsTerminal({ attempts: 1, maxAttempts: 3 }, recoverable)).toBe(false);
    expect(jobFailureIsTerminal({ attempts: 3, maxAttempts: 3 }, recoverable)).toBe(true);
  });

  it('terminates explicitly non-retryable failures immediately', () => {
    const permanent = new GenerativeProviderError('DEEPSEEK_HTTP_400', false, 400);
    expect(jobFailureIsTerminal({ attempts: 1, maxAttempts: 3 }, permanent)).toBe(true);
  });

  it('persists stable codes without leaking arbitrary error messages', () => {
    expect(sanitizeJobErrorCode(new Error('POST_CALL_TRANSCRIPT_STALE'))).toBe(
      'POST_CALL_TRANSCRIPT_STALE'
    );
    expect(
      sanitizeJobErrorCode(new DOMException('request included secret-token', 'TimeoutError'))
    ).toBe('TIMEOUT_ERROR');
    expect(sanitizeJobErrorCode(new Error('request included secret-token'))).toBe('UNKNOWN');
    expect(sanitizeJobErrorCode('raw failure')).toBe('UNKNOWN');
  });
});
