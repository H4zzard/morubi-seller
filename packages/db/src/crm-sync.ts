import type { SyncJobType } from '@morubi/contracts';
import type { TenantContext } from '@morubi/domain';
import {
  ConnectorError,
  safeConnectorError,
  withConnectorRetry,
  type CredentialStore,
  type CRMConnectorRegistry,
  type CRMConnector,
  type CRMConnectorContext,
  type NormalizedContactRecord,
  type NormalizedDealRecord,
  type RetryPolicy
} from '@morubi/integrations';
import { CommercialIngestionService } from './commercial-ingestion.js';
import type { MorubiDatabase } from './database.js';
import {
  CRMConnectionRepository,
  SyncJobRepository,
  type SyncCheckpoint,
  type SyncCounts
} from './integration-repositories.js';

export class CRMSyncService {
  private readonly connections: CRMConnectionRepository;
  private readonly jobs: SyncJobRepository;
  private readonly ingestion: CommercialIngestionService;

  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext,
    private readonly registry: CRMConnectorRegistry,
    private readonly credentials: CredentialStore,
    private readonly retryPolicy?: RetryPolicy
  ) {
    this.connections = new CRMConnectionRepository(db, context);
    this.jobs = new SyncJobRepository(db, context);
    this.ingestion = new CommercialIngestionService(db, context);
  }

  public request(connectionId: string, type: SyncJobType) {
    return this.jobs.create(connectionId, type);
  }

  public async run(jobId: string): Promise<void> {
    const job = await this.jobs.get(jobId);
    if (!job) throw new Error('Sync job not found');
    if (job.status !== 'PENDING') throw new Error('Only pending sync jobs can start');
    const connection = await this.connections.get(job.connectionId);
    if (!connection || connection.status === 'DISCONNECTED')
      throw new Error('CRM connection unavailable');
    const connector = this.registry.get(connection.provider);
    if (!connector) throw new Error(`No connector registered for provider ${connection.provider}`);

    const counts = this.jobs.emptyCounts();
    const storedCheckpoint = connection.syncCheckpoint as SyncCheckpoint;
    const checkpoint: SyncCheckpoint = {
      contactsWatermark: storedCheckpoint.contactsWatermark ?? null,
      dealsWatermark: storedCheckpoint.dealsWatermark ?? null,
      phase: 'CONTACTS',
      contactsCursor: null,
      dealsCursor: null
    };
    const connectorContext = this.connectorContext(connection);

    await this.jobs.start(job.id);
    await this.connections.markRunning(connection.id);
    try {
      const contactsComplete = await this.syncContacts(
        connector,
        connectorContext,
        job.id,
        job.type,
        checkpoint,
        counts
      );
      if (!contactsComplete) {
        await this.finish(job.id, connection.id, 'PARTIAL', checkpoint, counts, {
          code: 'RECORD_FAILED',
          summary: 'Um ou mais contatos não puderam ser normalizados.'
        });
        return;
      }
      checkpoint.phase = 'DEALS';
      await this.jobs.progress(job.id, checkpoint, counts);
      const dealsComplete = await this.syncDeals(
        connector,
        connectorContext,
        job.id,
        job.type,
        checkpoint,
        counts
      );
      if (!dealsComplete) {
        await this.finish(job.id, connection.id, 'PARTIAL', checkpoint, counts, {
          code: 'RECORD_FAILED',
          summary: 'Uma ou mais oportunidades não puderam ser normalizadas.'
        });
        return;
      }
      delete checkpoint.phase;
      delete checkpoint.contactsCursor;
      delete checkpoint.dealsCursor;
      await this.finish(job.id, connection.id, 'COMPLETED', checkpoint, counts);
    } catch (error) {
      const safe = safeConnectorError(error);
      await this.finish(job.id, connection.id, 'FAILED', checkpoint, counts, {
        code: safe.code,
        summary: safe.message
      });
      if (!(error instanceof ConnectorError)) throw error;
    }
  }

  private connectorContext(
    connection: NonNullable<Awaited<ReturnType<CRMConnectionRepository['get']>>>
  ): CRMConnectorContext {
    return {
      organizationId: this.context.organizationId,
      connectionId: connection.id,
      externalAccountId: connection.externalAccountId,
      secretReference: connection.secretReference,
      credentials: () =>
        connection.secretReference
          ? this.credentials.get(connection.secretReference)
          : Promise.resolve(null)
    };
  }

  private async syncContacts(
    connector: CRMConnector,
    connectorContext: CRMConnectorContext,
    jobId: string,
    type: SyncJobType,
    checkpoint: SyncCheckpoint,
    counts: SyncCounts
  ): Promise<boolean> {
    let cursor = checkpoint.contactsCursor ?? null;
    const seenCursors = new Set<string>();
    do {
      const page = await this.retry(
        () =>
          connector.listContacts(connectorContext, {
            cursor,
            updatedSince: type === 'INITIAL' ? null : parseDate(checkpoint.contactsWatermark)
          }),
        counts
      );
      let pageFailed = false;
      for (const record of page.items) {
        counts.contactsFetched += 1;
        try {
          const result = await this.ingestContact(record, connectorContext, jobId);
          if (result.applied) counts.contactsApplied += 1;
          else counts.recordsSkipped += 1;
        } catch {
          counts.errors += 1;
          pageFailed = true;
        }
      }
      if (pageFailed) {
        await this.jobs.progress(jobId, checkpoint, counts);
        return false;
      }
      checkpoint.contactsCursor = page.nextCursor;
      checkpoint.contactsWatermark = laterIso(checkpoint.contactsWatermark, page.watermark);
      await this.jobs.progress(jobId, checkpoint, counts);
      cursor = page.nextCursor;
      assertCursorProgress(cursor, seenCursors);
    } while (cursor);
    return true;
  }

  private async syncDeals(
    connector: CRMConnector,
    connectorContext: CRMConnectorContext,
    jobId: string,
    type: SyncJobType,
    checkpoint: SyncCheckpoint,
    counts: SyncCounts
  ): Promise<boolean> {
    let cursor = checkpoint.dealsCursor ?? null;
    const seenCursors = new Set<string>();
    do {
      const page = await this.retry(
        () =>
          connector.listDeals(connectorContext, {
            cursor,
            updatedSince: type === 'INITIAL' ? null : parseDate(checkpoint.dealsWatermark)
          }),
        counts
      );
      let pageFailed = false;
      for (const record of page.items) {
        counts.dealsFetched += 1;
        try {
          const result = await this.ingestDeal(record, connectorContext, jobId);
          if (result.applied) counts.dealsApplied += 1;
          else counts.recordsSkipped += 1;
        } catch {
          counts.errors += 1;
          pageFailed = true;
        }
      }
      if (pageFailed) {
        await this.jobs.progress(jobId, checkpoint, counts);
        return false;
      }
      checkpoint.dealsCursor = page.nextCursor;
      checkpoint.dealsWatermark = laterIso(checkpoint.dealsWatermark, page.watermark);
      await this.jobs.progress(jobId, checkpoint, counts);
      cursor = page.nextCursor;
      assertCursorProgress(cursor, seenCursors);
    } while (cursor);
    return true;
  }

  private ingestContact(
    record: NormalizedContactRecord,
    context: CRMConnectorContext,
    jobId: string
  ) {
    return this.ingestion.ingestContact(
      { ...record.source, connectionId: context.connectionId, syncJobId: jobId },
      record.input
    );
  }

  private async ingestDeal(
    record: NormalizedDealRecord,
    context: CRMConnectorContext,
    jobId: string
  ) {
    const contactIds: string[] = [];
    for (const externalId of record.relatedContactExternalIds) {
      const contactId = await this.ingestion.resolveExternalEntityId(
        'CONTACT',
        record.source.provider,
        record.source.externalWorkspaceId ?? context.externalAccountId,
        externalId
      );
      if (!contactId) throw new Error('Related external contact is not available');
      contactIds.push(contactId);
    }
    return this.ingestion.ingestDeal(
      { ...record.source, connectionId: context.connectionId, syncJobId: jobId },
      { ...record.input, contactIds }
    );
  }

  private retry<T>(operation: () => Promise<T>, counts: SyncCounts): Promise<T> {
    return withConnectorRetry(operation, this.retryPolicy, {
      onRetry: () => {
        counts.retries += 1;
      }
    });
  }

  private async finish(
    jobId: string,
    connectionId: string,
    status: 'COMPLETED' | 'PARTIAL' | 'FAILED',
    checkpoint: SyncCheckpoint,
    counts: SyncCounts,
    error?: { code: string; summary: string }
  ): Promise<void> {
    await this.jobs.finish(jobId, status, checkpoint, counts, error);
    await this.connections.markFinished(connectionId, status, checkpoint, counts, error);
  }
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function laterIso(current: string | null | undefined, candidate: Date | null): string | null {
  if (!candidate) return current ?? null;
  const previous = parseDate(current);
  return !previous || candidate > previous ? candidate.toISOString() : previous.toISOString();
}

function assertCursorProgress(cursor: string | null, seen: Set<string>): void {
  if (!cursor) return;
  if (seen.has(cursor))
    throw new ConnectorError('INVALID_PAYLOAD', 'O provider repetiu o cursor de paginação.', false);
  seen.add(cursor);
}
