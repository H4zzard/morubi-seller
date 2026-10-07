import { describe, expect, it } from 'vitest';
import { errors, type AppError } from '@morubi/domain';

describe('safe error model', () => {
  it('uses stable public codes', () => {
    const error: AppError = errors.forbidden();
    expect(error.code).toBe('FORBIDDEN');
    expect(error.statusCode).toBe(403);
    expect(error.message).not.toMatch(/stack|sql|token/i);
  });
});
