import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  CRMConnectionDto,
  SyncJobStatus,
  SyncJobSummaryDto,
  SyncJobType
} from '@morubi/contracts';
import { errors, type TenantContext } from '@morubi/domain';
import type { CRMConnectorCapabilities } from '@morubi/integrations';
import type { MorubiDatabase } from './database.js';
import { auditLogs, crmConnections, syncJobs } from './schema.js';
import { setTenantContext } from './tenant.js';

export interface SyncCheckpoint {
  contactsCursor?: string | null;
  dealsCursor?: string | null;
  contactsWatermark?: string | null;
  dealsWatermark?: string | null;
  phase?: 'CONTACTS' | 'DEALS';
}

export interface SyncCounts {
  contactsFetched: number;
  contactsApplied: number;
  dealsFetched: number;
  dealsApplied: number;
  recordsSkipped: number;
  errors: number;
  retries: number;
}

const emptyCounts = (): SyncCounts => ({
  contactsFetched: 0,
  contactsApplied: 0,
  dealsFetched: 0,
  dealsApplied: 0,
  recordsSkipped: 0,
  errors: 0,
  retries: 0
});

function jobDto(row: typeof syncJobs.$inferSelect): SyncJobSummaryDto {
  return {
    id: row.id,
    connectionId: row.connectionId,
    type: row.type,
    status: row.status,
    counts: {
      contactsFetched: row.contactsFetched,
      contactsApplied: row.contactsApplied,
      dealsFetched: row.dealsFetched,
      dealsApplied: row.dealsApplied,
      recordsSkipped: row.recordsSkipped,
      errors: row.errorCount,
      retries: row.retryCount
    },
    errorCode: row.errorCode,
    errorSummary: row.errorSummary,
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString()
  };
}

function connectionDto(
  row: typeof crmConnections.$inferSelect,
  latestJob: SyncJobSummaryDto | null
): CRMConnectionDto {
  return {
    id: row.id,
    provider: row.provider,
    externalAccountId: row.externalAccountId,
    externalAccountName: row.externalAccountName,
    status: row.status,
    health: row.health,
    scopes: row.scopes,
    capabilities: row.capabilities,
    connectedAt: row.connectedAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt?.toISOString() ?? null,
    lastErrorAt: row.lastErrorAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    lastErrorSummary: row.lastErrorSummary,
    contactCount: row.contactCount,
    dealCount: row.dealCount,
    latestJob
  };
}

export class CRMConnectionRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  public async list(): Promise<CRMConnectionDto[]> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const connections = await tx
        .select()
        .from(crmConnections)
        .where(eq(crmConnections.organizationId, this.context.organizationId))
        .orderBy(desc(crmConnections.createdAt));
      if (connections.length === 0) return [];
      const jobs = await tx
        .select()
        .from(syncJobs)
        .where(
          and(
            eq(syncJobs.organizationId, this.context.organizationId),
            inArray(
              syncJobs.connectionId,
              connections.map((connection) => connection.id)
            )
          )
        )
        .orderBy(desc(syncJobs.createdAt));
      const latestByConnection = new Map<string, SyncJobSummaryDto>();
      for (const job of jobs) {
        if (!latestByConnection.has(job.connectionId))
          latestByConnection.set(job.connectionId, jobDto(job));
      }
      return connections.map((connection) =>
        connectionDto(connection, latestByConnection.get(connection.id) ?? null)
      );
    });
  }

  public async get(connectionId: string) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [connection] = await tx
        .select()
        .from(crmConnections)
        .where(
          and(
            eq(crmConnections.organizationId, this.context.organizationId),
            eq(crmConnections.id, connectionId)
          )
        )
        .limit(1);
      return connection ?? null;
    });
  }

  public async create(input: {
    provider: string;
    externalAccountId: string;
    externalAccountName: string;
    secretReference?: string | null;
    scopes: string[];
    capabilities: CRMConnectorCapabilities;
  }) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const id = randomUUID();
      const [connection] = await tx
        .insert(crmConnections)
        .values({
          id,
          organizationId: this.context.organizationId,
          provider: input.provider.trim().toLowerCase(),
          externalAccountId: input.externalAccountId,
          externalAccountName: input.externalAccountName,
          secretReference: input.secretReference,
          scopes: input.scopes,
          capabilities: { ...input.capabilities },
          connectedByUserId: this.context.userId
        })
        .returning();
      if (!connection) throw new Error('CRM connection insert did not return a row');
      await tx.insert(auditLogs).values({
        organizationId: this.context.organizationId,
        actorUserId: this.context.userId,
        action: 'integration.connected',
        resourceType: 'crm_connection',
        resourceId: connection.id,
        metadata: { provider: connection.provider, externalAccountId: connection.externalAccountId }
      });
      return connection;
    });
  }

  public async disconnect(connectionId: string): Promise<string | null> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [connection] = await tx
        .update(crmConnections)
        .set({ status: 'DISCONNECTED', disconnectedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(crmConnections.organizationId, this.context.organizationId),
            eq(crmConnections.id, connectionId)
          )
        )
        .returning();
      if (!connection) throw errors.notFound();
      await tx.insert(auditLogs).values({
        organizationId: this.context.organizationId,
        actorUserId: this.context.userId,
        action: 'integration.disconnected',
        resourceType: 'crm_connection',
        resourceId: connection.id,
        metadata: { provider: connection.provider }
      });
      return connection.secretReference;
    });
  }

  public async markRunning(connectionId: string): Promise<void> {
    await this.updateState(connectionId, {
      status: 'SYNCING',
      lastSyncedAt: new Date(),
      lastErrorCode: null,
      lastErrorSummary: null,
      updatedAt: new Date()
    });
  }

  public async markFinished(
    connectionId: string,
    status: 'COMPLETED' | 'PARTIAL' | 'FAILED',
    checkpoint: SyncCheckpoint,
    counts: SyncCounts,
    error?: { code: string; summary: string }
  ): Promise<void> {
    const now = new Date();
    await this.updateState(connectionId, {
      status: status === 'FAILED' ? 'ERROR' : 'ACTIVE',
      health: status === 'COMPLETED' ? 'HEALTHY' : status === 'PARTIAL' ? 'DEGRADED' : 'SYNC_ERROR',
      syncCheckpoint: { ...checkpoint },
      lastSyncedAt: now,
      lastSuccessfulSyncAt: status === 'COMPLETED' ? now : undefined,
      lastErrorAt: status === 'COMPLETED' ? null : now,
      lastErrorCode: error?.code ?? null,
      lastErrorSummary: error?.summary ?? null,
      updatedAt: now
    });
    await this.refreshCounts(connectionId);
  }

  private async updateState(
    connectionId: string,
    values: Partial<typeof crmConnections.$inferInsert>
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [updated] = await tx
        .update(crmConnections)
        .set(values)
        .where(
          and(
            eq(crmConnections.organizationId, this.context.organizationId),
            eq(crmConnections.id, connectionId)
          )
        )
        .returning({ id: crmConnections.id });
      if (!updated) throw errors.notFound();
    });
  }

  private async refreshCounts(connectionId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx.execute(sql`
        update crm_connections connection
        set contact_count = (
              select count(*)::integer from external_entity_identities identity
              where identity.organization_id = ${this.context.organizationId}
                and identity.connection_id = ${connectionId}
                and identity.entity_type = 'CONTACT'
            ),
            deal_count = (
              select count(*)::integer from external_entity_identities identity
              where identity.organization_id = ${this.context.organizationId}
                and identity.connection_id = ${connectionId}
                and identity.entity_type = 'DEAL'
            )
        where connection.organization_id = ${this.context.organizationId}
          and connection.id = ${connectionId}
      `);
    });
  }
}

