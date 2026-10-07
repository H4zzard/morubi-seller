import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';

export interface ObjectStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  createReadStream(key: string): Readable;
}

export function audioStorageKey(
  organizationId: string,
  assetId: string,
  extension = 'bin'
): string {
  if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !/^[0-9a-f-]{36}$/i.test(assetId))
    throw new Error('INVALID_STORAGE_IDENTIFIER');
  if (!/^[a-z0-9]{1,8}$/i.test(extension)) throw new Error('INVALID_STORAGE_EXTENSION');
  return `organizations/${organizationId}/audio/${assetId}.${extension.toLowerCase()}`;
}

export class LocalObjectStorage implements ObjectStorage {
  private readonly root: string;

  public constructor(root: string) {
    this.root = resolve(root);
  }

  private path(key: string): string {
    if (
      !key ||
      key.includes('\\') ||
      key.split('/').some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('INVALID_STORAGE_KEY');
    const target = resolve(this.root, ...key.split('/'));
    if (!target.startsWith(`${this.root}${sep}`)) throw new Error('INVALID_STORAGE_KEY');
    return target;
  }

  public async put(key: string, data: Uint8Array): Promise<void> {
    const target = this.path(key);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, data, { flag: 'wx' });
    await rename(temporary, target);
  }

  public get(key: string): Promise<Uint8Array> {
    return readFile(this.path(key));
  }

  public async delete(key: string): Promise<void> {
    try {
      await unlink(this.path(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      await access(this.path(key));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }

  public createReadStream(key: string): Readable {
    return createReadStream(this.path(key));
  }
}

export interface ExternalMediaFetcherOptions {
  maxBytes: number;
  timeoutMs: number;
  maxRedirects?: number;
  allowedMimeTypes: readonly string[];
}

type AddressResolver = (hostname: string) => Promise<string[]>;
type Fetcher = typeof fetch;

function privateAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  if (
    normalized === '::1' ||
    normalized === '::' ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd')
  )
    return true;
  if (isIP(normalized) !== 4) return false;
  const [a = 0, b = 0] = normalized.split('.').map(Number);
  return (
    a === 10 ||
    a === 127 ||
    a === 0 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

export class ExternalMediaFetcher {
  public constructor(
    private readonly resolveAddresses: AddressResolver,
    private readonly fetcher: Fetcher = fetch
  ) {}

  public async fetch(
    url: string,
    options: ExternalMediaFetcherOptions
  ): Promise<{ data: Uint8Array; mimeType: string }> {
    let current = new URL(url);
    const redirects = options.maxRedirects ?? 3;
    for (let attempt = 0; attempt <= redirects; attempt += 1) {
      await this.assertSafe(current);
      const response = await this.fetcher(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: { accept: options.allowedMimeTypes.join(', ') }
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location || attempt === redirects) throw new Error('MEDIA_REDIRECT_REJECTED');
        current = new URL(location, current);
        continue;
      }
      if (!response.ok) throw new Error(`MEDIA_HTTP_${response.status}`);
      const mimeType = (response.headers.get('content-type') ?? '')
        .split(';', 1)[0]!
        .trim()
        .toLowerCase();
      if (!options.allowedMimeTypes.includes(mimeType)) throw new Error('MEDIA_MIME_REJECTED');
      const declared = Number(response.headers.get('content-length') ?? 0);
      if (declared > options.maxBytes) throw new Error('MEDIA_TOO_LARGE');
      if (!response.body) throw new Error('MEDIA_EMPTY_BODY');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > options.maxBytes) {
          await reader.cancel();
          throw new Error('MEDIA_TOO_LARGE');
        }
        chunks.push(value);
      }
      const data = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return { data, mimeType };
    }
    throw new Error('MEDIA_REDIRECT_REJECTED');
  }

  private async assertSafe(url: URL): Promise<void> {
    if (url.protocol !== 'https:' || url.username || url.password || url.port)
      throw new Error('MEDIA_URL_REJECTED');
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost')) throw new Error('MEDIA_URL_REJECTED');
    const addresses = await this.resolveAddresses(host);
    if (addresses.length === 0 || addresses.some(privateAddress))
      throw new Error('MEDIA_URL_REJECTED');
  }
}
