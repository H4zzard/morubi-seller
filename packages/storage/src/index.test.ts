import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ExternalMediaFetcher, LocalObjectStorage } from './index.js';

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
  root = undefined;
});

describe('LocalObjectStorage', () => {
  it('stores private bytes and rejects path traversal', async () => {
    root = await mkdtemp(join(tmpdir(), 'morubi-audio-'));
    const storage = new LocalObjectStorage(root);
    await storage.put('organizations/one/audio/item.wav', new Uint8Array([1, 2, 3]));
    expect([...(await storage.get('organizations/one/audio/item.wav'))]).toEqual([1, 2, 3]);
    expect(() => storage.get('../secret')).toThrow('INVALID_STORAGE_KEY');
  });
});

describe('ExternalMediaFetcher', () => {
  it.each([
    'http://localhost/audio.wav',
    'http://127.0.0.1/audio.wav',
    'file:///etc/passwd',
    'ftp://media.example/audio.wav'
  ])('blocks unexpected or local URL %s', async (url) => {
    const client = new ExternalMediaFetcher(
      () => Promise.resolve(['203.0.113.8']),
      () => Promise.resolve(new Response())
    );
    await expect(
      client.fetch(url, { maxBytes: 100, timeoutMs: 100, allowedMimeTypes: ['audio/wav'] })
    ).rejects.toThrow('MEDIA_URL_REJECTED');
  });

  it.each(['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1', '::1'])(
    'blocks private destination %s',
    async (address) => {
      const client = new ExternalMediaFetcher(
        () => Promise.resolve([address]),
        () => Promise.resolve(new Response())
      );
      await expect(
        client.fetch('https://media.example/audio.wav', {
          maxBytes: 100,
          timeoutMs: 100,
          allowedMimeTypes: ['audio/wav']
        })
      ).rejects.toThrow('MEDIA_URL_REJECTED');
    }
  );

  it('enforces streaming byte limits', async () => {
    const client = new ExternalMediaFetcher(
      () => Promise.resolve(['203.0.113.8']),
      () =>
        Promise.resolve(
          new Response(new Uint8Array(11), { headers: { 'content-type': 'audio/wav' } })
        )
    );
    await expect(
      client.fetch('https://media.example/audio.wav', {
        maxBytes: 10,
        timeoutMs: 100,
        allowedMimeTypes: ['audio/wav']
      })
    ).rejects.toThrow('MEDIA_TOO_LARGE');
  });
});
