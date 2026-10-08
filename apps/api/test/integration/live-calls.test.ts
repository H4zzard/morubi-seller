import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { FixtureGenerativeProvider } from '@morubi/ai';
import {
  commercialEvents,
  CopilotRepository,
  contacts,
  conversations,
  createDatabase,
  deals,
  intelligenceJobs,
  intelligenceSettings,
  IntelligenceProcessor,
  interventionTemplates,
  LiveCallRepository,
  memberships,
  organizations,
  PostCallJobRepository,
  PostCallProcessor,
  PostCallReadRepository,
  resolveTenantContext,
  user,
  type DatabaseHandle
} from '@morubi/db';
import type { TenantContext } from '@morubi/domain';
import { FixtureDecisionProvider, defaultPolicyConfig } from '@morubi/intelligence';
import { getTestDatabaseEnvironment } from './test-database-env.js';

const { adminUrl, runtimeUrl } = getTestDatabaseEnvironment();

describe('live calls integration and tenant invariants', () => {
  const userAId = `live-a-${randomUUID()}`;
  const userBId = `live-b-${randomUUID()}`;
  const organizationAId = randomUUID();
  const organizationBId = randomUUID();
  let admin: DatabaseHandle;
  let runtime: DatabaseHandle;
  let contextA: TenantContext;
  let contextB: TenantContext;
  let dealAId: string;
  let conversationAId: string;

  beforeAll(async () => {
    admin = createDatabase(adminUrl);
    runtime = createDatabase(runtimeUrl);
    await admin.db.insert(user).values([
      { id: userAId, name: 'Live Seller A', email: `${userAId}@example.test` },
      { id: userBId, name: 'Live Seller B', email: `${userBId}@example.test` }
    ]);
    await admin.db.insert(organizations).values([
      { id: organizationAId, name: 'Live Organization A', slug: `live-a-${organizationAId}` },
      { id: organizationBId, name: 'Live Organization B', slug: `live-b-${organizationBId}` }
    ]);
    await admin.db.insert(memberships).values([
      { organizationId: organizationAId, userId: userAId, role: 'OWNER' },
      { organizationId: organizationBId, userId: userBId, role: 'OWNER' }
    ]);
    const resolvedA = await resolveTenantContext(runtime.db, userAId, organizationAId);
    const resolvedB = await resolveTenantContext(runtime.db, userBId, organizationBId);
    if (!resolvedA || !resolvedB) throw new Error('Live call tenant setup failed');
    contextA = resolvedA;
    contextB = resolvedB;

    const [contact] = await admin.db
      .insert(contacts)
      .values({ organizationId: organizationAId, name: 'Lead live' })
      .returning();
    const [deal] = await admin.db
      .insert(deals)
      .values({
        organizationId: organizationAId,
        title: 'Deal live',
        ownerMembershipId: contextA.membershipId
      })
      .returning();
    if (!contact || !deal) throw new Error('Live call commercial context setup failed');
    dealAId = deal.id;
    const [conversation] = await admin.db
      .insert(conversations)
      .values({
        organizationId: organizationAId,
        channel: 'OTHER',
        primaryContactId: contact.id,
        dealId: deal.id,
        startedAt: new Date('2026-10-07T10:00:00Z')
      })
      .returning();
    if (!conversation) throw new Error('Live call conversation setup failed');
    conversationAId = conversation.id;
    await admin.db.insert(interventionTemplates).values({
      organizationId: organizationAId,
      code: 'live-handle-price-v1',
      category: 'OBJECTION',
      subtype: 'PRICE',
      strategy: 'HANDLE_PRICE',
      title: 'Tratar objeção de preço ao vivo',
      guidance: 'Investigue valor e impacto antes de discutir condições.',
      suggestedQuestions: ['Qual impacto justificaria o investimento?'],
      warnings: ['Não oferecer desconto sem aprovação.'],
      conditions: {},
      version: 1
    });
  });

  afterAll(async () => {
    await admin.db
      .delete(organizations)
      .where(inArray(organizations.id, [organizationAId, organizationBId]));
    await admin.db.delete(user).where(inArray(user.id, [userAId, userBId]));
    await runtime.close();
    await admin.close();
  });

  it('persists consent, ignores partials for intelligence, and promotes finals to the existing queue', async () => {
    const repository = new LiveCallRepository(runtime.db, contextA, true);
    await repository.updateSettings({
      callCaptureEnabled: true,
      meetDetectionEnabled: true,
      zoomDetectionEnabled: true,
      liveTranscriptionEnabled: true,
      liveCopilotEnabled: true,
      liveGenerationEnabled: false,
      autoStartEnabled: false,
      rawAudioRetentionDays: 0,
      transcriptRetentionDays: 90,
      maxBufferBytes: 4_194_304,
      turnAggregationGapMs: 1_200,
      liveCardTtlSeconds: 20
    });
    const session = await repository.create({
      meetingProvider: 'MEET',
      meetingExternalId: 'fixture-meet',
      meetingTitle: 'Discovery fixture',
      detectionConfidence: 0.99,
      detectionEvidence: 'integration-fixture'
    });
    expect(session.dealId).toBeNull();
    const linkedSession = await repository.linkContext(session.id, {
      conversationId: conversationAId
    });
    expect(linkedSession).toMatchObject({ dealId: dealAId, conversationId: conversationAId });
    await repository.start(session.id, {
      consentMode: 'MANUAL_CONFIRMATION',
      policyVersion: 'integration-v1',
      captureMode: 'FIXTURE',
      transcriptionMode: 'FIXTURE',
      captureSources: ['fixture']
    });

    const turn = {
      clientTurnId: 'fixture-turn-1',
      speakerRole: 'LEAD' as const,
      speakerOrigin: 'fixture',
      speakerConfidence: 1,
      text: 'Gostei, mas achei o preço muito alto.',
      startedAt: new Date('2026-10-07T10:00:01Z'),
      endedAt: new Date('2026-10-07T10:00:04Z'),
      confidence: 0.98,
      provider: 'fixture-realtime',
      model: 'fixture-realtime-v1',
      sequence: 1,
      audioProcessedMs: 3_000,
      estimatedCostMicros: 0n
    };
    const partial = await repository.acceptTurn(
      session.id,
      { ...turn, isPartial: true, isFinal: false },
      'live-partial'
    );
    expect(partial).toMatchObject({ commercialEventId: null, intelligenceJobId: null });

    const final = await repository.acceptTurn(
      session.id,
      { ...turn, isPartial: false, isFinal: true },
      'live-final'
    );
    expect(final.commercialEventId).toBeTruthy();
    expect(final.intelligenceJobId).toBeTruthy();
    const [event] = await admin.db
      .select()
      .from(commercialEvents)
      .where(eq(commercialEvents.id, final.commercialEventId!));
    const [job] = await admin.db
      .select()
      .from(intelligenceJobs)
      .where(eq(intelligenceJobs.id, final.intelligenceJobId!));
    expect(event).toMatchObject({
      dealId: dealAId,
      liveCallSessionId: session.id,
      contentOrigin: 'CALL_TRANSCRIPT',
      type: 'TRANSCRIPT'
    });
    expect(job).toMatchObject({ priority: 100, source: 'LIVE_CALL' });

    await admin.db
      .update(intelligenceSettings)
      .set({ shadowMode: false, interventionsVisible: true, realtimeEnabled: true })
      .where(eq(intelligenceSettings.organizationId, organizationAId));
    const firstDecision = await new IntelligenceProcessor(
      runtime.db,
      contextA,
      new FixtureDecisionProvider(),
      {
        intelligenceEnabled: true,
        decisionVersion: 'live-decision-v1',
        contextVersion: 'live-context-v1',
        policyVersion: 'live-policy-v1',
        policy: { ...defaultPolicyConfig, shadowMode: false, interventionsVisible: true },
        liveGenerationEnabled: false
      }
    ).processEvent(final.commercialEventId!);

    const newer = await repository.acceptTurn(
      session.id,
      {
        ...turn,
        clientTurnId: 'fixture-turn-2',
        text: 'Antes de decidir, o preço ainda está muito alto.',
        startedAt: new Date('2026-10-07T10:00:05Z'),
        endedAt: new Date('2026-10-07T10:00:08Z'),
        sequence: 2,
        isPartial: false,
        isFinal: true
      },
      'live-final-2'
    );
    const copilot = new CopilotRepository(runtime.db, contextA);
    expect(
      await copilot.deliverDecision(
        firstDecision.decisionId,
        'live-stale-delivery',
        firstDecision.stateVersion
      )
    ).toMatchObject({ delivery: null, reason: 'LIVE_CARD_STALE' });
    const latestDecision = await new IntelligenceProcessor(
      runtime.db,
      contextA,
      new FixtureDecisionProvider(),
      {
        intelligenceEnabled: true,
        decisionVersion: 'live-decision-v1',
        contextVersion: 'live-context-v1',
        policyVersion: 'live-policy-v1',
        policy: { ...defaultPolicyConfig, shadowMode: false, interventionsVisible: true },
        liveGenerationEnabled: false
      }
    ).processEvent(newer.commercialEventId!);
    const delivered = await copilot.deliverDecision(
      latestDecision.decisionId,
      'live-current-delivery',
      latestDecision.stateVersion
    );
    expect(delivered.delivery, JSON.stringify(delivered)).toMatchObject({
      liveCallSessionId: session.id,
      liveTranscriptTurnId: newer.turn.id
    });

    expect(await new LiveCallRepository(runtime.db, contextB, true).get(session.id)).toBeNull();
    const detail = await repository.get(session.id);
    expect(detail?.consent).toMatchObject({ mode: 'MANUAL_CONFIRMATION' });
    expect(detail?.turns).toHaveLength(2);

    await repository.end(session.id, 'post-call-integration');
    const postCallJobs = new PostCallJobRepository(runtime.db, contextA);
    const postCallJob = await postCallJobs.claimNext();
    expect(postCallJob).toMatchObject({
      liveCallSessionId: session.id,
      status: 'PROCESSING',
      priority: 10
    });
    const postCallProcessor = new PostCallProcessor(
      runtime.db,
      contextA,
      new FixtureGenerativeProvider(),
      {
        enabled: true,
        maxSegmentCharacters: 1_000,
        maxOutputCharacters: 16_000,
        pricing: { inputMicrosPerMillionTokens: 0n, outputMicrosPerMillionTokens: 0n }
      }
    );
    const generated = await postCallProcessor.process(postCallJob!);
    await postCallJobs.complete(postCallJob!.id);
    expect(generated).toMatchObject({ version: 1, deduplicated: false });
    const postCallReads = new PostCallReadRepository(runtime.db, contextA);
    const report = await postCallReads.getReport(session.id);
    expect(report).toMatchObject({ status: 'READY' });
    expect(report?.currentRevision?.content.budget).toEqual([]);
    expect(report?.currentRevision?.content.executiveSummary.evidenceTurnIds).toEqual([
      final.turn.id
    ]);
    expect(await new PostCallReadRepository(runtime.db, contextB).getReport(session.id)).toBeNull();
    const retrying = await postCallReads.retry(session.id, 'post-call-reprocess');
    expect(retrying.status).toBe('PROCESSING');
    const retryJob = await postCallJobs.claimNext();
    const reprocessed = await postCallProcessor.process(retryJob!);
    await postCallJobs.complete(retryJob!.id);
    expect(reprocessed).toMatchObject({ version: 2, deduplicated: false });
    expect((await postCallReads.getReport(session.id))?.currentRevision?.version).toBe(2);
    await expect(
      repository.acceptTurn(
        session.id,
        { ...turn, clientTurnId: 'after-end', sequence: 2, isPartial: false, isFinal: true },
        'live-after-end'
      )
    ).rejects.toThrow('LIVE_SESSION_NOT_ACTIVE');
  });

  it('enables and forces RLS on every live-call table', async () => {
    const tableNames = [
      'live_call_sessions',
      'call_consent_records',
      'live_transcript_turns',
      'call_usage',
      'post_call_jobs',
      'call_reports',
      'call_report_revisions'
    ];
    const result = await admin.pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      "select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = any($1::text[]) order by relname",
      [tableNames]
    );
    expect(result.rows).toHaveLength(tableNames.length);
    expect(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
  });
});
