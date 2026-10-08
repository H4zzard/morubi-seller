import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type {
  ConversationContextDto,
  CopilotAnalyticsDto,
  InterventionCardDto,
  InterventionFeedbackInput,
  RealtimeEventEnvelope
} from '@morubi/contracts';
import type { TenantContext } from '@morubi/domain';
import { errors } from '@morubi/domain';
import {
  categoryForDecision,
  defaultPriorityByCategory,
  evaluateCardFatigue
} from '@morubi/intelligence';
import type { MorubiDatabase } from './database.js';
import {
  aiDecisions,
  commercialEvents,
  contacts,
  conversations,
  dealStates,
  deals,
  generationJobs,
  intelligenceJobs,
  intelligenceSettings,
  interventionCandidates,
  interventionDeliveries,
  interventionFeedback,
  liveCallSessions,
  liveTranscriptTurns,
  memoryFacts,
  realtimeEvents
} from './schema.js';
import { setTenantContext } from './tenant.js';

type DatabaseTransaction = Parameters<Parameters<MorubiDatabase['transaction']>[0]>[0];

export const devConversationScenarios = {
  PRICE: 'O preço está bem acima do nosso orçamento. Precisamos de desconto.',
  COMPETITOR: 'Estamos comparando vocês com a Salesforce e o concorrente parece mais completo.',
  TIMING: 'Agora não é o momento. Talvez no próximo trimestre.',
  DECISION_MAKER: 'Preciso envolver a diretora financeira, ela é quem aprova.',
  BUYING_SIGNAL: 'Gostei. Como funciona o onboarding e quando podemos começar?',
  REJECTION: 'Decidimos não seguir. Por favor, encerre o contato.',
  NEUTRAL: 'Obrigado pelo material. Vou compartilhar internamente.'
} as const;

export type DevConversationScenario = keyof typeof devConversationScenarios;

export interface CopilotDeliverySettings {
  shadowMode: boolean;
  interventionsVisible: boolean;
  realtimeEnabled: boolean;
  feedbackEnabled: boolean;
  maxCardsPerWindow: number;
  cardWindowSeconds: number;
  cooldownSeconds: number;
  minimumPriority: number;
  deliveryTtlSeconds: number;
  generativeAiEnabled: boolean;
  generateInShadow: boolean;
  liveCopilotEnabled: boolean;
  liveCardTtlSeconds: number;
}

function cardDto(row: typeof interventionDeliveries.$inferSelect): InterventionCardDto {
  return {
    deliveryId: row.id,
    conversationId: row.conversationId,
    dealId: row.dealId,
    liveCallSessionId: row.liveCallSessionId,
    liveTranscriptTurnId: row.liveTranscriptTurnId,
    category: row.category,
    priority: row.priority,
    title: row.title,
    guidance: row.guidance,
    suggestedQuestion: row.suggestedQuestion,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString()
  };
}

function envelopeDto(row: typeof realtimeEvents.$inferSelect): RealtimeEventEnvelope {
  return {
    id: row.id,
    version: 1,
    type: row.type as RealtimeEventEnvelope['type'],
    occurredAt: row.occurredAt.toISOString(),
    correlationId: row.correlationId,
    conversationId: row.conversationId,
    dealId: row.dealId,
    liveCallSessionId: row.liveCallSessionId,
    payload: row.payload
  };
}

