export interface AttemptedJob {
  attempts: number;
  maxAttempts: number;
}

export interface JobFailureOutcome {
  errorCode: string;
  terminal: boolean;
}

const errorCodePattern = /^[A-Z][A-Z0-9_]*(?::[A-Z0-9_]+)*$/;

export function sanitizeJobErrorCode(error: unknown, maximumLength = 80): string {
  if (!(error instanceof Error)) return 'UNKNOWN';
  const message = error.message.trim();
  if (message.length > 0 && message.length <= maximumLength && errorCodePattern.test(message))
    return message;
  if (error.name !== 'Error') {
    const normalizedName = error.name
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .replace(/[^A-Za-z0-9_]/g, '_')
      .toUpperCase()
      .slice(0, maximumLength);
    if (normalizedName && errorCodePattern.test(normalizedName)) return normalizedName;
  }
  return 'UNKNOWN';
}

export function jobFailureIsTerminal(job: AttemptedJob, error: unknown): boolean {
  if (job.attempts >= job.maxAttempts) return true;
  if (typeof error !== 'object' || error === null || !('retryable' in error)) return false;
  return error.retryable === false;
}
