import { createHash, randomUUID } from 'node:crypto';
import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import type { TenantContext } from '@morubi/domain';
import { errors } from '@morubi/domain';
import {
  ContextBuilder,
  applyStateUpdates,
  buildProcessingKey,
  defaultPolicyConfig,
  evaluatePolicy,
  matchIntervention,
  parseDecisionOutput,
  type ContextRetriever,
  type DecisionEvent,
  type DecisionOutput,
  type DecisionProvider,
  type DealStateSnapshot,
  type InterventionTemplate,
  type MemoryFactContext,
  type PolicyConfig,
  type PreviousDecisionContext
} from '@morubi/intelligence';
import type { MorubiDatabase } from './database.js';
import {
  aiDecisions,
  aiUsage,
  commercialEvents,
  conversations,
  dealStateRevisions,
  dealStates,
  deals,
  generationJobs,
  intelligenceSettings,
  interventionCandidates,
  interventionTemplates,
  memoryFacts,
  messages
} from './schema.js';
import { setTenantContext } from './tenant.js';

export function canEventAdvanceState(
  latestOccurredAt: Date | null,
  incomingOccurredAt: string | Date
): boolean {
  return !latestOccurredAt || latestOccurredAt.getTime() <= new Date(incomingOccurredAt).getTime();
}

type DatabaseTransaction = Parameters<Parameters<MorubiDatabase['transaction']>[0]>[0];

function eventDto(row: typeof commercialEvents.$inferSelect): DecisionEvent {
  if (!row.dealId) throw new Error('COMMERCIAL_EVENT_WITHOUT_DEAL');
  return {
    id: row.id,
    dealId: row.dealId,
    contactId: row.contactId,
    actorType: row.actorType,
    type: row.type,
    text: row.text,
    occurredAt: row.occurredAt.toISOString(),
    contentOrigin: row.contentOrigin,
    liveCallSessionId: row.liveCallSessionId,
    liveTranscriptTurnId: row.liveTranscriptTurnId
  };
}

function memoryDto(row: typeof memoryFacts.$inferSelect): MemoryFactContext {
  return {
    id: row.id,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    factType: row.factType,
    value: row.value,
    confidence: row.confidence,
    sourceEventIds: row.sourceEventIds
  };
}

export class PostgresContextRetriever implements ContextRetriever {
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

  public getDealState(dealId: string): Promise<DealStateSnapshot> {
    return this.run(async (tx) => {
      const [row] = await tx
        .select({ snapshot: dealStates.snapshot })
        .from(dealStates)
        .where(
          and(
            eq(dealStates.organizationId, this.context.organizationId),
            eq(dealStates.dealId, dealId)
          )
        )
        .limit(1);
      return row?.snapshot ?? {};
    });
  }

  public getRecentEvents(dealId: string, limit: number): Promise<DecisionEvent[]> {
    return this.run(async (tx) =>
      (
        await tx
          .select()
          .from(commercialEvents)
          .where(
            and(
              eq(commercialEvents.organizationId, this.context.organizationId),
              eq(commercialEvents.dealId, dealId)
            )
          )
          .orderBy(desc(commercialEvents.occurredAt), desc(commercialEvents.id))
          .limit(limit)
      ).map(eventDto)
    );
  }

  public getRelevantMemory(
    dealId: string,
    contactId: string | null,
    limit: number
  ): Promise<MemoryFactContext[]> {
    return this.run(async (tx) => {
      const scope = contactId
        ? or(
            and(eq(memoryFacts.scopeType, 'DEAL_FACT'), eq(memoryFacts.scopeId, dealId)),
            and(eq(memoryFacts.scopeType, 'CONTACT_FACT'), eq(memoryFacts.scopeId, contactId))
          )
        : and(eq(memoryFacts.scopeType, 'DEAL_FACT'), eq(memoryFacts.scopeId, dealId));
      return (
        await tx
          .select()
          .from(memoryFacts)
          .where(
            and(
              eq(memoryFacts.organizationId, this.context.organizationId),
              eq(memoryFacts.status, 'ACTIVE'),
              scope
            )
          )
          .orderBy(desc(memoryFacts.confidence), desc(memoryFacts.updatedAt))
          .limit(limit)
      ).map(memoryDto);
    });
  }

