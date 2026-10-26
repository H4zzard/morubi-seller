import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebSocketServer } from 'ws';
import { decodeLiveAudioPacket, encodeLiveAudioAcknowledgement } from '@morubi/live-calls';
import { DesktopApiClient, type AuthStorage } from './desktop-api-client.js';
import { LiveAudioTransportClient } from './live-audio-transport.js';
import type { StoredAuthState } from './secure-auth-storage.js';

class MemoryStorage implements AuthStorage {
  public constructor(public state: StoredAuthState | null) {}
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

const servers: WebSocketServer[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          for (const client of server.clients) client.terminate();
          server.close(() => resolve());
        })
    )
  );
});

async function serverUrl(server: WebSocketServer): Promise<string> {
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TEST_SERVER_ADDRESS_MISSING');
  return `http://127.0.0.1:${address.port}`;
}

describe('LiveAudioTransportClient', () => {
  it('authenticates from main-process state and resolves only after a binary server ack', async () => {
    const server = new WebSocketServer({ port: 0 });
    servers.push(server);
    const baseUrl = await serverUrl(server);
    const packet = vi.fn();
    const headers = vi.fn();
    server.on('connection', (socket, request) => {
      headers(request.headers);
      socket.send(JSON.stringify({ type: 'ready', sessionId: 'session-1' }));
      socket.on('message', (data, isBinary) => {
        if (!isBinary) return;
        if (!Buffer.isBuffer(data)) throw new Error('TEST_EXPECTED_BUFFER');
        const decoded = decodeLiveAudioPacket(
          new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        );
        packet(decoded);
        socket.send(encodeLiveAudioAcknowledgement(decoded.source, decoded.sequence));
      });
    });
    const storage = new MemoryStorage({ cookie: 'session=secret', organizationId: 'org-1' });
    const client = new LiveAudioTransportClient(
      new DesktopApiClient(baseUrl, storage, 'morubi-app://app', vi.fn<typeof fetch>())
    );
    await client.start('session-1');
    await client.send({
      id: 'chunk-1',
      source: 'LOCAL_MIC',
      sequence: 0,
      capturedAt: new Date(),
      durationMs: 100,
      mimeType: 'audio/pcm;rate=16000',
      data: new Uint8Array(3_200)
    });
    expect(packet).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'LOCAL_MIC', sequence: 0 })
    );
    expect(headers.mock.calls[0]?.[0]).toMatchObject({
      cookie: 'session=secret',
      'x-organization-id': 'org-1',
      origin: 'morubi-app://app'
    });
    await client.stop();
  });

  it('reconnects with bounded retries and reports state without stopping capture itself', async () => {
    const server = new WebSocketServer({ port: 0 });
    servers.push(server);
    const baseUrl = await serverUrl(server);
    let connections = 0;
    server.on('connection', (socket) => {
      connections += 1;
      socket.send(JSON.stringify({ type: 'ready', sessionId: 'session-2' }));
      if (connections === 1) setTimeout(() => socket.close(1011, 'temporary'), 10);
    });
    const statuses: string[] = [];
    const client = new LiveAudioTransportClient(
      new DesktopApiClient(
        baseUrl,
        new MemoryStorage({ cookie: 'session=secret', organizationId: 'org-1' }),
        'morubi-app://app',
        vi.fn<typeof fetch>()
      )
    );
    client.onStatus((status) => statuses.push(status.state));
    await client.start('session-2');
    await vi.waitFor(() => expect(connections).toBeGreaterThanOrEqual(2), { timeout: 3_000 });
    expect(statuses).toContain('RECONNECTING');
    expect(statuses.at(-1)).toBe('CONNECTED');
    await client.stop();
  });
});
