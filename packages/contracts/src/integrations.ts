export type CRMConnectionStatus =
  'ACTIVE' | 'ERROR' | 'DISCONNECTED' | 'REAUTH_REQUIRED' | 'SYNCING';
export type IntegrationHealth =
  'HEALTHY' | 'DEGRADED' | 'AUTH_ERROR' | 'RATE_LIMITED' | 'SYNC_ERROR';
export type SyncJobType = 'INITIAL' | 'INCREMENTAL' | 'WEBHOOK_RECONCILIATION' | 'MANUAL';
export type SyncJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';

export interface SyncJobSummaryDto {
  id: string;
  connectionId: string;
  type: SyncJobType;
  status: SyncJobStatus;
  counts: {
    contactsFetched: number;
    contactsApplied: number;
    dealsFetched: number;
    dealsApplied: number;
    recordsSkipped: number;
    errors: number;
    retries: number;
  };
  errorCode: string | null;
  errorSummary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface CRMConnectionDto {
  id: string;
  provider: string;
  externalAccountId: string;
  externalAccountName: string;
  status: CRMConnectionStatus;
  health: IntegrationHealth;
  scopes: string[];
  capabilities: Record<string, boolean>;
  connectedAt: string;
  lastSyncedAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastErrorAt: string | null;
  lastErrorCode: string | null;
  lastErrorSummary: string | null;
  contactCount: number;
  dealCount: number;
  latestJob: SyncJobSummaryDto | null;
}

export interface CRMIntegrationOverviewDto {
  pilotProvider: null;
  providerSelectionRequired: true;
  connections: CRMConnectionDto[];
}
