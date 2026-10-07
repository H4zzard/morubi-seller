import { describe, expect, it } from 'vitest';
import { createOrganizationSchema, signInSchema } from './index.js';

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
});
