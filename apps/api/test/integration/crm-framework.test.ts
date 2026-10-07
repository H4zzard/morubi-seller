import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq, inArray } from 'drizzle-orm';
import {
  CRMConnectionLifecycleService,
  CRMConnectionRepository,
  CRMSyncService,
  contacts,
  createDatabase,
  externalEntityIdentities,
  memberships,
  organizations,
  resolveTenantContext,
  sourceRecords,
  syncJobs,
  user,
  type DatabaseHandle
} from '@morubi/db';
import type { TenantContext } from '@morubi/domain';
import { CRMConnectorRegistry } from '@morubi/integrations';
import {
  FixtureCRMConnector,
  InMemoryCredentialStore,
  createFixtureCRMData
} from '@morubi/integrations/testing';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl || !runtimeUrl)('CRM connector framework', () => {
  const userAId = `crm-a-${randomUUID()}`;
  const userBId = `crm-b-${randomUUID()}`;
  const organizationAId = randomUUID();
  const organizationBId = randomUUID();
  const registry = new CRMConnectorRegistry();
  const fixture = new FixtureCRMConnector({ data: createFixtureCRMData(100), pageSize: 20 });
  const credentials = new InMemoryCredentialStore();
  let admin: DatabaseHandle;
  let runtime: DatabaseHandle;
  let contextA: TenantContext;
  let contextB: TenantContext;
  let connectionAId: string;
  let connectionBId: string;

  beforeAll(async () => {
    registry.register(fixture);
    admin = createDatabase(adminUrl!);
    runtime = createDatabase(runtimeUrl!);
    await admin.db.insert(user).values([
      { id: userAId, name: 'CRM A', email: `${userAId}@example.test` },
      { id: userBId, name: 'CRM B', email: `${userBId}@example.test` }
    ]);
    await admin.db.insert(organizations).values([
      { id: organizationAId, name: 'CRM Organization A', slug: `crm-a-${organizationAId}` },
      { id: organizationBId, name: 'CRM Organization B', slug: `crm-b-${organizationBId}` }
    ]);
    await admin.db.insert(memberships).values([
      { organizationId: organizationAId, userId: userAId, role: 'OWNER' },
      { organizationId: organizationBId, userId: userBId, role: 'OWNER' }
    ]);
    const resolvedA = await resolveTenantContext(runtime.db, userAId, organizationAId);
    const resolvedB = await resolveTenantContext(runtime.db, userBId, organizationBId);
    if (!resolvedA || !resolvedB) throw new Error('CRM test tenant setup failed');
    contextA = resolvedA;
    contextB = resolvedB;
  });

  afterAll(async () => {
    await admin.db
      .delete(organizations)
      .where(inArray(organizations.id, [organizationAId, organizationBId]));
    await admin.db.delete(user).where(inArray(user.id, [userAId, userBId]));
    await runtime.close();
    await admin.close();
  });

  it('connects the same external account independently in two tenants', async () => {
    const connectionA = await new CRMConnectionLifecycleService(
      runtime.db,
      contextA,
      registry,
      credentials
    ).connect({ provider: 'fixture', externalAccountId: 'account-123' });
    const connectionB = await new CRMConnectionLifecycleService(
      runtime.db,
      contextB,
      registry,
      credentials
    ).connect({ provider: 'fixture', externalAccountId: 'account-123' });
    connectionAId = connectionA.id;
    connectionBId = connectionB.id;
    expect(connectionA.id).not.toBe(connectionB.id);
    expect(await new CRMConnectionRepository(runtime.db, contextA).list()).toHaveLength(1);
    expect(await new CRMConnectionRepository(runtime.db, contextB).list()).toHaveLength(1);
  });

  it('runs a paginated initial sync through canonical ingestion with provenance', async () => {
    const service = new CRMSyncService(runtime.db, contextA, registry, credentials, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 5
    });
    const job = await service.request(connectionAId, 'INITIAL');
    await service.run(job.id);
    const [finished] = await admin.db.select().from(syncJobs).where(eq(syncJobs.id, job.id));
    expect(finished).toMatchObject({
      status: 'COMPLETED',
      contactsFetched: 100,
      contactsApplied: 100,
      dealsFetched: 25,
      dealsApplied: 25,
      errorCount: 0
    });
    const [provenance] = await admin.db
      .select({ value: count() })
      .from(sourceRecords)
      .where(
        and(eq(sourceRecords.organizationId, organizationAId), eq(sourceRecords.syncJobId, job.id))
      );
    expect(provenance?.value).toBe(125);
  });

  it('deduplicates incremental overlap and prevents out-of-order regression', async () => {
    const data = createFixtureCRMData(100);
    const original = data.contacts[0]!;
    data.contacts = [
      { ...original, name: 'Nome novo', updatedAt: '2026-09-03T10:00:00.000Z' },
      { ...original, name: 'Nome antigo', updatedAt: '2026-09-02T10:00:00.000Z' },
      ...data.contacts.slice(1)
    ];
    fixture.replaceData(data);
    const service = new CRMSyncService(runtime.db, contextA, registry, credentials, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 5
    });
    const job = await service.request(connectionAId, 'INCREMENTAL');
    await service.run(job.id);
    const [identity] = await admin.db
      .select()
      .from(externalEntityIdentities)
      .where(
        and(
          eq(externalEntityIdentities.organizationId, organizationAId),
          eq(externalEntityIdentities.externalId, 'contact-1')
        )
      );
    const [contact] = await admin.db
      .select()
      .from(contacts)
      .where(eq(contacts.id, identity!.entityId));
    expect(contact?.name).toBe('Nome novo');
  });

  it('recovers from a rate limit without losing or duplicating the checkpoint', async () => {
    const throttledRegistry = new CRMConnectorRegistry();
    throttledRegistry.register(
      new FixtureCRMConnector({
        data: createFixtureCRMData(10),
        pageSize: 5,
        failures: [{ resource: 'contacts', statusCode: 429, times: 1, retryAfterMs: 1 }]
      })
    );
    const service = new CRMSyncService(runtime.db, contextB, throttledRegistry, credentials, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 2
    });
    const job = await service.request(connectionBId, 'INITIAL');
    await service.run(job.id);
    const [finished] = await admin.db.select().from(syncJobs).where(eq(syncJobs.id, job.id));
    expect(finished).toMatchObject({ status: 'COMPLETED', retryCount: 1, contactsFetched: 10 });
  });

  it('marks a page partial, keeps the prior checkpoint and retries safely', async () => {
    const broken = createFixtureCRMData(100);
    broken.deals[21] = {
      ...broken.deals[21]!,
      currency: 'INVALID',
      updatedAt: '2026-09-03T10:00:00.000Z'
    };
    fixture.replaceData(broken);
    const service = new CRMSyncService(runtime.db, contextA, registry, credentials, {
      maxAttempts: 2,
      baseDelayMs: 1,
      maxDelayMs: 2
    });
    const partial = await service.request(connectionAId, 'MANUAL');
    await service.run(partial.id);
    const [failedJob] = await admin.db.select().from(syncJobs).where(eq(syncJobs.id, partial.id));
    expect(failedJob).toMatchObject({ status: 'PARTIAL', errorCount: 1 });

    const corrected = createFixtureCRMData(100);
    corrected.deals[21] = {
      ...corrected.deals[21]!,
      currency: 'BRL',
      updatedAt: '2026-09-04T10:00:00.000Z'
    };
    fixture.replaceData(corrected);
    const retry = await service.request(connectionAId, 'MANUAL');
    await service.run(retry.id);
    const [recovered] = await admin.db.select().from(syncJobs).where(eq(syncJobs.id, retry.id));
    expect(recovered?.status).toBe('COMPLETED');
  });

  it('disconnects without deleting imported commercial history', async () => {
    await new CRMConnectionLifecycleService(runtime.db, contextA, registry, credentials).disconnect(
      connectionAId
    );
    const [connection] = await new CRMConnectionRepository(runtime.db, contextA).list();
    expect(connection?.status).toBe('DISCONNECTED');
    const [remaining] = await admin.db
      .select({ value: count() })
      .from(externalEntityIdentities)
      .where(eq(externalEntityIdentities.organizationId, organizationAId));
    expect(remaining?.value).toBeGreaterThan(0);
  });

  it('forces RLS on the Phase 3 framework tables', async () => {
    const result = await admin.pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      'select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1::text[]) order by relname',
      [['crm_connections', 'sync_jobs']]
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });
});
