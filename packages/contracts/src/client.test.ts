import { describe, expect, it, vi } from 'vitest';
import { ApiClient } from './client.js';

describe('ApiClient', () => {
  it('adds request context and preserves caller headers', async () => {
    const fetcher = vi.fn<typeof fetch>((_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('x-organization-id')).toBe('org-1');
      expect(headers.get('x-morubi-client')).toBe('web');
      expect(headers.get('x-feature')).toBe('foundation');
      expect(headers.get('x-request-id')).toBeTruthy();
      expect(init?.credentials).toBe('include');
      return Promise.resolve(Response.json({ ok: true }));
    });

    const client = new ApiClient({
      baseUrl: 'http://localhost:4000/',
      getOrganizationId: () => 'org-1',
      getHeaders: () => ({ 'x-morubi-client': 'web' }),
      fetcher
    });

    await expect(
      client.request('/v1/me', { headers: { 'x-feature': 'foundation' } })
    ).resolves.toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('uses the current global fetch as a bound-safe default', async () => {
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ authenticated: true }))
    );
    vi.stubGlobal('fetch', fetcher);

    const client = new ApiClient({ baseUrl: 'http://localhost:4000' });

    await expect(client.request('/v1/auth/session')).resolves.toEqual({
      authenticated: true
    });
    expect(fetcher).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
