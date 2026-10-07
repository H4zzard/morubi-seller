import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { ApiEnv } from '@morubi/config';
import {
  CommercialIngestionService,
  contacts,
  createDatabase,
  commercialEvents,
  memberships,
  messages,
  organizations,
  resolveTenantContext,
  sourceRecords,
  user,
  type DatabaseHandle
} from '@morubi/db';
import type { TenantContext } from '@morubi/domain';
import { buildApp } from '../../src/app.js';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl || !runtimeUrl)('commercial core tenant and ingestion invariants', () => {
  const userAId = `commercial-a-${randomUUID()}`;
  const userBId = `commercial-b-${randomUUID()}`;
  const organizationAId = randomUUID();
  const organizationBId = randomUUID();
  let admin: DatabaseHandle;
  let runtime: DatabaseHandle;
  let contextA: TenantContext;
  let contextB: TenantContext;
  let contactAId: string;
  let contactBId: string;
  let dealAId: string;
  let conversationAId: string;
  let messageAId: string;
  let eventAId: string;

  const source = (id: string, idempotencyKey: string, at: string, payload: unknown) => ({
    provider: 'contract-fixture',
    externalWorkspaceId: 'shared-workspace',
    externalId: id,
    idempotencyKey,
    providerUpdatedAt: new Date(at),
    observedAt: new Date(at),
    rawPayload: payload
  });

  beforeAll(async () => {
    admin = createDatabase(adminUrl!);
    runtime = createDatabase(runtimeUrl!);
    await admin.db.insert(user).values([
      { id: userAId, name: 'Commercial A', email: `${userAId}@example.test` },
      { id: userBId, name: 'Commercial B', email: `${userBId}@example.test` }
    ]);
    await admin.db.insert(organizations).values([
      {
        id: organizationAId,
        name: 'Commercial Organization A',
        slug: `commercial-a-${organizationAId}`
      },
      {
        id: organizationBId,
        name: 'Commercial Organization B',
        slug: `commercial-b-${organizationBId}`
      }
    ]);
    await admin.db.insert(memberships).values([
      { organizationId: organizationAId, userId: userAId, role: 'OWNER' },
      { organizationId: organizationBId, userId: userBId, role: 'OWNER' }
    ]);
    const resolvedA = await resolveTenantContext(runtime.db, userAId, organizationAId);
    const resolvedB = await resolveTenantContext(runtime.db, userBId, organizationBId);
    if (!resolvedA || !resolvedB) throw new Error('Commercial test tenant setup failed');
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

  it('keeps the same provider external ID independent between organizations', async () => {
    const resultA = await new CommercialIngestionService(runtime.db, contextA).ingestContact(
      source('shared-contact', 'contact-v1', '2026-09-01T10:00:00Z', {
        id: 'shared-contact',
        tenant: 'A'
      }),
      { name: 'Contato A', email: 'shared@example.test' }
    );
    const resultB = await new CommercialIngestionService(runtime.db, contextB).ingestContact(
      source('shared-contact', 'contact-v1', '2026-09-01T10:00:00Z', {
        id: 'shared-contact',
        tenant: 'B'
      }),
      { name: 'Contato B', email: 'shared@example.test' }
    );
    contactAId = resultA.id;
    contactBId = resultB.id;
    expect(resultA.id).not.toBe(resultB.id);

    const sameEmail = await new CommercialIngestionService(runtime.db, contextA).ingestContact(
      source('different-contact', 'different-contact-v1', '2026-09-01T10:00:00Z', {
        id: 'different-contact'
      }),
      { name: 'Outro contato', email: 'shared@example.test' }
    );
    expect(sameEmail.id).not.toBe(resultA.id);
  });

  it('preserves provenance history and does not regress on an older provider update', async () => {
    const result = await new CommercialIngestionService(runtime.db, contextA).ingestContact(
      source('shared-contact', 'contact-old-replay', '2026-08-01T10:00:00Z', {
        id: 'shared-contact',
        name: 'Nome antigo'
      }),
      { name: 'Nome antigo' }
    );
    expect(result.applied).toBe(false);
    const [contact] = await admin.db.select().from(contacts).where(eq(contacts.id, contactAId));
    expect(contact?.name).toBe('Contato A');
    const [history] = await admin.db
      .select({ value: count() })
      .from(sourceRecords)
      .where(
        and(
          eq(sourceRecords.organizationId, organizationAId),
          eq(sourceRecords.externalId, 'shared-contact')
        )
      );
    expect(history?.value).toBe(2);
  });

  it('deduplicates repeated messages and commercial events', async () => {
    const service = new CommercialIngestionService(runtime.db, contextA);
    const deal = await service.ingestDeal(
      source('deal-a', 'deal-v1', '2026-09-02T09:00:00Z', { id: 'deal-a' }),
      {
        title: 'Deal A',
        amountMinor: 10_000n,
        currency: 'BRL',
        status: 'OPEN',
        providerStageId: 'qualification',
        providerStageLabel: 'Qualificação',
        contactIds: [contactAId]
      }
    );
    dealAId = deal.id;
    const conversation = await service.ingestConversation(
      source('conversation-a', 'conversation-v1', '2026-09-02T10:00:00Z', { id: 'conversation-a' }),
      {
        channel: 'WHATSAPP',
        primaryContactId: contactAId,
        dealId: deal.id,
        startedAt: new Date('2026-09-02T10:00:00Z')
      }
    );
    conversationAId = conversation.id;
    const messageSource = source('message-a', 'message-v1', '2026-09-02T10:01:00Z', {
      id: 'message-a',
      text: 'Olá'
    });
    const input = {
      conversationId: conversation.id,
      senderType: 'LEAD' as const,
      contentType: 'TEXT' as const,
      text: 'Olá',
      occurredAt: new Date('2026-09-02T10:01:00Z')
    };
    const first = await service.ingestMessage(messageSource, input);
    messageAId = first.id;
    const duplicate = await service.ingestMessage(messageSource, input);
    expect(duplicate).toMatchObject({ id: first.id, deduplicated: true, applied: false });

    const eventSource = source('event-a', 'event-v1', '2026-09-02T10:01:00Z', { id: 'event-a' });
    const eventInput = {
      conversationId: conversation.id,
      messageId: first.id,
      actorType: 'LEAD' as const,
      source: 'WHATSAPP' as const,
      type: 'MESSAGE' as const,
      text: 'Olá',
      occurredAt: new Date('2026-09-02T10:01:00Z')
    };
    const event = await service.ingestCommercialEvent(eventSource, eventInput);
    eventAId = event.id;
    await service.ingestCommercialEvent(eventSource, eventInput);

    const [messageCount] = await admin.db
      .select({ value: count() })
      .from(messages)
      .where(eq(messages.id, first.id));
    const [eventCount] = await admin.db
      .select({ value: count() })
      .from(commercialEvents)
      .where(eq(commercialEvents.messageId, first.id));
    expect(messageCount?.value).toBe(1);
    expect(eventCount?.value).toBe(1);

    const client = await runtime.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('app.current_user_id', $1, true), set_config('app.current_organization_id', $2, true)",
        [userAId, organizationAId]
      );
      await expect(
        client.query('update commercial_events set text = $1 where id = $2', ['alterado', eventAId])
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('has forced tenant RLS on every Phase 2 table', async () => {
    const tableNames = [
      'contacts',
      'deals',
      'deal_contacts',
      'conversations',
      'conversation_participants',
      'messages',
      'external_entity_identities',
      'source_records',
      'commercial_events'
    ];
    const result = await admin.pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      'select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1::text[]) order by relname',
      [tableNames]
    );
    expect(result.rows).toHaveLength(tableNames.length);
    expect(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });

  it('enforces RLS and hides cross-tenant IDs through the read API', async () => {
    const client = await runtime.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('app.current_user_id', $1, true), set_config('app.current_organization_id', $2, true)",
        [userAId, organizationAId]
      );
      const hidden = await client.query('select id from contacts where id = $1', [contactBId]);
      expect(hidden.rowCount).toBe(0);
      await client.query('rollback');
    } finally {
      client.release();
    }

    const apiDatabase = createDatabase(runtimeUrl!);
    const env: ApiEnv = {
      NODE_ENV: 'test',
      API_HOST: '127.0.0.1',
      API_PORT: 4000,
      DATABASE_URL: runtimeUrl!,
      BETTER_AUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters',
      BETTER_AUTH_URL: 'http://localhost:4000',
      WEB_ORIGIN: 'http://localhost:3000',
      DESKTOP_DEV_ORIGIN: 'http://localhost:5173',
      LOG_LEVEL: 'silent',
      TRUST_PROXY: false,
      INTELLIGENCE_ENABLED: true,
      JEV_ENABLED: false,
      SHADOW_MODE: true,
      INTERVENTIONS_VISIBLE: false,
      INTELLIGENCE_DEV_UI: true,
      REALTIME_ENABLED: true,
      SELLER_FEEDBACK_ENABLED: true,
      GENERATIVE_AI_ENABLED: false,
      DEEPSEEK_ENABLED: false,
      AUDIO_INTELLIGENCE_ENABLED: false,
      GEMINI_TRANSCRIPTION_ENABLED: false,
      LIVE_CALLS_ENABLED: false,
      MEET_DETECTION_ENABLED: false,
      ZOOM_DETECTION_ENABLED: false,
      LIVE_TRANSCRIPTION_ENABLED: false,
      LIVE_COPILOT_ENABLED: false,
      LIVE_GENERATION_ENABLED: false,
      LIVE_TRANSCRIPTION_COST_MICROS_PER_MINUTE: 0,
      AUDIO_STORAGE_ROOT: '.data/audio-test',
      AUDIO_MAX_BYTES: 20_971_520,
      AUDIO_RETENTION_DAYS: 30
    };
    const app = await buildApp({
      database: apiDatabase,
      env,
      sessionResolver: {
        resolve: () =>
          Promise.resolve({ id: userAId, name: 'Commercial A', email: `${userAId}@example.test` })
      }
    });
    const response = await app.inject({
      method: 'GET',
      url: `/v1/contacts/${contactBId}`,
      headers: { 'x-organization-id': organizationAId }
    });
    expect(response.statusCode).toBe(404);
    const list = await app.inject({
      method: 'GET',
      url: '/v1/contacts',
      headers: { 'x-organization-id': organizationAId }
    });
    expect(list.statusCode).toBe(200);
    expect(
      list.json<{ items: Array<{ id: string }> }>().items.some((item) => item.id === contactAId)
    ).toBe(true);
    expect(list.body).not.toContain(contactBId);

    const deal = await app.inject({
      method: 'GET',
      url: `/v1/deals/${dealAId}`,
      headers: { 'x-organization-id': organizationAId }
    });
    expect(deal.statusCode).toBe(200);
    expect(deal.json()).toMatchObject({ id: dealAId, contacts: [{ id: contactAId }] });

    const conversationsResponse = await app.inject({
      method: 'GET',
      url: '/v1/conversations',
      headers: { 'x-organization-id': organizationAId }
    });
    expect(conversationsResponse.statusCode).toBe(200);
    expect(conversationsResponse.body).toContain(conversationAId);

    const messagesResponse = await app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationAId}/messages`,
      headers: { 'x-organization-id': organizationAId }
    });
    expect(messagesResponse.statusCode).toBe(200);
    expect(messagesResponse.body).toContain(messageAId);
    await app.close();
  });
});
