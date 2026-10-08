import { describe, expect, it, vi } from 'vitest';
import {
  DesktopApiClient,
  cookieHeader,
  type AuthStorage
} from './desktop-api-client.js';
import type { StoredAuthState } from './secure-auth-storage.js';

class MemoryAuthStorage implements AuthStorage {
  public state: StoredAuthState | null = null;

  public read(): Promise<StoredAuthState | null> {
    return Promise.resolve(this.state);
  }

  public write(state: StoredAuthState): Promise<void> {
    this.state = state;
    return Promise.resolve();
  }

  public clear(): Promise<void> {
    this.state = null;
    return Promise.resolve();
  }
}

describe('DesktopApiClient authentication', () => {
  it('preserves every cookie returned by Better Auth', () => {
    const headers = new Headers();
    headers.append('set-cookie', 'session=abc; Path=/; HttpOnly');
    headers.append('set-cookie', 'csrf=def; Path=/; SameSite=Lax');

    expect(cookieHeader(new Response(null, { headers }))).toBe('session=abc; csrf=def');
  });

  it('sends the trusted desktop origin and keeps the session outside the renderer', async () => {
    const storage = new MemoryAuthStorage();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 200,
          headers: { 'set-cookie': 'session=abc; Path=/; HttpOnly' }
        })
      )
      .mockResolvedValueOnce(
        Response.json([{ organization: { id: 'org-1' }, membership: { id: 'member-1' } }])
      )
      .mockResolvedValueOnce(
        Response.json({ user: { id: 'user-1' }, tenant: { organizationId: 'org-1' } })
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new DesktopApiClient(
      'http://localhost:4000',
      storage,
      'http://localhost:5173',
      fetcher
    );

    await client.signIn({ email: 'seller@example.com', password: 'correct-password' });

    for (const call of fetcher.mock.calls) {
      expect(new Headers(call[1]?.headers).get('origin')).toBe('http://localhost:5173');
    }
    expect(storage.state).toEqual({ cookie: 'session=abc', organizationId: 'org-1' });
  });

  it('restores an encrypted-storage session after a client restart', async () => {
    const storage = new MemoryAuthStorage();
    storage.state = { cookie: 'session=persisted', organizationId: 'org-1' };
    const fetcher = vi.fn<typeof fetch>(() =>
      Promise.resolve(Response.json({ user: { id: 'user-1' }, tenant: { id: 'org-1' } }))
    );

    const restartedClient = new DesktopApiClient(
      'http://localhost:4000',
      storage,
      'morubi-app://app',
      fetcher
    );

    await expect(restartedClient.getSession()).resolves.toMatchObject({
      tenant: { id: 'org-1' }
    });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get('cookie')).toBe(
      'session=persisted'
    );
  });

  it('maps authentication failures without exposing the server body', async () => {
    const client = new DesktopApiClient(
      'http://localhost:4000',
      new MemoryAuthStorage(),
      'morubi-app://app',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(new Response('database-secret', { status: 401 }))
      )
    );

    await expect(
      client.signIn({ email: 'seller@example.com', password: 'wrong-password' })
    ).rejects.toThrow('E-mail ou senha inválidos.');
  });

  it('always clears local credentials during logout', async () => {
    const storage = new MemoryAuthStorage();
    storage.state = { cookie: 'session=abc', organizationId: null };
    const client = new DesktopApiClient(
      'http://localhost:4000',
      storage,
      'morubi-app://app',
      vi.fn<typeof fetch>(() => Promise.reject(new Error('offline')))
    );

    await expect(client.signOut()).rejects.toThrow('offline');
    expect(storage.state).toBeNull();
  });
});
