import { randomUUID } from 'node:crypto';
import type { TenantContext } from '@morubi/domain';
import {
  normalizeProvider,
  type CredentialStore,
  type CRMConnectorRegistry
} from '@morubi/integrations';
import type { MorubiDatabase } from './database.js';
import { CRMConnectionRepository } from './integration-repositories.js';

/**
 * Provider-agnostic lifecycle. A future OAuth callback owns the token exchange and
 * writes the credential before passing only its opaque reference here.
 */
export class CRMConnectionLifecycleService {
  private readonly repository: CRMConnectionRepository;

  public constructor(
    db: MorubiDatabase,
    private readonly context: TenantContext,
    private readonly registry: CRMConnectorRegistry,
    private readonly credentials: CredentialStore
  ) {
    this.repository = new CRMConnectionRepository(db, context);
  }

  public async connect(input: {
    provider: string;
    externalAccountId: string;
    secretReference?: string | null;
  }) {
    const provider = normalizeProvider(input.provider);
    const connector = this.registry.get(provider);
    if (!connector) throw new Error(`No connector registered for provider ${provider}`);
    const provisionalConnectionId = randomUUID();
    const connectorContext = {
      organizationId: this.context.organizationId,
      connectionId: provisionalConnectionId,
      externalAccountId: input.externalAccountId,
      secretReference: input.secretReference ?? null,
      credentials: () =>
        input.secretReference ? this.credentials.get(input.secretReference) : Promise.resolve(null)
    };
    const health = await connector.testConnection(connectorContext);
    if (!health.ok) throw new Error('CRM connection health check failed');
    const account = health.account ?? (await connector.getAccount(connectorContext));
    if (account.externalAccountId !== input.externalAccountId) {
      throw new Error('CRM account identity changed during connection');
    }
    return this.repository.create({
      provider,
      externalAccountId: account.externalAccountId,
      externalAccountName: account.externalAccountName,
      secretReference: input.secretReference ?? null,
      scopes: account.scopes,
      capabilities: connector.capabilities
    });
  }

  public async disconnect(connectionId: string): Promise<void> {
    const secretReference = await this.repository.disconnect(connectionId);
    if (secretReference) await this.credentials.delete(secretReference);
  }
}