export class IntelligenceJobRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  public async enqueue(
    commercialEventId: string,
    correlationId: string,
    options: { priority?: number; source?: string; deadlineAt?: Date } = {}
  ): Promise<string> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const processingKey = `${commercialEventId}:active-pipeline`;
      const [job] = await tx
        .insert(intelligenceJobs)
        .values({
          organizationId: this.context.organizationId,
          commercialEventId,
          processingKey,
          correlationId,
          priority: options.priority ?? 0,
          source: options.source ?? 'ASYNC',
          deadlineAt: options.deadlineAt
        })
        .onConflictDoUpdate({
          target: [intelligenceJobs.organizationId, intelligenceJobs.processingKey],
          set: { updatedAt: new Date() }
        })
        .returning({ id: intelligenceJobs.id });
      return job!.id;
    });
  }

  public async claimNext(): Promise<typeof intelligenceJobs.$inferSelect | null> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [job] = await tx
        .select()
        .from(intelligenceJobs)
        .where(
          and(
            eq(intelligenceJobs.organizationId, this.context.organizationId),
            or(
              eq(intelligenceJobs.status, 'PENDING'),
              and(
                eq(intelligenceJobs.status, 'RUNNING'),
                lt(intelligenceJobs.lockedAt, new Date(Date.now() - 5 * 60_000))
              )
            ),
            sql`${intelligenceJobs.availableAt} <= now()`
          )
        )
        .orderBy(
          desc(intelligenceJobs.priority),
          asc(intelligenceJobs.availableAt),
          asc(intelligenceJobs.createdAt)
        )
        .limit(1)
        .for('update', { skipLocked: true });
      if (!job) return null;
      const [claimed] = await tx
        .update(intelligenceJobs)
        .set({ status: 'RUNNING', lockedAt: new Date(), attempts: job.attempts + 1 })
        .where(eq(intelligenceJobs.id, job.id))
        .returning();
      return claimed ?? null;
    });
  }

  public async complete(jobId: string): Promise<void> {
    await this.finish(jobId, { status: 'COMPLETED', finishedAt: new Date(), errorCode: null });
  }

  public async fail(job: typeof intelligenceJobs.$inferSelect, error: unknown): Promise<void> {
    const terminal = job.attempts >= job.maxAttempts;
    await this.finish(job.id, {
      status: terminal ? 'FAILED' : 'PENDING',
      availableAt: new Date(Date.now() + Math.min(30_000, 1_000 * 2 ** job.attempts)),
      finishedAt: terminal ? new Date() : null,
      lockedAt: null,
      errorCode: error instanceof Error ? error.name.slice(0, 80) : 'UNKNOWN'
    });
  }

  private async finish(
    jobId: string,
    values: Partial<typeof intelligenceJobs.$inferInsert>
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx
        .update(intelligenceJobs)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(intelligenceJobs.organizationId, this.context.organizationId),
            eq(intelligenceJobs.id, jobId)
          )
        );
    });
  }
}

