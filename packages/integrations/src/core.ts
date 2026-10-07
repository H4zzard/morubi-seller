import type { CanonicalContactInput, CanonicalDealInput, SourceEnvelope } from '@morubi/domain';

export type CRMProvider = string;

export interface CRMConnectorCapabilities {
  contacts: true;
  deals: true;
  pipelines: boolean;
  stages: boolean;
  conversations: boolean;
  messages: boolean;
  incrementalSync: boolean;
  webhooks: boolean;
  credentialRefresh: boolean;
}

export interface CredentialMaterial {
  readonly [key: string]: string;
}

export interface CredentialStore {
  put(reference: string, value: CredentialMaterial): Promise<void>;
  get(reference: string): Promise<CredentialMaterial | null>;
  delete(reference: string): Promise<void>;
}

export interface CRMConnectorContext {
  organizationId: string;
  connectionId: string;
  externalAccountId: string;
  secretReference: string | null;
  credentials(): Promise<CredentialMaterial | null>;
}

export interface CRMAccount {
  externalAccountId: string;
  externalAccountName: string;
  scopes: string[];
}

export interface ConnectorHealth {
  ok: boolean;
  account?: CRMAccount;
}

export interface ConnectorPageRequest {
  cursor?: string | null;
  updatedSince?: Date | null;
  limit?: number;
}

export interface ConnectorPage<T> {
  items: T[];
  nextCursor: string | null;
  watermark: Date | null;
}

export interface NormalizedContactRecord {
  source: SourceEnvelope;
  input: CanonicalContactInput;
}

export interface NormalizedDealRecord {
  source: SourceEnvelope;
  input: Omit<CanonicalDealInput, 'contactIds' | 'ownerMembershipId'>;
  relatedContactExternalIds: string[];
  externalOwner?: {
    id: string;
    name?: string | null;
    email?: string | null;
  } | null;
}

export interface NormalizedPipeline {
  externalId: string;
  name: string;
  archived: boolean;
}

export interface NormalizedStage {
  externalId: string;
  pipelineExternalId: string;
  name: string;
  position: number | null;
  status: 'OPEN' | 'WON' | 'LOST' | null;
  archived: boolean;
}

/**
 * Deliberately read-only. Write operations do not belong to the Phase 3 contract.
 * Provider DTOs must be normalized inside the adapter before crossing this boundary.
 */
export interface CRMConnector {
  readonly provider: CRMProvider;
  readonly capabilities: CRMConnectorCapabilities;

  testConnection(context: CRMConnectorContext): Promise<ConnectorHealth>;
  getAccount(context: CRMConnectorContext): Promise<CRMAccount>;
  listContacts(
    context: CRMConnectorContext,
    request: ConnectorPageRequest
  ): Promise<ConnectorPage<NormalizedContactRecord>>;
  getContact?(
    context: CRMConnectorContext,
    externalId: string
  ): Promise<NormalizedContactRecord | null>;
  listDeals(
    context: CRMConnectorContext,
    request: ConnectorPageRequest
  ): Promise<ConnectorPage<NormalizedDealRecord>>;
  getDeal?(context: CRMConnectorContext, externalId: string): Promise<NormalizedDealRecord | null>;
  listPipelines?(context: CRMConnectorContext): Promise<NormalizedPipeline[]>;
  listStages?(context: CRMConnectorContext): Promise<NormalizedStage[]>;
}

export class CRMConnectorRegistry {
  private readonly connectors = new Map<string, CRMConnector>();

  public register(connector: CRMConnector): void {
    const provider = normalizeProvider(connector.provider);
    if (this.connectors.has(provider)) {
      throw new Error(`Connector already registered: ${provider}`);
    }
    this.connectors.set(provider, connector);
  }

  public get(provider: string): CRMConnector | null {
    return this.connectors.get(normalizeProvider(provider)) ?? null;
  }

  public listProviders(): string[] {
    return [...this.connectors.keys()].sort();
  }
}

export function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase();
}
