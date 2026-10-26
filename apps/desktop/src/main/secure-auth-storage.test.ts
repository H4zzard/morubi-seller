import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let userDataDirectory = '';
const safeStorageMocks = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(() => true)
}));

vi.mock('electron', () => ({
  app: { getPath: () => userDataDirectory },
  safeStorage: {
    isEncryptionAvailable: safeStorageMocks.isEncryptionAvailable,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`, 'utf8'),
    decryptString: (value: Buffer) => value.toString('utf8').replace(/^encrypted:/u, '')
  }
}));

describe('SecureAuthStorage', () => {
  beforeEach(async () => {
    safeStorageMocks.isEncryptionAvailable.mockClear();
    userDataDirectory = await mkdtemp(join(tmpdir(), 'morubi-auth-'));
  });

  it('does not access the operating-system keychain when there is no saved session', async () => {
    const { SecureAuthStorage } = await import('./secure-auth-storage.js');

    await expect(new SecureAuthStorage().read()).resolves.toBeNull();
    expect(safeStorageMocks.isEncryptionAvailable).not.toHaveBeenCalled();
  });

  afterEach(async () => {
    await rm(userDataDirectory, { recursive: true, force: true });
  });

  it('survives a new storage instance without writing plaintext and clears on logout', async () => {
    const { SecureAuthStorage } = await import('./secure-auth-storage.js');
    const original = new SecureAuthStorage();
    await original.write({ cookie: 'session=secret', organizationId: 'org-1' });

    const bytes = await readFile(join(userDataDirectory, 'auth-state.bin'));
    expect(bytes.toString('utf8')).not.toBe(
      JSON.stringify({ cookie: 'session=secret', organizationId: 'org-1' })
    );

    const restarted = new SecureAuthStorage();
    await expect(restarted.read()).resolves.toEqual({
      cookie: 'session=secret',
      organizationId: 'org-1'
    });

    await restarted.clear();
    await expect(restarted.read()).resolves.toBeNull();
  });
});