export class CopilotRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  private run<T>(operation: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      return operation(tx);
    });
  }

  public async settings(
    defaults?: Partial<CopilotDeliverySettings>
  ): Promise<CopilotDeliverySettings> {
    return this.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(intelligenceSettings)
        .where(eq(intelligenceSettings.organizationId, this.context.organizationId))
        .limit(1);
      return {
        shadowMode: row?.shadowMode ?? defaults?.shadowMode ?? true,
        interventionsVisible: row?.interventionsVisible ?? defaults?.interventionsVisible ?? false,
        realtimeEnabled: row?.realtimeEnabled ?? defaults?.realtimeEnabled ?? false,
        feedbackEnabled: row?.feedbackEnabled ?? defaults?.feedbackEnabled ?? false,
        maxCardsPerWindow: row?.maxCardsPerWindow ?? defaults?.maxCardsPerWindow ?? 3,
        cardWindowSeconds: row?.cardWindowSeconds ?? defaults?.cardWindowSeconds ?? 900,
        cooldownSeconds: row?.cooldownSeconds ?? defaults?.cooldownSeconds ?? 180,
        minimumPriority: row?.minimumPriority ?? defaults?.minimumPriority ?? 40,
        deliveryTtlSeconds: row?.deliveryTtlSeconds ?? defaults?.deliveryTtlSeconds ?? 900,
        generativeAiEnabled: row?.generativeAiEnabled ?? defaults?.generativeAiEnabled ?? false,
        generateInShadow: row?.generateInShadow ?? defaults?.generateInShadow ?? true,
        liveCopilotEnabled: row?.liveCopilotEnabled ?? defaults?.liveCopilotEnabled ?? false,
        liveCardTtlSeconds: row?.liveCardTtlSeconds ?? defaults?.liveCardTtlSeconds ?? 20
      };
    });
  }

  public async updateSettings(input: {
    mode: 'SHADOW' | 'VISIBLE';
    realtimeEnabled: boolean;
    feedbackEnabled: boolean;
    maxCardsPerWindow: number;
    cardWindowSeconds: number;
    cooldownSeconds: number;
    minimumPriority: number;
    deliveryTtlSeconds: number;
    generativeAiEnabled?: boolean;
    generateInShadow?: boolean;
    companyRules?: string[];
    maxGenerationInputCharacters?: number;
    maxGenerationOutputCharacters?: number;
    organizationGenerationBudgetMicros?: number;
    sellerGenerationBudgetMicros?: number;
    maxCostPerInterventionMicros?: number;
  }): Promise<CopilotDeliverySettings> {
    return this.run(async (tx) => {
      const generativeAiEnabled = input.generativeAiEnabled ?? false;
      const generateInShadow = input.generateInShadow ?? true;
      const companyRules = input.companyRules ?? [
        'Não oferecer desconto sem aprovação.',
        'Não inventar preço, prazo, feature ou condição comercial.'
      ];
      const maxGenerationInputCharacters = input.maxGenerationInputCharacters ?? 6_000;
      const maxGenerationOutputCharacters = input.maxGenerationOutputCharacters ?? 700;
      const organizationGenerationBudgetMicros = BigInt(
        input.organizationGenerationBudgetMicros ?? 0
      );
      const sellerGenerationBudgetMicros = BigInt(input.sellerGenerationBudgetMicros ?? 0);
      const maxCostPerInterventionMicros = BigInt(input.maxCostPerInterventionMicros ?? 0);
      await tx
        .insert(intelligenceSettings)
        .values({
          organizationId: this.context.organizationId,
          intelligenceEnabled: true,
          shadowMode: input.mode === 'SHADOW',
          interventionsVisible: input.mode === 'VISIBLE',
          realtimeEnabled: input.realtimeEnabled,
          feedbackEnabled: input.feedbackEnabled,
          maxCardsPerWindow: input.maxCardsPerWindow,
          cardWindowSeconds: input.cardWindowSeconds,
          cooldownSeconds: input.cooldownSeconds,
          minimumPriority: input.minimumPriority,
          deliveryTtlSeconds: input.deliveryTtlSeconds,
          generativeAiEnabled,
          generateInShadow,
          companyRules,
          maxGenerationInputCharacters,
          maxGenerationOutputCharacters,
          organizationGenerationBudgetMicros,
          sellerGenerationBudgetMicros,
          maxCostPerInterventionMicros,
          thresholds: {
            objection: 0.7,
            risk: 0.75,
            buyingSignal: 0.7,
            intervention: 0.65,
            stateUpdate: 0.65,
            memoryUpdate: 0.8
          }
        })
        .onConflictDoUpdate({
          target: intelligenceSettings.organizationId,
          set: {
            intelligenceEnabled: true,
            shadowMode: input.mode === 'SHADOW',
            interventionsVisible: input.mode === 'VISIBLE',
            realtimeEnabled: input.realtimeEnabled,
            feedbackEnabled: input.feedbackEnabled,
            maxCardsPerWindow: input.maxCardsPerWindow,
            cardWindowSeconds: input.cardWindowSeconds,
            cooldownSeconds: input.cooldownSeconds,
            minimumPriority: input.minimumPriority,
            deliveryTtlSeconds: input.deliveryTtlSeconds,
            generativeAiEnabled,
            generateInShadow,
            companyRules,
            maxGenerationInputCharacters,
            maxGenerationOutputCharacters,
            organizationGenerationBudgetMicros,
            sellerGenerationBudgetMicros,
            maxCostPerInterventionMicros,
            updatedAt: new Date()
          }
        });
      return {
        shadowMode: input.mode === 'SHADOW',
        interventionsVisible: input.mode === 'VISIBLE',
        realtimeEnabled: input.realtimeEnabled,
        feedbackEnabled: input.feedbackEnabled,
        maxCardsPerWindow: input.maxCardsPerWindow,
        cardWindowSeconds: input.cardWindowSeconds,
        cooldownSeconds: input.cooldownSeconds,
        minimumPriority: input.minimumPriority,
        deliveryTtlSeconds: input.deliveryTtlSeconds,
        generativeAiEnabled,
        generateInShadow,
        liveCopilotEnabled: false,
        liveCardTtlSeconds: 20
      };
    });
  }

  public async deliverDecision(
    decisionId: string,
    correlationId: string,
    stateVersion: number | null,
    defaults?: Partial<CopilotDeliverySettings>
  ): Promise<{ delivery: InterventionCardDto | null; reason: string }> {
    return this.run(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${this.context.organizationId}), hashtext(${decisionId}))`
      );
      const [row] = await tx
        .select({
          candidate: interventionCandidates,
          decision: aiDecisions,
          event: commercialEvents,
          ownerMembershipId: deals.ownerMembershipId,
          liveSellerMembershipId: liveCallSessions.sellerMembershipId
        })
        .from(interventionCandidates)
        .innerJoin(
          aiDecisions,
          and(
            eq(aiDecisions.organizationId, interventionCandidates.organizationId),
            eq(aiDecisions.id, interventionCandidates.aiDecisionId)
          )
        )
        .innerJoin(
          commercialEvents,
          and(
            eq(commercialEvents.organizationId, interventionCandidates.organizationId),
            eq(commercialEvents.id, interventionCandidates.commercialEventId)
          )
        )
        .innerJoin(
          deals,
          and(
            eq(deals.organizationId, interventionCandidates.organizationId),
            eq(deals.id, interventionCandidates.dealId)
          )
        )
        .leftJoin(
          liveCallSessions,
          and(
            eq(liveCallSessions.organizationId, commercialEvents.organizationId),
            eq(liveCallSessions.id, commercialEvents.liveCallSessionId)
          )
        )
        .where(
          and(
            eq(interventionCandidates.organizationId, this.context.organizationId),
            eq(interventionCandidates.aiDecisionId, decisionId)
          )
        )
        .limit(1);
      if (!row) return { delivery: null, reason: 'CANDIDATE_NOT_FOUND' };
      const sellerMembershipId = row.liveSellerMembershipId ?? row.ownerMembershipId;
      const conversationId = row.event.conversationId;
      if (!sellerMembershipId || !conversationId) {
        return { delivery: null, reason: 'SELLER_OR_CONVERSATION_MISSING' };
      }
      const [settingsRow] = await tx
        .select()
        .from(intelligenceSettings)
        .where(eq(intelligenceSettings.organizationId, this.context.organizationId))
        .limit(1);
      const settings: CopilotDeliverySettings = {
        shadowMode: settingsRow?.shadowMode ?? defaults?.shadowMode ?? true,
        interventionsVisible:
          settingsRow?.interventionsVisible ?? defaults?.interventionsVisible ?? false,
        realtimeEnabled: settingsRow?.realtimeEnabled ?? defaults?.realtimeEnabled ?? false,
        feedbackEnabled: settingsRow?.feedbackEnabled ?? defaults?.feedbackEnabled ?? false,
        maxCardsPerWindow: settingsRow?.maxCardsPerWindow ?? defaults?.maxCardsPerWindow ?? 3,
        cardWindowSeconds: settingsRow?.cardWindowSeconds ?? defaults?.cardWindowSeconds ?? 900,
        cooldownSeconds: settingsRow?.cooldownSeconds ?? defaults?.cooldownSeconds ?? 180,
        minimumPriority: settingsRow?.minimumPriority ?? defaults?.minimumPriority ?? 40,
        deliveryTtlSeconds: settingsRow?.deliveryTtlSeconds ?? defaults?.deliveryTtlSeconds ?? 900,
        generativeAiEnabled:
          settingsRow?.generativeAiEnabled ?? defaults?.generativeAiEnabled ?? false,
        generateInShadow: settingsRow?.generateInShadow ?? defaults?.generateInShadow ?? true,
        liveCopilotEnabled:
          settingsRow?.liveCopilotEnabled ?? defaults?.liveCopilotEnabled ?? false,
        liveCardTtlSeconds: settingsRow?.liveCardTtlSeconds ?? defaults?.liveCardTtlSeconds ?? 20
      };
      const now = new Date();
      const isLive = row.event.contentOrigin === 'CALL_TRANSCRIPT';
      if (isLive && !settings.liveCopilotEnabled)
        return { delivery: null, reason: 'LIVE_COPILOT_DISABLED' };
      if (isLive && row.event.liveTranscriptTurnId && row.event.liveCallSessionId) {
        const [latest] = await tx
          .select({ id: liveTranscriptTurns.id })
          .from(liveTranscriptTurns)
          .where(
            and(
              eq(liveTranscriptTurns.organizationId, this.context.organizationId),
              eq(liveTranscriptTurns.liveCallSessionId, row.event.liveCallSessionId),
              eq(liveTranscriptTurns.isFinal, true)
            )
          )
          .orderBy(desc(liveTranscriptTurns.sequence), desc(liveTranscriptTurns.createdAt))
          .limit(1);
        if (!latest || latest.id !== row.event.liveTranscriptTurnId)
          return { delivery: null, reason: 'LIVE_CARD_STALE' };
      }
      if (stateVersion !== null && settings.realtimeEnabled) {
        await tx.insert(realtimeEvents).values({
          organizationId: this.context.organizationId,
          sellerMembershipId,
          type: 'deal_state.updated',
          correlationId,
          conversationId,
          dealId: row.candidate.dealId,
          liveCallSessionId: row.event.liveCallSessionId,
          payload: { dealId: row.candidate.dealId, version: stateVersion },
          expiresAt: new Date(now.getTime() + 86_400_000)
        });
      }
      if (
        settings.shadowMode ||
        !settings.interventionsVisible ||
        !settings.realtimeEnabled ||
        row.candidate.outcome !== 'MATCHED' ||
        row.candidate.policyResult !== 'ALLOW' ||
        !row.candidate.title ||
        !row.candidate.guidance
      ) {
        return { delivery: null, reason: settings.shadowMode ? 'SHADOW_MODE' : 'NOT_ELIGIBLE' };
      }
      const category = categoryForDecision(row.decision.output);
      const priority = defaultPriorityByCategory[category];
      const dedupeKey = `${row.event.liveCallSessionId ?? conversationId}:${category}:${row.decision.output.strategy}`;
      const windowStart = new Date(now.getTime() - settings.cardWindowSeconds * 1_000);
      const recent = await tx
        .select({
          id: interventionDeliveries.id,
          category: interventionDeliveries.category,
          dedupeKey: interventionDeliveries.dedupeKey,
          createdAt: interventionDeliveries.createdAt,
          priority: interventionDeliveries.priority,
          status: interventionDeliveries.status
        })
        .from(interventionDeliveries)
        .where(
          and(
            eq(interventionDeliveries.organizationId, this.context.organizationId),
            eq(interventionDeliveries.sellerMembershipId, sellerMembershipId),
            gte(interventionDeliveries.createdAt, windowStart)
          )
        );
      const fatigue = evaluateCardFatigue({
        now,
        candidate: { category, priority, dedupeKey },
        recent,
        ...settings
      });
      if (!fatigue.allowed) return { delivery: null, reason: fatigue.reason };
      if (fatigue.reason === 'PRIORITY_PREEMPTION') {
        const displaced = [...recent]
          .filter((item) => ['CREATED', 'DELIVERED', 'VIEWED'].includes(item.status))
          .sort((left, right) => left.priority - right.priority)[0];
        if (displaced) {
          await tx
            .update(interventionDeliveries)
            .set({ status: 'EXPIRED', updatedAt: now })
            .where(eq(interventionDeliveries.id, displaced.id));
        }
      }
      const deliveryId = randomUUID();
      const expiresAt = new Date(
        now.getTime() + (isLive ? settings.liveCardTtlSeconds : settings.deliveryTtlSeconds) * 1_000
      );
      const latency = Math.max(0, now.getTime() - row.event.occurredAt.getTime());
      const [created] = await tx
        .insert(interventionDeliveries)
        .values({
          id: deliveryId,
          organizationId: this.context.organizationId,
          candidateId: row.candidate.id,
          sellerMembershipId,
          conversationId,
          liveCallSessionId: row.event.liveCallSessionId,
          liveTranscriptTurnId: row.event.liveTranscriptTurnId,
          dealId: row.candidate.dealId,
          category,
          priority,
          dedupeKey,
          title: row.candidate.title,
          guidance: row.candidate.guidance,
          suggestedQuestion: row.candidate.question,
          status: 'CREATED',
          correlationId,
          sourceEventOccurredAt: row.event.occurredAt,
          expiresAt,
          endToEndLatencyMs: null
        })
        .onConflictDoNothing()
        .returning();
      if (!created) return { delivery: null, reason: 'ALREADY_DELIVERED' };
      const [delivery] = await tx
        .update(interventionDeliveries)
        .set({
          status: 'DELIVERED',
          deliveredAt: now,
          endToEndLatencyMs: latency,
          updatedAt: now
        })
        .where(eq(interventionDeliveries.id, created.id))
        .returning();
      if (!delivery) throw new Error('DELIVERY_TRANSITION_FAILED');
      const card = cardDto(delivery);
      await tx.insert(realtimeEvents).values({
        organizationId: this.context.organizationId,
        sellerMembershipId,
        type: 'intervention.created',
        correlationId,
        conversationId,
        dealId: row.candidate.dealId,
        liveCallSessionId: row.event.liveCallSessionId,
        payload: { card },
        expiresAt: new Date(now.getTime() + 86_400_000)
      });
      return { delivery: card, reason: 'DELIVERED' };
    });
  }

  public async listRealtimeEvents(
    lastEventId?: string,
    limit = 50
  ): Promise<RealtimeEventEnvelope[]> {
    return this.run(async (tx) => {
      const now = new Date();
      let cursor: { occurredAt: Date; id: string } | undefined;
      if (lastEventId) {
        const [last] = await tx
          .select({ occurredAt: realtimeEvents.occurredAt, id: realtimeEvents.id })
          .from(realtimeEvents)
          .where(
            and(
              eq(realtimeEvents.organizationId, this.context.organizationId),
              eq(realtimeEvents.sellerMembershipId, this.context.membershipId),
              eq(realtimeEvents.id, lastEventId)
            )
          )
          .limit(1);
        cursor = last;
      }
      const conditions = [
        eq(realtimeEvents.organizationId, this.context.organizationId),
        eq(realtimeEvents.sellerMembershipId, this.context.membershipId),
        gt(realtimeEvents.expiresAt, now)
      ];
      if (cursor) {
        conditions.push(
          or(
            gt(realtimeEvents.occurredAt, cursor.occurredAt),
            and(eq(realtimeEvents.occurredAt, cursor.occurredAt), gt(realtimeEvents.id, cursor.id))
          )!
        );
      }
      const rows = await tx
        .select()
        .from(realtimeEvents)
        .where(and(...conditions))
        .orderBy(asc(realtimeEvents.occurredAt), asc(realtimeEvents.id))
        .limit(limit);
      return rows.map(envelopeDto);
    });
  }

  public async getConversationContext(
    conversationId: string
  ): Promise<ConversationContextDto | null> {
    return this.run(async (tx) => {
      const sellerScope =
        this.context.role === 'SELLER'
          ? eq(deals.ownerMembershipId, this.context.membershipId)
          : undefined;
      const [row] = await tx
        .select({
          conversation: conversations,
          contactName: contacts.name,
          companyName: contacts.companyName,
          deal: deals,
          ownerName: sql<string | null>`null::text`,
          state: dealStates.snapshot
        })
        .from(conversations)
        .innerJoin(
          deals,
          and(
            eq(deals.organizationId, conversations.organizationId),
            eq(deals.id, conversations.dealId)
          )
        )
        .leftJoin(
          contacts,
          and(
            eq(contacts.organizationId, conversations.organizationId),
            eq(contacts.id, conversations.primaryContactId)
          )
        )
        .leftJoin(
          dealStates,
          and(eq(dealStates.organizationId, deals.organizationId), eq(dealStates.dealId, deals.id))
        )
        .where(
          and(
            eq(conversations.organizationId, this.context.organizationId),
            eq(conversations.id, conversationId),
            isNull(conversations.archivedAt),
            sellerScope
          )
        )
        .limit(1);
      if (!row) return null;
      await tx
        .update(interventionDeliveries)
        .set({ status: 'EXPIRED', updatedAt: new Date() })
        .where(
          and(
            eq(interventionDeliveries.organizationId, this.context.organizationId),
            eq(interventionDeliveries.sellerMembershipId, this.context.membershipId),
            eq(interventionDeliveries.conversationId, conversationId),
            lt(interventionDeliveries.expiresAt, new Date()),
            inArray(interventionDeliveries.status, ['CREATED', 'DELIVERED', 'VIEWED'])
          )
        );
      const [facts, deliveryRows, settings, pendingGeneration] = await Promise.all([
        tx
          .select({
            id: memoryFacts.id,
            factType: memoryFacts.factType,
            value: memoryFacts.value,
            updatedAt: memoryFacts.updatedAt
          })
          .from(memoryFacts)
          .where(
            and(
              eq(memoryFacts.organizationId, this.context.organizationId),
              eq(memoryFacts.scopeType, 'DEAL_FACT'),
              eq(memoryFacts.scopeId, row.deal.id),
              eq(memoryFacts.status, 'ACTIVE')
            )
          )
          .orderBy(desc(memoryFacts.updatedAt))
          .limit(8),
        tx
          .select()
          .from(interventionDeliveries)
          .where(
            and(
              eq(interventionDeliveries.organizationId, this.context.organizationId),
              eq(interventionDeliveries.sellerMembershipId, this.context.membershipId),
              eq(interventionDeliveries.conversationId, conversationId)
            )
          )
          .orderBy(desc(interventionDeliveries.priority), desc(interventionDeliveries.createdAt))
          .limit(6),
        tx
          .select({ feedbackEnabled: intelligenceSettings.feedbackEnabled })
          .from(intelligenceSettings)
          .where(eq(intelligenceSettings.organizationId, this.context.organizationId))
          .limit(1),
        tx
          .select({ id: generationJobs.id })
          .from(generationJobs)
          .innerJoin(
            interventionCandidates,
            and(
              eq(interventionCandidates.organizationId, generationJobs.organizationId),
              eq(interventionCandidates.id, generationJobs.candidateId)
            )
          )
          .innerJoin(
            commercialEvents,
            and(
              eq(commercialEvents.organizationId, interventionCandidates.organizationId),
              eq(commercialEvents.id, interventionCandidates.commercialEventId)
            )
          )
          .where(
            and(
              eq(generationJobs.organizationId, this.context.organizationId),
              eq(commercialEvents.conversationId, conversationId),
              inArray(generationJobs.status, ['PENDING', 'RUNNING']),
              eq(interventionCandidates.outcome, 'GENERATION_REQUIRED')
            )
          )
          .limit(1)
      ]);
      const active = deliveryRows.find((item) =>
        ['CREATED', 'DELIVERED', 'VIEWED'].includes(item.status)
      );
      const snapshot = row.state ?? {};
      const value = (key: string): unknown =>
        (snapshot as Record<string, { value?: unknown }>)[key]?.value;
      const strings = (key: string): string[] => {
        const found = value(key);
        return Array.isArray(found) ? found.map(String) : [];
      };
      return {
        conversation: {
          id: row.conversation.id,
          subject: row.conversation.subject,
          contactName: row.contactName,
          companyName: row.companyName,
          dealId: row.deal.id,
          dealTitle: row.deal.title,
          dealStatus: row.deal.status,
          providerStageLabel: row.deal.providerStageLabel,
          ownerName: row.ownerName
        },
        summary: `Conversa com ${row.contactName ?? 'contato'} sobre ${row.deal.title}.`,
        currentState: snapshot,
        pains: strings('painPoints'),
        objections: strings('objections'),
        decisionMakers: strings('decisionMakers'),
        nextStep: typeof value('nextStep') === 'string' ? String(value('nextStep')) : null,
        memory: facts.map((fact) => ({ ...fact, updatedAt: fact.updatedAt.toISOString() })),
        copilot: {
          state: active ? 'INTERVENTION_READY' : pendingGeneration[0] ? 'ANALYZING' : 'IDLE',
          feedbackEnabled: settings[0]?.feedbackEnabled ?? false,
          current: active ? cardDto(active) : null,
          history: deliveryRows.filter((item) => item.id !== active?.id).map(cardDto)
        }
      };
    });
  }

  public async transition(
    deliveryId: string,
    target: 'VIEWED' | 'DISMISSED' | 'APPLIED'
  ): Promise<InterventionCardDto> {
    return this.run(async (tx) => {
      const now = new Date();
      const [current] = await tx
        .select()
        .from(interventionDeliveries)
        .where(
          and(
            eq(interventionDeliveries.organizationId, this.context.organizationId),
            eq(interventionDeliveries.sellerMembershipId, this.context.membershipId),
            eq(interventionDeliveries.id, deliveryId)
          )
        )
        .limit(1);
      if (!current) throw errors.notFound();
      const valid =
        (target === 'VIEWED' && current.status === 'DELIVERED') ||
        (target !== 'VIEWED' && ['DELIVERED', 'VIEWED'].includes(current.status));
      if (!valid) throw errors.conflict('A intervenção já está em um estado terminal.');
      const [updated] = await tx
        .update(interventionDeliveries)
        .set({
          status: target,
          viewedAt: target === 'VIEWED' ? now : current.viewedAt,
          dismissedAt: target === 'DISMISSED' ? now : current.dismissedAt,
          appliedAt: target === 'APPLIED' ? now : current.appliedAt,
          updatedAt: now
        })
        .where(eq(interventionDeliveries.id, deliveryId))
        .returning();
      await tx.insert(realtimeEvents).values({
        organizationId: this.context.organizationId,
        sellerMembershipId: this.context.membershipId,
        type: 'intervention.updated',
        correlationId: current.correlationId,
        conversationId: current.conversationId,
        dealId: current.dealId,
        payload: { deliveryId, status: target },
        expiresAt: new Date(now.getTime() + 86_400_000)
      });
      return cardDto(updated!);
    });
  }

  public async feedback(
    deliveryId: string,
    input: InterventionFeedbackInput
  ): Promise<{ recorded: true }> {
    return this.run(async (tx) => {
      const [settings, delivery] = await Promise.all([
        tx
          .select({ enabled: intelligenceSettings.feedbackEnabled })
          .from(intelligenceSettings)
          .where(eq(intelligenceSettings.organizationId, this.context.organizationId))
          .limit(1),
        tx
          .select({ id: interventionDeliveries.id })
          .from(interventionDeliveries)
          .where(
            and(
              eq(interventionDeliveries.organizationId, this.context.organizationId),
              eq(interventionDeliveries.sellerMembershipId, this.context.membershipId),
              eq(interventionDeliveries.id, deliveryId)
            )
          )
          .limit(1)
      ]);
      if (!delivery[0]) throw errors.notFound();
      if (!settings[0]?.enabled) throw errors.forbidden();
      await tx
        .insert(interventionFeedback)
        .values({
          organizationId: this.context.organizationId,
          deliveryId,
          sellerMembershipId: this.context.membershipId,
          rating: input.rating,
          actionTaken: input.actionTaken
        })
        .onConflictDoUpdate({
          target: [
            interventionFeedback.organizationId,
            interventionFeedback.deliveryId,
            interventionFeedback.sellerMembershipId
          ],
          set: { rating: input.rating, actionTaken: input.actionTaken }
        });
      return { recorded: true };
    });
  }

  public async analytics(): Promise<CopilotAnalyticsDto> {
    return this.run(async (tx) => {
      const [counts] = await tx
        .select({
          created: sql<number>`count(*)::int`,
          delivered: sql<number>`count(*) filter (where ${interventionDeliveries.deliveredAt} is not null)::int`,
          viewed: sql<number>`count(*) filter (where ${interventionDeliveries.viewedAt} is not null)::int`,
          dismissed: sql<number>`count(*) filter (where ${interventionDeliveries.dismissedAt} is not null)::int`,
          applied: sql<number>`count(*) filter (where ${interventionDeliveries.appliedAt} is not null)::int`,
          expired: sql<number>`count(*) filter (where ${interventionDeliveries.status} = 'EXPIRED')::int`,
          p50: sql<
            number | null
          >`percentile_cont(0.5) within group (order by ${interventionDeliveries.endToEndLatencyMs})`,
          p95: sql<
            number | null
          >`percentile_cont(0.95) within group (order by ${interventionDeliveries.endToEndLatencyMs})`
        })
        .from(interventionDeliveries)
        .where(eq(interventionDeliveries.organizationId, this.context.organizationId));
      const [ratings] = await tx
        .select({
          helpful: sql<number>`count(*) filter (where ${interventionFeedback.rating} = 'HELPFUL')::int`,
          notHelpful: sql<number>`count(*) filter (where ${interventionFeedback.rating} = 'NOT_HELPFUL')::int`
        })
        .from(interventionFeedback)
        .where(eq(interventionFeedback.organizationId, this.context.organizationId));
      const helpful = ratings?.helpful ?? 0;
      const notHelpful = ratings?.notHelpful ?? 0;
      return {
        created: counts?.created ?? 0,
        delivered: counts?.delivered ?? 0,
        viewed: counts?.viewed ?? 0,
        dismissed: counts?.dismissed ?? 0,
        applied: counts?.applied ?? 0,
        expired: counts?.expired ?? 0,
        helpful,
        notHelpful,
        falseCardRate: notHelpful / Math.max(1, helpful + notHelpful),
        endToEndLatencyMsP50: counts?.p50 == null ? null : Number(counts.p50),
        endToEndLatencyMsP95: counts?.p95 == null ? null : Number(counts.p95)
      };
    });
  }
}
