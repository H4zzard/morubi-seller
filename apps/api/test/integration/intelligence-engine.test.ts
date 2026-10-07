import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq, inArray } from 'drizzle-orm';
import { FixtureGenerativeProvider, FixtureTranscriptionProvider } from '@morubi/ai';
import {
  CommercialIngestionService,
  AudioAssetService,
  CopilotRepository,
  ConversationRepository,
  GenerationJobRepository,
  GenerativeProcessor,
  IntelligenceProcessor,
  TranscriptionJobRepository,
  TranscriptionProcessor,
  IntelligenceReadRepository,
  aiDecisions,
  audioTranscripts,
  commercialEvents,
  createDatabase,
  dealStateRevisions,
  generationJobs,
  generativeExecutions,
  intelligenceSettings,
  interventionCandidates,
  interventionTemplates,
  memberships,
  memoryFacts,
  organizations,
  resolveTenantContext,
  syntheticWavFixture,
  type DatabaseHandle
} from '@morubi/db';
import { LocalObjectStorage } from '@morubi/storage';
import type { TenantContext } from '@morubi/domain';
import {
  FixtureDecisionProvider,
  defaultPolicyConfig,
  type DecisionProvider
} from '@morubi/intelligence';
import { user } from '@morubi/db/schema';

const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const runtimeUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!adminUrl || !runtimeUrl)('intelligence engine PostgreSQL flow', () => {
  const userAId = `intelligence-a-${randomUUID()}`;
  const userBId = `intelligence-b-${randomUUID()}`;
  const userCId = `intelligence-c-${randomUUID()}`;
  const organizationAId = randomUUID();
  const organizationBId = randomUUID();
  let admin: DatabaseHandle;
  let runtime: DatabaseHandle;
  let contextA: TenantContext;
  let contextB: TenantContext;
  let contextC: TenantContext;
  let dealAId: string;
  let dealBId: string;
  let firstEventId: string;
  let conversationAId: string;

  const source = (id: string, at = '2026-10-06T12:00:00Z') => ({
    provider: 'intelligence-fixture',
    externalWorkspaceId: 'workspace',
    externalId: id,
    idempotencyKey: `${id}-v1`,
    providerUpdatedAt: new Date(at),
    observedAt: new Date(at),
    rawPayload: { id }
  });

  const config = {
    intelligenceEnabled: true,
    decisionVersion: 'decision-v1',
    contextVersion: 'context-v1',
    policyVersion: 'policy-v1',
    policy: defaultPolicyConfig
  };

  beforeAll(async () => {
    admin = createDatabase(adminUrl!);
    runtime = createDatabase(runtimeUrl!);
    await admin.db.insert(user).values([
      { id: userAId, name: 'Intelligence A', email: `${userAId}@example.test` },
      { id: userBId, name: 'Intelligence B', email: `${userBId}@example.test` },
      { id: userCId, name: 'Seller sem ownership', email: `${userCId}@example.test` }
    ]);
    await admin.db.insert(organizations).values([
      { id: organizationAId, name: 'Intelligence A', slug: `intelligence-a-${organizationAId}` },
      { id: organizationBId, name: 'Intelligence B', slug: `intelligence-b-${organizationBId}` }
    ]);
    await admin.db.insert(memberships).values([
      { organizationId: organizationAId, userId: userAId, role: 'SELLER' },
      { organizationId: organizationBId, userId: userBId, role: 'OWNER' },
      { organizationId: organizationAId, userId: userCId, role: 'SELLER' }
    ]);
    const resolvedA = await resolveTenantContext(runtime.db, userAId, organizationAId);
    const resolvedB = await resolveTenantContext(runtime.db, userBId, organizationBId);
    const resolvedC = await resolveTenantContext(runtime.db, userCId, organizationAId);
    if (!resolvedA || !resolvedB || !resolvedC) throw new Error('Intelligence tenant setup failed');
    contextA = resolvedA;
    contextB = resolvedB;
    contextC = resolvedC;

    const serviceA = new CommercialIngestionService(runtime.db, contextA);
    const serviceB = new CommercialIngestionService(runtime.db, contextB);
    dealAId = (
      await serviceA.ingestDeal(source('deal-a'), {
        title: 'Deal A',
        status: 'OPEN',
        ownerMembershipId: contextA.membershipId
      })
    ).id;
    dealBId = (await serviceB.ingestDeal(source('deal-b'), { title: 'Deal B', status: 'OPEN' })).id;
    conversationAId = (
      await serviceA.ingestConversation(source('conversation-a'), {
        subject: 'Conversa A',
        channel: 'OTHER',
        dealId: dealAId,
        startedAt: new Date('2026-10-06T11:00:00Z')
      })
    ).id;
    firstEventId = (
      await serviceA.ingestCommercialEvent(source('event-budget-5000'), {
        dealId: dealAId,
        conversationId: conversationAId,
        actorType: 'LEAD',
        source: 'OTHER',
        type: 'MESSAGE',
        text: 'O preço ficou acima do orçamento de R$ 5.000.',
        occurredAt: new Date('2026-10-06T12:00:00Z')
      })
    ).id;
    await admin.db.insert(interventionTemplates).values({
      organizationId: organizationAId,
      code: 'org-handle-price-v1',
      category: 'OBJECTION',
      subtype: 'PRICE',
      strategy: 'HANDLE_PRICE',
      title: 'Regra de preço da organização',
      guidance: 'Exija aprovação do manager antes de condições.',
      suggestedQuestions: ['Qual impacto justifica o investimento?'],
      warnings: ['Não oferecer desconto sem aprovação.'],
      conditions: {},
      version: 1
    });
  });

  afterAll(async () => {
    await admin.db
      .delete(organizations)
      .where(inArray(organizations.id, [organizationAId, organizationBId]));
    await admin.db.delete(user).where(inArray(user.id, [userAId, userBId, userCId]));
    await runtime.close();
    await admin.close();
  });

  it('processes event to decision, state, memory and organization intervention in shadow mode', async () => {
    const processor = new IntelligenceProcessor(
      runtime.db,
      contextA,
      new FixtureDecisionProvider(),
      config
    );
    const result = await processor.processEvent(firstEventId);
    expect(result).toMatchObject({
      deduplicated: false,
      policyResult: 'SHADOW',
      stateVersion: 1,
      memoryFactsCreated: 1,
      interventionOutcome: 'MATCHED'
    });
    const [candidate] = await admin.db
      .select()
      .from(interventionCandidates)
      .where(eq(interventionCandidates.aiDecisionId, result.decisionId));
    expect(candidate?.title).toBe('Regra de preço da organização');
    expect(candidate?.shadowMode).toBe(true);
    expect(
      await admin.db
        .select()
        .from(generationJobs)
        .where(eq(generationJobs.candidateId, candidate!.id))
    ).toHaveLength(0);
    expect(
      await new CopilotRepository(runtime.db, contextA).deliverDecision(
        result.decisionId,
        'shadow-test',
        result.stateVersion,
        { realtimeEnabled: true }
      )
    ).toMatchObject({ delivery: null, reason: 'SHADOW_MODE' });
  });

  it('delivers once in visible mode, replays realtime and records lifecycle feedback', async () => {
    const copilot = new CopilotRepository(runtime.db, contextA);
    await copilot.updateSettings({
      mode: 'VISIBLE',
      realtimeEnabled: true,
      feedbackEnabled: true,
      maxCardsPerWindow: 3,
      cardWindowSeconds: 900,
      cooldownSeconds: 0,
      minimumPriority: 40,
      deliveryTtlSeconds: 900,
      generativeAiEnabled: true,
      generateInShadow: true,
      companyRules: ['Não oferecer desconto sem aprovação.'],
      maxGenerationInputCharacters: 6000,
      maxGenerationOutputCharacters: 700,
      organizationGenerationBudgetMicros: 0,
      sellerGenerationBudgetMicros: 0,
      maxCostPerInterventionMicros: 0
    });
    const service = new CommercialIngestionService(runtime.db, contextA);
    const event = await service.ingestCommercialEvent(
      source('event-visible-buying', '2026-10-06T15:00:00Z'),
      {
        dealId: dealAId,
        conversationId: conversationAId,
        actorType: 'LEAD',
        source: 'OTHER',
        type: 'MESSAGE',
        text: 'Como funciona o onboarding e quando podemos começar?',
        occurredAt: new Date('2026-10-06T15:00:00Z')
      }
    );
    const result = await new IntelligenceProcessor(
      runtime.db,
      contextA,
      new FixtureDecisionProvider(),
      {
        ...config,
        policy: { ...defaultPolicyConfig, shadowMode: false, interventionsVisible: true }
      }
    ).processEvent(event.id);
    const delivered = await copilot.deliverDecision(
      result.decisionId,
      'visible-test',
      result.stateVersion
    );
    expect(delivered.delivery).toMatchObject({
      status: 'DELIVERED',
      conversationId: conversationAId
    });
    const duplicate = await copilot.deliverDecision(
      result.decisionId,
      'visible-test',
      result.stateVersion
    );
    expect(duplicate.delivery).toBeNull();
    const events = await copilot.listRealtimeEvents();
    expect(events.some((item) => item.type === 'intervention.created')).toBe(true);
    const deliveryId = delivered.delivery!.deliveryId;
    expect((await copilot.transition(deliveryId, 'VIEWED')).status).toBe('VIEWED');
    await copilot.feedback(deliveryId, { rating: 'HELPFUL', actionTaken: 'COPIED' });
    expect((await copilot.transition(deliveryId, 'APPLIED')).status).toBe('APPLIED');
    expect((await copilot.analytics()).helpful).toBe(1);
  });

  it('completes generation-required through fixture validation and delivery', async () => {
    const service = new CommercialIngestionService(runtime.db, contextA);
    const event = await service.ingestCommercialEvent(
      source('event-generation-required', '2026-10-06T15:30:00Z'),
      {
        dealId: dealAId,
        conversationId: conversationAId,
        actorType: 'LEAD',
        source: 'OTHER',
        type: 'MESSAGE',
        text: 'Ainda não ficou claro como avaliar o impacto desta mudança.',
        occurredAt: new Date('2026-10-06T15:30:00Z')
      }
    );
    const provider: DecisionProvider = {
      metadata: {
        provider: 'generation-fixture',
        model: 'structured-decision',
        modelVersion: '1',
        configVersion: '1'
      },
      decide: () =>
        Promise.resolve({
          significance: 'MEDIUM',
          eventClassification: 'QUESTION',
          objection: null,
          buyingSignal: null,
          risk: null,
          sentimentShift: 'NEUTRAL',
          interventionNeeded: true,
          strategy: 'INVESTIGATE',
          historicalRetrievalNeeded: false,
          stateUpdates: [],
          memoryUpdates: [],
          confidence: 0.9
        })
    };
    const decision = await new IntelligenceProcessor(runtime.db, contextA, provider, {
      ...config,
      policy: { ...defaultPolicyConfig, shadowMode: false, interventionsVisible: true }
    }).processEvent(event.id);
    expect(decision.interventionOutcome).toBe('GENERATION_REQUIRED');
    const jobs = new GenerationJobRepository(runtime.db, contextA);
    const job = await jobs.claimNext();
    expect(job?.candidateId).toBeTruthy();
    const generativeProvider = new FixtureGenerativeProvider();
    const generativeProcessor = new GenerativeProcessor(runtime.db, contextA, generativeProvider, {
      generativeAiEnabled: true,
      pricing: { inputMicrosPerMillionTokens: 0n, outputMicrosPerMillionTokens: 0n },
      maxValidationRetries: 1
    });
    const generated = await generativeProcessor.process(job!);
    expect(generated).toMatchObject({ eligibleForDelivery: true, reason: 'GENERATED' });
    const replay = await generativeProcessor.process(job!);
    expect(replay).toMatchObject({ deduplicated: true, executionId: generated.executionId });
    expect(generativeProvider.calls).toBe(1);
    await jobs.complete(job!.id);
    const delivered = await new CopilotRepository(runtime.db, contextA).deliverDecision(
      generated.decisionId,
      job!.correlationId,
      null
    );
    expect(delivered.delivery?.status).toBe('DELIVERED');
    expect(
      await admin.db
        .select()
        .from(generativeExecutions)
        .where(eq(generativeExecutions.id, generated.executionId!))
    ).toHaveLength(1);
  });

  it('does not expose seller-targeted realtime events to another tenant', async () => {
    expect(await new CopilotRepository(runtime.db, contextB).listRealtimeEvents()).toEqual([]);
  });

  it('does not list another seller conversation inside the same organization', async () => {
    expect(await new ConversationRepository(runtime.db, contextC).list({ limit: 30 })).toEqual({
      items: [],
      nextCursor: null
    });
    expect(
      await new CopilotRepository(runtime.db, contextC).getConversationContext(conversationAId)
    ).toBeNull();
  });

  it('is idempotent for the same event and processing versions', async () => {
    const processor = new IntelligenceProcessor(
      runtime.db,
      contextA,
      new FixtureDecisionProvider(),
      config
    );
    const replay = await processor.processEvent(firstEventId);
    expect(replay.deduplicated).toBe(true);
    const [decisions, revisions, facts, candidates] = await Promise.all([
      admin.db
        .select({ value: count() })
        .from(aiDecisions)
        .where(
          and(
            eq(aiDecisions.organizationId, organizationAId),
            eq(aiDecisions.commercialEventId, firstEventId)
          )
        ),
      admin.db
        .select({ value: count() })
        .from(dealStateRevisions)
        .where(
          and(
            eq(dealStateRevisions.organizationId, organizationAId),
            eq(dealStateRevisions.sourceEventId, firstEventId)
          )
        ),
      admin.db
        .select({ value: count() })
        .from(memoryFacts)
        .where(
          and(eq(memoryFacts.organizationId, organizationAId), eq(memoryFacts.scopeId, dealAId))
        ),
      admin.db
        .select({ value: count() })
        .from(interventionCandidates)
        .where(
          and(
            eq(interventionCandidates.organizationId, organizationAId),
            eq(interventionCandidates.commercialEventId, firstEventId)
          )
        )
    ]);
    expect(decisions[0]?.value).toBe(1);
    expect(revisions[0]?.value).toBe(1);
    expect(facts[0]?.value).toBe(1);
    expect(candidates[0]?.value).toBe(1);
  });

  it('promotes fixture audio through transcript, commercial event, intelligence and delivery', async () => {
    const root = await mkdtemp(join(tmpdir(), 'morubi-audio-integration-'));
    try {
      const ingestion = new CommercialIngestionService(runtime.db, contextA);
      const dealId = (
        await ingestion.ingestDeal(source('audio-deal'), {
          title: 'Audio deal',
          status: 'OPEN',
          ownerMembershipId: contextA.membershipId
        })
      ).id;
      const conversationId = (
        await ingestion.ingestConversation(source('audio-conversation'), {
          subject: 'Audio conversation',
          channel: 'WHATSAPP',
          dealId,
          startedAt: new Date('2026-10-07T10:00:00Z')
        })
      ).id;
      const occurredAt = new Date('2026-10-07T10:01:00Z');
      const message = await ingestion.ingestMessage(source('audio-message'), {
        conversationId,
        senderType: 'LEAD',
        contentType: 'AUDIO',
        occurredAt
      });
      const storage = new LocalObjectStorage(root);
      const assets = new AudioAssetService(runtime.db, contextA, storage, {
        maxBytes: 1_000_000,
        retentionDays: 30,
        provider: 'fixture-transcription',
        model: 'fixture-v1'
      });
      await assets.setOrganizationEnabled(true);
      const created = await assets.ingest({
        conversationId,
        messageId: message.id,
        sourceProvider: 'whatsapp-fixture',
        mimeType: 'audio/wav',
        durationMs: 1_000,
        speakerType: 'LEAD',
        occurredAt,
        data: syntheticWavFixture('Gostei, mas achei o valor muito alto.'),
        correlationId: 'audio-integration'
      });
      const jobs = new TranscriptionJobRepository(runtime.db, contextA);
      const job = await jobs.claimNext();
      expect(job?.id).toBe(created.jobId);
      const transcription = await new TranscriptionProcessor(
        runtime.db,
        contextA,
        storage,
        new FixtureTranscriptionProvider(),
        {
          inputMicrosPerMillionTokens: 0n,
          outputMicrosPerMillionTokens: 0n,
          audioMicrosPerMinute: 0n
        }
      ).process(job!);
      await jobs.complete(job!.id);
      expect(transcription.eventId).toBeTruthy();
      const [transcript] = await admin.db
        .select()
        .from(audioTranscripts)
        .where(eq(audioTranscripts.id, transcription.transcriptId));
      const [event] = await admin.db
        .select()
        .from(commercialEvents)
        .where(eq(commercialEvents.id, transcription.eventId!));
      expect(transcript?.text).toBe('Gostei, mas achei o valor muito alto.');
      expect(event).toMatchObject({
        occurredAt,
        contentOrigin: 'AUDIO_TRANSCRIPT',
        source: 'WHATSAPP'
      });
      const decision = await new IntelligenceProcessor(
        runtime.db,
        contextA,
        new FixtureDecisionProvider(),
        {
          ...config,
          policy: { ...defaultPolicyConfig, shadowMode: false, interventionsVisible: true }
        }
      ).processEvent(event!.id);
      const delivery = await new CopilotRepository(runtime.db, contextA).deliverDecision(
        decision.decisionId,
        'audio-integration',
        decision.stateVersion,
        {
          shadowMode: false,
          interventionsVisible: true,
          realtimeEnabled: false,
          feedbackEnabled: false
        }
      );
      expect(delivery.delivery?.category).toBe('OBJECTION');
      expect(
        await new AudioAssetService(runtime.db, contextB, storage, {
          maxBytes: 1_000_000,
          retentionDays: 30,
          provider: 'fixture-transcription',
          model: 'fixture-v1'
        }).getBinaryByMessage(message.id)
      ).toBeNull();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves contradictory memory and advances state revision', async () => {
    const service = new CommercialIngestionService(runtime.db, contextA);
    const event = await service.ingestCommercialEvent(
      source('event-budget-8000', '2026-10-06T13:00:00Z'),
      {
        dealId: dealAId,
        actorType: 'LEAD',
        source: 'OTHER',
        type: 'MESSAGE',
        text: 'O preço cabe no orçamento de R$ 8.000.',
        occurredAt: new Date('2026-10-06T13:00:00Z')
      }
    );
    const result = await new IntelligenceProcessor(
      runtime.db,
      contextA,
      new FixtureDecisionProvider(),
      config
    ).processEvent(event.id);
    expect(result.stateVersion).toBe(2);
    const facts = await admin.db
      .select()
      .from(memoryFacts)
      .where(and(eq(memoryFacts.organizationId, organizationAId), eq(memoryFacts.scopeId, dealAId)))
      .orderBy(memoryFacts.createdAt);
    expect(facts).toHaveLength(2);
    expect(facts[0]?.status).toBe('SUPERSEDED');
    expect(facts[1]).toMatchObject({
      value: '8.000',
      status: 'ACTIVE',
      supersedesId: facts[0]?.id
    });
  });

  it('persists low confidence decisions but suppresses state, memory and visibility', async () => {
    const service = new CommercialIngestionService(runtime.db, contextA);
    const event = await service.ingestCommercialEvent(
      source('event-low-confidence', '2026-10-06T14:00:00Z'),
      {
        dealId: dealAId,
        actorType: 'LEAD',
        source: 'OTHER',
        type: 'MESSAGE',
        text: 'Talvez.',
        occurredAt: new Date('2026-10-06T14:00:00Z')
      }
    );
    const lowProvider: DecisionProvider = {
      metadata: { provider: 'low-fixture', model: 'low', modelVersion: '1', configVersion: '1' },
      decide: () =>
        Promise.resolve({
          significance: 'LOW',
          eventClassification: 'OTHER',
          objection: null,
          buyingSignal: null,
          risk: null,
          sentimentShift: 'NEUTRAL',
          interventionNeeded: true,
          strategy: 'INVESTIGATE',
          historicalRetrievalNeeded: false,
          stateUpdates: [
            {
              operation: 'SET',
              field: 'intentLevel',
              value: 'LOW',
              confidence: 0.3,
              sourceEventIds: [event.id]
            }
          ],
          memoryUpdates: [
            {
              operation: 'UPSERT_FACT',
              scopeType: 'DEAL_FACT',
              scopeId: dealAId,
              factType: 'UNCERTAIN',
              value: 'Talvez',
              confidence: 0.3,
              sourceEventIds: [event.id]
            }
          ],
          confidence: 0.3
        })
    };
    const result = await new IntelligenceProcessor(runtime.db, contextA, lowProvider, {
      ...config,
      policy: { ...defaultPolicyConfig, shadowMode: false, interventionsVisible: true }
    }).processEvent(event.id);
    expect(result).toMatchObject({
      policyResult: 'SUPPRESS',
      stateVersion: null,
      memoryFactsCreated: 0,
      interventionOutcome: 'SUPPRESSED'
    });
    const [candidate] = await admin.db
      .select({ id: interventionCandidates.id })
      .from(interventionCandidates)
      .where(eq(interventionCandidates.aiDecisionId, result.decisionId));
    expect(
      await admin.db
        .select()
        .from(generationJobs)
        .where(eq(generationJobs.candidateId, candidate!.id))
    ).toHaveLength(0);
  });

  it('enforces tenant isolation for state, memory, decisions and candidates', async () => {
    const repositoryB = new IntelligenceReadRepository(runtime.db, contextB);
    expect(await repositoryB.getDealState(dealAId)).toBeNull();
    expect(await repositoryB.getDealMemory(dealAId)).toEqual([]);
    expect((await repositoryB.listDecisions()).some((row) => row.decision.dealId === dealAId)).toBe(
      false
    );
    const client = await runtime.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('app.current_user_id', $1, true), set_config('app.current_organization_id', $2, true)",
        [userBId, organizationBId]
      );
      for (const table of [
        'deal_states',
        'memory_facts',
        'ai_decisions',
        'intervention_candidates',
        'generation_jobs',
        'generative_executions',
        'conversation_read_states',
        'intelligence_jobs',
        'intervention_deliveries',
        'intervention_feedback',
        'realtime_events'
      ]) {
        const result = await client.query(`select id from ${table} where organization_id = $1`, [
          organizationAId
        ]);
        expect(result.rowCount).toBe(0);
      }
      await client.query('rollback');
    } finally {
      client.release();
    }
    expect(dealBId).toBeTruthy();
  });

  it('has forced RLS on every Phase 4/5 tenant table and protected global templates', async () => {
    const tables = [
      'ai_decisions',
      'ai_usage',
      'deal_state_revisions',
      'deal_states',
      'conversation_read_states',
      'intelligence_settings',
      'intervention_candidates',
      'generation_jobs',
      'generative_executions',
      'intervention_templates',
      'memory_facts',
      'intelligence_jobs',
      'intervention_deliveries',
      'intervention_feedback',
      'realtime_events'
    ];
    const result = await admin.pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      'select relname, relrowsecurity, relforcerowsecurity from pg_class where relname = any($1::text[]) order by relname',
      [tables]
    );
    expect(result.rows).toHaveLength(tables.length);
    expect(result.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);
    expect(
      await admin.db
        .select()
        .from(intelligenceSettings)
        .where(eq(intelligenceSettings.organizationId, organizationAId))
    ).toHaveLength(1);
  });
});
