import { app, safeStorage } from 'electron';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface StoredAuthState {
  cookie: string;
  organizationId: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class SecureAuthStorage {
  readonly #filePath = join(app.getPath('userData'), 'auth-state.bin');

  public async read(): Promise<StoredAuthState | null> {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      const encrypted = await readFile(this.#filePath);
      const decrypted = safeStorage.decryptString(encrypted);
      const parsed = JSON.parse(decrypted) as unknown;
      if (!isRecord(parsed) || typeof parsed.cookie !== 'string') return null;
      const organizationId = parsed.organizationId;
      return {
        cookie: parsed.cookie,
        organizationId: typeof organizationId === 'string' ? organizationId : null
      };
    } catch {
      return null;
    }
  }

  public async write(state: StoredAuthState): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('O armazenamento seguro do sistema operacional não está disponível.');
    }
    const encrypted = safeStorage.encryptString(JSON.stringify(state));
    await writeFile(this.#filePath, encrypted, { mode: 0o600 });
  }

  public async clear(): Promise<void> {
    await unlink(this.#filePath).catch((error: unknown) => {
      if (typeof error !== 'object' || error === null || Reflect.get(error, 'code') !== 'ENOENT')
        throw error;
    });
  }
}