export class SyncJobRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  public async create(connectionId: string, type: SyncJobType) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [job] = await tx
        .insert(syncJobs)
        .values({
          organizationId: this.context.organizationId,
          connectionId,
          type,
          requestedByUserId: this.context.userId
        })
        .returning();
      if (!job) throw new Error('Sync job insert did not return a row');
      if (type === 'MANUAL') {
        await tx.insert(auditLogs).values({
          organizationId: this.context.organizationId,
          actorUserId: this.context.userId,
          action: 'integration.manual_sync_requested',
          resourceType: 'sync_job',
          resourceId: job.id,
          metadata: { connectionId }
        });
      }
      return job;
    });
  }

  public async get(jobId: string) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [job] = await tx
        .select()
        .from(syncJobs)
        .where(
          and(eq(syncJobs.organizationId, this.context.organizationId), eq(syncJobs.id, jobId))
        )
        .limit(1);
      return job ?? null;
    });
  }

  public async start(jobId: string): Promise<void> {
    await this.update(jobId, { status: 'RUNNING', startedAt: new Date(), updatedAt: new Date() });
  }

  public async progress(
    jobId: string,
    checkpoint: SyncCheckpoint,
    counts: SyncCounts
  ): Promise<void> {
    await this.update(jobId, {
      checkpoint: { ...checkpoint },
      contactsFetched: counts.contactsFetched,
      contactsApplied: counts.contactsApplied,
      dealsFetched: counts.dealsFetched,
      dealsApplied: counts.dealsApplied,
      recordsSkipped: counts.recordsSkipped,
      errorCount: counts.errors,
      retryCount: counts.retries,
      updatedAt: new Date()
    });
  }

  public async finish(
    jobId: string,
    status: Exclude<SyncJobStatus, 'PENDING' | 'RUNNING'>,
    checkpoint: SyncCheckpoint,
    counts: SyncCounts,
    error?: { code: string; summary: string }
  ): Promise<void> {
    await this.update(jobId, {
      status,
      checkpoint: { ...checkpoint },
      contactsFetched: counts.contactsFetched,
      contactsApplied: counts.contactsApplied,
      dealsFetched: counts.dealsFetched,
      dealsApplied: counts.dealsApplied,
      recordsSkipped: counts.recordsSkipped,
      errorCount: counts.errors,
      retryCount: counts.retries,
      errorCode: error?.code ?? null,
      errorSummary: error?.summary ?? null,
      finishedAt: new Date(),
      updatedAt: new Date()
    });
  }

  public emptyCounts(): SyncCounts {
    return emptyCounts();
  }

  private async update(
    jobId: string,
    values: Partial<typeof syncJobs.$inferInsert>
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [updated] = await tx
        .update(syncJobs)
        .set(values)
        .where(
          and(eq(syncJobs.organizationId, this.context.organizationId), eq(syncJobs.id, jobId))
        )
        .returning({ id: syncJobs.id });
      if (!updated) throw errors.notFound();
    });
  }
}
