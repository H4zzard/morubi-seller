import { ConnectorError } from './errors.js';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface RetryHooks {
  sleep?(milliseconds: number): Promise<void>;
  random?(): number;
  onRetry?(event: { attempt: number; delayMs: number; error: ConnectorError }): void;
}

export const defaultRetryPolicy: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 30_000
};

export async function withConnectorRetry<T>(
  operation: () => Promise<T>,
  policy: RetryPolicy = defaultRetryPolicy,
  hooks: RetryHooks = {}
): Promise<T> {
  const sleep = (milliseconds: number) =>
    hooks.sleep
      ? hooks.sleep(milliseconds)
      : new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
  const random = () => (hooks.random ? hooks.random() : Math.random());

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ConnectorError) || !error.retryable || attempt >= policy.maxAttempts) {
        throw error;
      }
      const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
      const jittered = Math.max(1, Math.round(exponential * (0.5 + random() * 0.5)));
      const delayMs = Math.max(jittered, error.options.retryAfterMs ?? 0);
      hooks.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw new Error('Retry loop exhausted unexpectedly');
}
