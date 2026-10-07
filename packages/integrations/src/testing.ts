import type { CredentialMaterial, CredentialStore } from './core.js';
export { FixtureCRMConnector, createFixtureCRMData } from './providers/fixture/connector.js';
export type {
  FixtureCRMData,
  FixtureCRMOptions,
  FixtureFailure
} from './providers/fixture/connector.js';
export type { FixtureContactDTO, FixtureDealDTO } from './providers/fixture/dtos.js';

export class InMemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, CredentialMaterial>();

  public put(reference: string, value: CredentialMaterial): Promise<void> {
    this.values.set(reference, Object.freeze({ ...value }));
    return Promise.resolve();
  }

  public get(reference: string): Promise<CredentialMaterial | null> {
    const value = this.values.get(reference);
    return Promise.resolve(value ? Object.freeze({ ...value }) : null);
  }

  public delete(reference: string): Promise<void> {
    this.values.delete(reference);
    return Promise.resolve();
  }
}