  public getHistoricalMessages(
    dealId: string,
    limit: number
  ): Promise<Array<{ id: string; text: string; occurredAt: string }>> {
    return this.run(async (tx) =>
      (
        await tx
          .select({ id: messages.id, text: messages.text, occurredAt: messages.occurredAt })
          .from(messages)
          .innerJoin(
            conversations,
            and(
              eq(conversations.organizationId, messages.organizationId),
              eq(conversations.id, messages.conversationId)
            )
          )
          .where(
            and(
              eq(messages.organizationId, this.context.organizationId),
              eq(conversations.dealId, dealId),
              isNull(messages.deletedAt),
              sql`${messages.text} is not null`
            )
          )
          .orderBy(desc(messages.occurredAt))
          .limit(limit)
      ).flatMap((row) =>
        row.text ? [{ id: row.id, text: row.text, occurredAt: row.occurredAt.toISOString() }] : []
      )
    );
  }

  public getLastDecision(dealId: string): Promise<PreviousDecisionContext | null> {
    return this.run(async (tx) => {
      const [row] = await tx
        .select({ output: aiDecisions.output })
        .from(aiDecisions)
        .where(
          and(
            eq(aiDecisions.organizationId, this.context.organizationId),
            eq(aiDecisions.dealId, dealId)
          )
        )
        .orderBy(desc(aiDecisions.createdAt))
        .limit(1);
      return row
        ? {
            classification: row.output.eventClassification,
            strategy: row.output.strategy,
            confidence: row.output.confidence
          }
        : null;
    });
  }

  public getPlaybookSnippets(_dealId: string, limit: number): Promise<string[]> {
    return this.run(async (tx) =>
      (
        await tx
          .select({ guidance: interventionTemplates.guidance })
          .from(interventionTemplates)
          .where(
            and(
              or(
                isNull(interventionTemplates.organizationId),
                eq(interventionTemplates.organizationId, this.context.organizationId)
              ),
              eq(interventionTemplates.status, 'ACTIVE')
            )
          )
          .orderBy(desc(interventionTemplates.organizationId))
          .limit(limit)
      ).map((row) => row.guidance)
    );
  }
}

export class IntelligenceReadRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  public async getDealState(dealId: string) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [current] = await tx
        .select()
        .from(dealStates)
        .where(
          and(
            eq(dealStates.organizationId, this.context.organizationId),
            eq(dealStates.dealId, dealId)
          )
        )
        .limit(1);
      if (!current) return null;
      const revisions = await tx
        .select()
        .from(dealStateRevisions)
        .where(
          and(
            eq(dealStateRevisions.organizationId, this.context.organizationId),
            eq(dealStateRevisions.dealId, dealId)
          )
        )
        .orderBy(desc(dealStateRevisions.version))
        .limit(20);
      return { ...current, revisions };
    });
  }

  public async getDealMemory(dealId: string) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      return tx
        .select()
        .from(memoryFacts)
        .where(
          and(
            eq(memoryFacts.organizationId, this.context.organizationId),
            eq(memoryFacts.scopeType, 'DEAL_FACT'),
            eq(memoryFacts.scopeId, dealId)
          )
        )
        .orderBy(desc(memoryFacts.updatedAt));
    });
  }

  public async listDecisions(limit = 100) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      return tx
        .select({
          decision: aiDecisions,
          eventText: commercialEvents.text,
          intervention: interventionCandidates
        })
        .from(aiDecisions)
        .innerJoin(
          commercialEvents,
          and(
            eq(commercialEvents.organizationId, aiDecisions.organizationId),
            eq(commercialEvents.id, aiDecisions.commercialEventId)
          )
        )
        .leftJoin(
          interventionCandidates,
          and(
            eq(interventionCandidates.organizationId, aiDecisions.organizationId),
            eq(interventionCandidates.aiDecisionId, aiDecisions.id)
          )
        )
        .where(eq(aiDecisions.organizationId, this.context.organizationId))
        .orderBy(desc(aiDecisions.createdAt))
        .limit(Math.min(limit, 200));
    });
  }
}

export interface IntelligenceMetricSink {
  increment(name: string, attributes: Record<string, string>): void;
  timing(name: string, milliseconds: number, attributes: Record<string, string>): void;
}

