import { describe, expect, it, vi } from 'vitest';
import {
  DesktopApiError,
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
      vi.fn<typeof fetch>(() => Promise.resolve(new Response('database-secret', { status: 401 })))
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

  it('distinguishes a disabled Calls service from an empty current session', async () => {
    const disabledStorage = new MemoryAuthStorage();
    disabledStorage.state = { cookie: 'session=abc', organizationId: 'org-1' };
    const disabled = new DesktopApiClient(
      'http://localhost:4000',
      disabledStorage,
      'morubi-app://app',
      vi.fn<typeof fetch>(() => Promise.resolve(new Response(null, { status: 404 })))
    );
    await expect(disabled.getCurrentLiveCall()).rejects.toThrow('LIVE_CALLS_SERVICE_DISABLED');

    const readyStorage = new MemoryAuthStorage();
    readyStorage.state = { cookie: 'session=abc', organizationId: 'org-1' };
    const ready = new DesktopApiClient(
      'http://localhost:4000',
      readyStorage,
      'morubi-app://app',
      vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ session: null })))
    );
    await expect(ready.getCurrentLiveCall()).resolves.toEqual({ session: null });
  });

  it('preserves a sanitized live-call conflict and its request id', async () => {
    const storage = new MemoryAuthStorage();
    storage.state = { cookie: 'session=abc', organizationId: 'org-1' };
    const client = new DesktopApiClient(
      'http://localhost:4000',
      storage,
      'morubi-app://app',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            {
              error: {
                code: 'CONFLICT',
                message: 'A captura de calls não está habilitada para esta organização.',
                requestId: 'request-safe-1'
              }
            },
            { status: 409 }
          )
        )
      )
    );

    const failure = await client
      .startLiveCall('session-1', {
        consentConfirmed: true,
        consentMode: 'MANUAL_CONFIRMATION',
        policyVersion: 'live-capture-consent-v2',
        captureMode: 'MIXED',
        transcriptionMode: 'DISABLED',
        captureSources: ['LOCAL_MIC', 'SYSTEM_AUDIO']
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DesktopApiError);
    expect(failure).toMatchObject({
      message: 'A captura de calls não está habilitada para esta organização.',
      status: 409,
      code: 'CONFLICT',
      requestId: 'request-safe-1'
    });
  });

  it('does not expose an untrusted backend body for unexpected failures', async () => {
    const storage = new MemoryAuthStorage();
    storage.state = { cookie: 'session=abc', organizationId: 'org-1' };
    const client = new DesktopApiClient(
      'http://localhost:4000',
      storage,
      'morubi-app://app',
      vi.fn<typeof fetch>(() =>
        Promise.resolve(
          Response.json(
            {
              error: {
                code: 'INTERNAL_ERROR',
                message: 'database-secret',
                requestId: 'request-safe-2'
              }
            },
            { status: 500 }
          )
        )
      )
    );

    await expect(client.endLiveCall('session-1')).rejects.toThrow(
      'Não foi possível atualizar a call ao vivo.'
    );
  });

  it('builds WSS credentials only from encrypted main-process state', async () => {
    const storage = new MemoryAuthStorage();
    storage.state = { cookie: 'session=secret-cookie', organizationId: 'org-1' };
    const client = new DesktopApiClient(
      'https://api.morubi.example',
      storage,
      'morubi-app://app',
      vi.fn<typeof fetch>()
    );
    const connection = await client.liveAudioConnection('00000000-0000-4000-8000-000000000001');
    expect(connection.url).toBe(
      'wss://api.morubi.example/v1/live-calls/00000000-0000-4000-8000-000000000001/audio'
    );
    expect(connection.headers).toMatchObject({
      cookie: 'session=secret-cookie',
      origin: 'morubi-app://app',
      'x-organization-id': 'org-1',
      'x-morubi-client': 'desktop'
    });
  });

  it('rejects unencrypted remote audio transport while allowing local development', async () => {
    const storage = new MemoryAuthStorage();
    storage.state = { cookie: 'session=secret-cookie', organizationId: 'org-1' };
    const remote = new DesktopApiClient(
      'http://api.morubi.example',
      storage,
      'morubi-app://app',
      vi.fn<typeof fetch>()
    );
    await expect(remote.liveAudioConnection('session-1')).rejects.toThrow(
      'LIVE_AUDIO_TLS_REQUIRED'
    );
    const local = new DesktopApiClient(
      'http://127.0.0.1:4000',
      storage,
      'morubi-app://app',
      vi.fn<typeof fetch>()
    );
    await expect(local.liveAudioConnection('session-1')).resolves.toMatchObject({
      url: 'ws://127.0.0.1:4000/v1/live-calls/session-1/audio'
    });
  });
});
