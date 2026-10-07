import { describe, expect, it } from 'vitest';
import { slugifyOrganizationName } from './index.js';

describe('slugifyOrganizationName', () => {
  it('normaliza acentos e separadores', () => {
    expect(slugifyOrganizationName('  Morubí Vendas & IA  ')).toBe('morubi-vendas-ia');
  });
});