export class InMemoryIntelligenceMetrics implements IntelligenceMetricSink {
  public readonly counters = new Map<string, number>();
  public readonly timings: Array<{
    name: string;
    milliseconds: number;
    attributes: Record<string, string>;
  }> = [];
  public increment(name: string, attributes: Record<string, string>): void {
    const key = `${name}:${JSON.stringify(attributes)}`;
    this.counters.set(key, (this.counters.get(key) ?? 0) + 1);
  }
  public timing(name: string, milliseconds: number, attributes: Record<string, string>): void {
    this.timings.push({ name, milliseconds, attributes });
  }
}

export interface IntelligenceProcessorConfig {
  intelligenceEnabled: boolean;
  decisionVersion: string;
  contextVersion: string;
  policyVersion: string;
  policy: PolicyConfig;
  liveGenerationEnabled?: boolean;
}

export interface ProcessIntelligenceResult {
  decisionId: string;
  deduplicated: boolean;
  policyResult: string;
  stateVersion: number | null;
  memoryFactsCreated: number;
  interventionOutcome: string;
}

function valueFingerprint(value: string): string {
  return createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

async function persistedResult(
  tx: DatabaseTransaction,
  organizationId: string,
  decision: typeof aiDecisions.$inferSelect
): Promise<Omit<ProcessIntelligenceResult, 'deduplicated'>> {
  const [state, candidate, memory] = await Promise.all([
    tx
      .select({ version: dealStates.version })
      .from(dealStates)
      .where(
        and(
          eq(dealStates.organizationId, organizationId),
          eq(dealStates.lastDecisionId, decision.id)
        )
      )
      .limit(1),
    tx
      .select({ outcome: interventionCandidates.outcome })
      .from(interventionCandidates)
      .where(
        and(
          eq(interventionCandidates.organizationId, organizationId),
          eq(interventionCandidates.aiDecisionId, decision.id)
        )
      )
      .limit(1),
    tx
      .select({ id: memoryFacts.id })
      .from(memoryFacts)
      .where(
        and(
          eq(memoryFacts.organizationId, organizationId),
          eq(memoryFacts.aiDecisionId, decision.id)
        )
      )
  ]);
  return {
    decisionId: decision.id,
    policyResult: decision.policyResult,
    stateVersion: state[0]?.version ?? null,
    memoryFactsCreated: memory.length,
    interventionOutcome: candidate[0]?.outcome ?? 'SUPPRESSED'
  };
}

export class IntelligenceProcessor {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext,
    private readonly provider: DecisionProvider,
    private readonly config: IntelligenceProcessorConfig,
    private readonly metrics: IntelligenceMetricSink = new InMemoryIntelligenceMetrics()
  ) {}

  private attributes() {
    return {
      organizationId: this.context.organizationId,
      provider: this.provider.metadata.provider,
      model: this.provider.metadata.model
    };
  }

  public async processEvent(eventId: string): Promise<ProcessIntelligenceResult> {
    if (!this.config.intelligenceEnabled) throw new Error('INTELLIGENCE_DISABLED');
    const processingKey = buildProcessingKey({
      eventId,
      decisionVersion: this.config.decisionVersion,
      contextVersion: this.config.contextVersion,
      policyVersion: this.config.policyVersion,
      ...this.provider.metadata
    });
    const existing = await this.findExisting(processingKey);
    if (existing) return { ...existing, deduplicated: true };
    const event = await this.loadEvent(eventId);
    const builder = new ContextBuilder(new PostgresContextRetriever(this.db, this.context));
    const contextStarted = performance.now();
    let decisionContext = await builder.build(event);
    this.metrics.timing(
      'intelligence.context_build_ms',
      performance.now() - contextStarted,
      this.attributes()
    );
    const decisionStarted = performance.now();
    let output: DecisionOutput;
    let retryCount = 0;
    try {
      output = parseDecisionOutput(
        await this.provider.decide({
          context: decisionContext,
          decisionVersion: this.config.decisionVersion,
          contextVersion: this.config.contextVersion
        })
      );
      if (output.historicalRetrievalNeeded) {
        retryCount = 1;
        decisionContext = await builder.build(event, { includeHistory: true });
        output = parseDecisionOutput(
          await this.provider.decide({
            context: decisionContext,
            decisionVersion: this.config.decisionVersion,
            contextVersion: this.config.contextVersion
          })
        );
      }
    } catch (error) {
      await this.recordFailure(event, retryCount, performance.now() - decisionStarted, error);
      this.metrics.increment('intelligence.decision_errors', this.attributes());
      throw error;
    }
    const decisionMs = performance.now() - decisionStarted;
    this.metrics.timing('intelligence.decision_ms', decisionMs, this.attributes());
    const policyStarted = performance.now();
    const policy = evaluatePolicy(output, this.config.policy);
    this.metrics.timing(
      'intelligence.policy_ms',
      performance.now() - policyStarted,
      this.attributes()
    );
    const inputSize = JSON.stringify(decisionContext).length;
    const outputSize = JSON.stringify(output).length;
    const result = await this.commit(event, processingKey, output, policy, {
      decisionMs,
      inputSize,
      outputSize,
      retryCount
    });
    this.metrics.increment('intelligence.events_processed', this.attributes());
    if (output.confidence < this.config.policy.thresholds.intervention)
      this.metrics.increment('intelligence.low_confidence', this.attributes());
    this.metrics.increment(
      `intelligence.intervention.${result.interventionOutcome.toLowerCase()}`,
      this.attributes()
    );
    return result;
  }

  private async loadEvent(eventId: string): Promise<DecisionEvent> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [row] = await tx
        .select()
        .from(commercialEvents)
        .where(
          and(
            eq(commercialEvents.organizationId, this.context.organizationId),
            eq(commercialEvents.id, eventId)
          )
        )
        .limit(1);
      if (!row?.dealId) throw errors.notFound();
      return eventDto(row);
    });
  }

  private async findExisting(
    processingKey: string
  ): Promise<Omit<ProcessIntelligenceResult, 'deduplicated'> | null> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [decision] = await tx
        .select()
        .from(aiDecisions)
        .where(
          and(
            eq(aiDecisions.organizationId, this.context.organizationId),
            eq(aiDecisions.processingKey, processingKey)
          )
        )
        .limit(1);
      if (!decision) return null;
      return persistedResult(tx, this.context.organizationId, decision);
    });
  }

  private async recordFailure(
    event: DecisionEvent,
    retryCount: number,
    latency: number,
    error: unknown
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx.insert(aiUsage).values({
        organizationId: this.context.organizationId,
        aiDecisionId: null,
        dealId: event.dealId,
        commercialEventId: event.id,
        liveCallSessionId: event.liveCallSessionId,
        liveTranscriptTurnId: event.liveTranscriptTurnId,
        provider: this.provider.metadata.provider,
        model: this.provider.metadata.model,
        success: false,
        retryCount,
        latencyMs: Math.round(latency),
        errorCode: error instanceof Error ? error.name.slice(0, 80) : 'UNKNOWN'
      });
    });
  }

  private async commit(
    event: DecisionEvent,
    processingKey: string,
    output: DecisionOutput,
    policy: ReturnType<typeof evaluatePolicy>,
    stats: { decisionMs: number; inputSize: number; outputSize: number; retryCount: number }
  ): Promise<ProcessIntelligenceResult> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${this.context.organizationId}), hashtext(${processingKey}))`
      );
      const [existing] = await tx
        .select()
        .from(aiDecisions)
        .where(
          and(
            eq(aiDecisions.organizationId, this.context.organizationId),
            eq(aiDecisions.processingKey, processingKey)
          )
        )
        .limit(1);
      if (existing) {
        const persisted = await persistedResult(tx, this.context.organizationId, existing);
        return { ...persisted, deduplicated: true };
      }
      const decisionId = randomUUID();
      await tx.insert(aiDecisions).values({
        id: decisionId,
        organizationId: this.context.organizationId,
        dealId: event.dealId,
        commercialEventId: event.id,
        processingKey,
        provider: this.provider.metadata.provider,
        model: this.provider.metadata.model,
        modelVersion: this.provider.metadata.modelVersion,
        configVersion: this.provider.metadata.configVersion,
        decisionVersion: this.config.decisionVersion,
        policyVersion: this.config.policyVersion,
        contextVersion: this.config.contextVersion,
        output,
        confidence: output.confidence,
        policyResult: policy.result,
        policyReason: policy.reason,
        shadowMode: this.config.policy.shadowMode,
        inputSize: stats.inputSize,
        outputSize: stats.outputSize,
        latencyMs: Math.round(stats.decisionMs),
        estimatedCostMicros: 0n
      });
      await tx.insert(aiUsage).values({
        organizationId: this.context.organizationId,
        aiDecisionId: decisionId,
        dealId: event.dealId,
        commercialEventId: event.id,
        liveCallSessionId: event.liveCallSessionId,
        liveTranscriptTurnId: event.liveTranscriptTurnId,
        provider: this.provider.metadata.provider,
        model: this.provider.metadata.model,
        success: true,
        retryCount: stats.retryCount,
        inputSize: stats.inputSize,
        outputSize: stats.outputSize,
        latencyMs: Math.round(stats.decisionMs),
        estimatedCostMicros: 0n
      });

      let stateVersion: number | null = null;
      const [latestStateEvent] = await tx
        .select({ occurredAt: commercialEvents.occurredAt })
        .from(dealStates)
        .innerJoin(
          commercialEvents,
          and(
            eq(commercialEvents.organizationId, dealStates.organizationId),
            eq(commercialEvents.id, dealStates.lastRelevantEventId)
          )
        )
        .where(
          and(
            eq(dealStates.organizationId, this.context.organizationId),
            eq(dealStates.dealId, event.dealId)
          )
        )
        .limit(1);
      const eventCanAdvanceState = canEventAdvanceState(
        latestStateEvent?.occurredAt ?? null,
        event.occurredAt
      );
      if (policy.persistStateUpdates.length > 0 && eventCanAdvanceState) {
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtext(${this.context.organizationId}), hashtext(${event.dealId}))`
        );
        const [current, deal] = await Promise.all([
          tx
            .select()
            .from(dealStates)
            .where(
              and(
                eq(dealStates.organizationId, this.context.organizationId),
                eq(dealStates.dealId, event.dealId)
              )
            )
            .limit(1),
          tx
            .select({ status: deals.status, stage: deals.providerStageLabel })
            .from(deals)
            .where(
              and(eq(deals.organizationId, this.context.organizationId), eq(deals.id, event.dealId))
            )
            .limit(1)
        ]);
        const now = new Date().toISOString();
        const base: DealStateSnapshot = current[0]?.snapshot ?? {
          canonicalStatus: {
            value: deal[0]?.status ?? 'OPEN',
            confidence: 1,
            sourceEventIds: [event.id],
            updatedAt: now
          },
          ...(deal[0]?.stage
            ? {
                stage: {
                  value: deal[0].stage,
                  confidence: 1,
                  sourceEventIds: [event.id],
                  updatedAt: now
                }
              }
            : {})
        };
        const snapshot = applyStateUpdates(base, policy.persistStateUpdates, now);
        stateVersion = (current[0]?.version ?? 0) + 1;
        await tx.insert(dealStateRevisions).values({
          organizationId: this.context.organizationId,
          dealId: event.dealId,
          version: stateVersion,
          snapshot,
          sourceEventId: event.id,
          aiDecisionId: decisionId
        });
        await tx
          .insert(dealStates)
          .values({
            organizationId: this.context.organizationId,
            dealId: event.dealId,
            version: stateVersion,
            snapshot,
            lastRelevantEventId: event.id,
            lastDecisionId: decisionId,
            lastUpdatedAt: new Date(now)
          })
          .onConflictDoUpdate({
            target: [dealStates.organizationId, dealStates.dealId],
            set: {
              version: stateVersion,
              snapshot,
              lastRelevantEventId: event.id,
              lastDecisionId: decisionId,
              lastUpdatedAt: new Date(now),
              updatedAt: new Date(now)
            }
          });
      }

      let memoryFactsCreated = 0;
      for (const update of policy.persistMemoryUpdates) {
        const fingerprint = valueFingerprint(update.value);
        const [active] = await tx
          .select()
          .from(memoryFacts)
          .where(
            and(
              eq(memoryFacts.organizationId, this.context.organizationId),
              eq(memoryFacts.scopeType, update.scopeType),
              eq(memoryFacts.scopeId, update.scopeId),
              eq(memoryFacts.factType, update.factType),
              eq(memoryFacts.status, 'ACTIVE')
            )
          )
          .orderBy(desc(memoryFacts.createdAt))
          .limit(1);
        if (active?.valueFingerprint === fingerprint) continue;
        const now = new Date();
        if (active)
          await tx
            .update(memoryFacts)
            .set({ status: 'SUPERSEDED', validTo: now, updatedAt: now })
            .where(eq(memoryFacts.id, active.id));
        await tx.insert(memoryFacts).values({
          organizationId: this.context.organizationId,
          scopeType: update.scopeType,
          scopeId: update.scopeId,
          factType: update.factType,
          value: update.value,
          valueFingerprint: fingerprint,
          confidence: update.confidence,
          sourceEventIds: update.sourceEventIds,
          aiDecisionId: decisionId,
          supersedesId: active?.id,
          validFrom: now
        });
        memoryFactsCreated += 1;
      }

      if (policy.persistStateUpdates.length > 0)
        this.metrics.increment('intelligence.state_updates', this.attributes());
      if (memoryFactsCreated > 0)
        this.metrics.increment('intelligence.memory_updates', this.attributes());

      const templates = (await tx
        .select()
        .from(interventionTemplates)
        .where(
          and(
            or(
              isNull(interventionTemplates.organizationId),
              eq(interventionTemplates.organizationId, this.context.organizationId)
            ),
            eq(interventionTemplates.status, 'ACTIVE'),
            eq(interventionTemplates.strategy, output.strategy)
          )
        )) as Array<typeof interventionTemplates.$inferSelect>;
      const mapped: InterventionTemplate[] = templates.map((template) => ({
        ...template,
        strategy: template.strategy as InterventionTemplate['strategy']
      }));
      const intervention = matchIntervention(
        mapped,
        this.context.organizationId,
        output,
        policy.prepareIntervention
      );
      const [candidate] = await tx
        .insert(interventionCandidates)
        .values({
          organizationId: this.context.organizationId,
          dealId: event.dealId,
          commercialEventId: event.id,
          aiDecisionId: decisionId,
          templateId: intervention.template?.id,
          outcome: intervention.outcome,
          title: intervention.template?.title,
          guidance: intervention.template?.guidance,
          question: intervention.question,
          source: intervention.source,
          confidence: output.confidence,
          policyResult: policy.result,
          shadowMode: this.config.policy.shadowMode
        })
        .returning({ id: interventionCandidates.id });
      if (!candidate) throw new Error('INTERVENTION_CANDIDATE_INSERT_FAILED');
      if (
        intervention.outcome === 'GENERATION_REQUIRED' &&
        (event.contentOrigin !== 'CALL_TRANSCRIPT' || this.config.liveGenerationEnabled === true)
      ) {
        const generationKey = [
          decisionId,
          output.strategy,
          this.config.contextVersion,
          this.config.policyVersion,
          'generation-v1'
        ].join(':');
        await tx
          .insert(generationJobs)
          .values({
            organizationId: this.context.organizationId,
            candidateId: candidate.id,
            generationKey,
            correlationId: event.id
          })
          .onConflictDoNothing();
      }
      return {
        decisionId,
        deduplicated: false,
        policyResult: policy.result,
        stateVersion,
        memoryFactsCreated,
        interventionOutcome: intervention.outcome
      };
    });
  }
}

export interface IntelligenceJobDispatcher {
  dispatch(eventId: string): Promise<ProcessIntelligenceResult>;
}

export class InlineIntelligenceJobDispatcher implements IntelligenceJobDispatcher {
  public constructor(private readonly processor: IntelligenceProcessor) {}
  public dispatch(eventId: string): Promise<ProcessIntelligenceResult> {
    return this.processor.processEvent(eventId);
  }
}

export async function resolveIntelligenceConfig(
  db: MorubiDatabase,
  context: TenantContext,
  defaults: Partial<IntelligenceProcessorConfig> = {}
): Promise<IntelligenceProcessorConfig> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx, context);
    const [settings] = await tx
      .select()
      .from(intelligenceSettings)
      .where(eq(intelligenceSettings.organizationId, context.organizationId))
      .limit(1);
    return {
      intelligenceEnabled: settings?.intelligenceEnabled ?? defaults.intelligenceEnabled ?? false,
      decisionVersion: settings?.decisionVersion ?? defaults.decisionVersion ?? 'decision-v1',
      contextVersion: settings?.contextVersion ?? defaults.contextVersion ?? 'context-v1',
      policyVersion: settings?.policyVersion ?? defaults.policyVersion ?? 'policy-v1',
      liveGenerationEnabled:
        settings?.liveGenerationEnabled ?? defaults.liveGenerationEnabled ?? false,
      policy: settings
        ? {
            shadowMode: settings.shadowMode,
            interventionsVisible: settings.interventionsVisible,
            thresholds: settings.thresholds
          }
        : (defaults.policy ?? defaultPolicyConfig)
    };
  });
}
