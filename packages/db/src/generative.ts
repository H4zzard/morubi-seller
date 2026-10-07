import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, isNull, lt, ne, or, sql } from 'drizzle-orm';
import {
  GENERATION_PROMPT_VERSION,
  GenerationEngine,
  GenerativeProviderError,
  GenerativeRouter,
  type GenerationInput,
  type GenerativeProvider,
  type ProviderPricing
} from '@morubi/ai';
import type { TenantContext } from '@morubi/domain';
import type { MorubiDatabase } from './database.js';
import {
  aiDecisions,
  aiUsage,
  commercialEvents,
  dealStates,
  deals,
  generationJobs,
  generativeExecutions,
  intelligenceSettings,
  interventionCandidates,
  interventionTemplates,
  memoryFacts,
  organizations
} from './schema.js';
import { setTenantContext } from './tenant.js';

type GenerationJob = typeof generationJobs.$inferSelect;

export interface GenerativeProcessorConfig {
  generativeAiEnabled: boolean;
  pricing: ProviderPricing;
  maxValidationRetries: number;
}

export interface GenerativeProcessResult {
  decisionId: string;
  executionId: string | null;
  eligibleForDelivery: boolean;
  deduplicated: boolean;
  reason: string;
}

export interface WorkerQueueSnapshot {
  organizationId: string;
  transcriptionPending: number;
  audioRetentionPending: number;
  transcriptRetentionPending: number;
  intelligencePending: number;
  generationPending: number;
}

export function workerTenantContext(organizationId: string): TenantContext {
  return {
    userId: 'morubi-dedicated-worker',
    organizationId,
    membershipId: '00000000-0000-4000-8000-000000000000',
    role: 'OWNER',
    permissions: []
  };
}

export async function listWorkerQueues(db: MorubiDatabase): Promise<WorkerQueueSnapshot[]> {
  const rows = await db
    .select({
      organizationId: organizations.id,
      transcriptionPending: sql<number>`(
        select count(*)::int from transcription_jobs j
        where j.organization_id = ${organizations.id}
          and (j.status in ('PENDING', 'RETRY') or (j.status = 'PROCESSING' and j.locked_at < now() - interval '5 minutes'))
          and j.available_at <= now()
      )`,
      audioRetentionPending: sql<number>`(
        select count(*)::int from audio_assets a
        where a.organization_id = ${organizations.id}
          and a.retention_until < now()
          and a.status in ('READY', 'TRANSCRIBED', 'FAILED')
      )`,
      transcriptRetentionPending: sql<number>`(
        select count(*)::int from audio_transcripts t
        left join intelligence_settings s on s.organization_id = t.organization_id
        where t.organization_id = ${organizations.id}
          and t.created_at < now() - make_interval(days => coalesce(s.transcript_retention_days, 90))
      )`,
      intelligencePending: sql<number>`(
        select count(*)::int from intelligence_jobs j
        where j.organization_id = ${organizations.id}
          and (j.status = 'PENDING' or (j.status = 'RUNNING' and j.locked_at < now() - interval '5 minutes'))
          and j.available_at <= now()
      )`,
      generationPending: sql<number>`(
        select count(*)::int from generation_jobs j
        where j.organization_id = ${organizations.id}
          and (j.status = 'PENDING' or (j.status = 'RUNNING' and j.locked_at < now() - interval '5 minutes'))
          and j.available_at <= now()
      )`
    })
    .from(organizations);
  return rows.filter(
    (row) =>
      row.audioRetentionPending > 0 ||
      row.transcriptRetentionPending > 0 ||
      row.transcriptionPending > 0 ||
      row.intelligencePending > 0 ||
      row.generationPending > 0
  );
}

export class GenerationJobRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  public async claimNext(): Promise<GenerationJob | null> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const staleLock = new Date(Date.now() - 5 * 60_000);
      const [job] = await tx
        .select()
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.organizationId, this.context.organizationId),
            or(
              eq(generationJobs.status, 'PENDING'),
              and(eq(generationJobs.status, 'RUNNING'), lt(generationJobs.lockedAt, staleLock))
            ),
            sql`${generationJobs.availableAt} <= now()`
          )
        )
        .orderBy(asc(generationJobs.availableAt), asc(generationJobs.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!job) return null;
      const [claimed] = await tx
        .update(generationJobs)
        .set({ status: 'RUNNING', lockedAt: new Date(), attempts: job.attempts + 1 })
        .where(eq(generationJobs.id, job.id))
        .returning();
      return claimed ?? null;
    });
  }

  public async complete(jobId: string): Promise<void> {
    await this.finish(jobId, {
      status: 'COMPLETED',
      finishedAt: new Date(),
      lockedAt: null,
      errorCode: null
    });
  }

  public async fail(job: GenerationJob, error: unknown): Promise<void> {
    const terminal = job.attempts >= job.maxAttempts;
    await this.finish(job.id, {
      status: terminal ? 'FAILED' : 'PENDING',
      availableAt: new Date(Date.now() + Math.min(30_000, 1_000 * 2 ** job.attempts)),
      finishedAt: terminal ? new Date() : null,
      lockedAt: null,
      errorCode: error instanceof Error ? error.message.slice(0, 80) : 'UNKNOWN'
    });
    if (terminal) {
      await this.db.transaction(async (tx) => {
        await setTenantContext(tx, this.context);
        await tx
          .update(interventionCandidates)
          .set({ outcome: 'SUPPRESSED', source: 'GENERATION_FAILED' })
          .where(
            and(
              eq(interventionCandidates.organizationId, this.context.organizationId),
              eq(interventionCandidates.id, job.candidateId),
              eq(interventionCandidates.outcome, 'GENERATION_REQUIRED')
            )
          );
      });
    }
  }

  private async finish(
    jobId: string,
    values: Partial<typeof generationJobs.$inferInsert>
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx
        .update(generationJobs)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(generationJobs.organizationId, this.context.organizationId),
            eq(generationJobs.id, jobId)
          )
        );
    });
  }
}

export class GenerativeProcessor {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext,
    private readonly provider: GenerativeProvider,
    private readonly config: GenerativeProcessorConfig,
    private readonly router = new GenerativeRouter()
  ) {}

  public async process(job: GenerationJob): Promise<GenerativeProcessResult> {
    const loaded = await this.load(job);
    if (!loaded) {
      return {
        decisionId: 'missing',
        executionId: null,
        eligibleForDelivery: false,
        deduplicated: false,
        reason: 'CANDIDATE_NOT_FOUND'
      };
    }
    const existing = await this.findExecution(job.generationKey);
    if (existing?.status === 'COMPLETED') {
      return {
        decisionId: loaded.decision.id,
        executionId: existing.id,
        eligibleForDelivery: true,
        deduplicated: true,
        reason: 'ALREADY_GENERATED'
      };
    }
    const enabled = loaded.settings?.generativeAiEnabled ?? this.config.generativeAiEnabled;
    if (!this.config.generativeAiEnabled || !enabled) {
      await this.suppressCandidate(loaded.candidate.id, 'GENERATION_DISABLED');
      return {
        decisionId: loaded.decision.id,
        executionId: null,
        eligibleForDelivery: false,
        deduplicated: false,
        reason: 'GENERATION_DISABLED'
      };
    }
    if (
      loaded.event.contentOrigin === 'CALL_TRANSCRIPT' &&
      loaded.settings?.liveGenerationEnabled !== true
    ) {
      await this.suppressCandidate(loaded.candidate.id, 'LIVE_GENERATION_DISABLED');
      return {
        decisionId: loaded.decision.id,
        executionId: null,
        eligibleForDelivery: false,
        deduplicated: false,
        reason: 'LIVE_GENERATION_DISABLED'
      };
    }
    if (loaded.candidate.shadowMode && loaded.settings?.generateInShadow === false) {
      await this.suppressCandidate(loaded.candidate.id, 'GENERATION_DISABLED_IN_SHADOW');
      return {
        decisionId: loaded.decision.id,
        executionId: null,
        eligibleForDelivery: false,
        deduplicated: false,
        reason: 'GENERATION_DISABLED_IN_SHADOW'
      };
    }
    const budgetReason = await this.budgetReason(loaded.settings, loaded.ownerMembershipId);
    if (budgetReason) {
      await this.suppressCandidate(loaded.candidate.id, budgetReason);
      return {
        decisionId: loaded.decision.id,
        executionId: null,
        eligibleForDelivery: false,
        deduplicated: false,
        reason: budgetReason
      };
    }

    const baseInput = this.buildInput(loaded);
    const input: GenerationInput = {
      ...baseInput,
      profile: this.router.route(baseInput)
    };
    const executionId = existing?.id ?? randomUUID();
    await this.startExecution(executionId, job, loaded, input);
    const engine = new GenerationEngine(this.provider);
    try {
      const result = await engine.run(input, {
        maxValidationRetries: this.config.maxValidationRetries,
        pricing: this.config.pricing,
        isStale: () =>
          this.isStale(
            loaded.candidate.id,
            loaded.decision.id,
            loaded.decision.createdAt,
            loaded.event
          )
      });
      const maximumCost = loaded.settings?.maxCostPerInterventionMicros ?? 0n;
      const overCost = maximumCost > 0n && result.estimatedCostMicros > maximumCost;
      const eligible = result.validation.result === 'VALID' && !overCost;
      const reason = overCost
        ? 'MAX_INTERVENTION_COST_EXCEEDED'
        : result.validation.result === 'VALID'
          ? 'GENERATED'
          : `VALIDATION_${result.validation.result}`;
      await this.commitExecution(executionId, loaded, result, eligible, reason);
      return {
        decisionId: loaded.decision.id,
        executionId,
        eligibleForDelivery: eligible,
        deduplicated: false,
        reason
      };
    } catch (error) {
      const stale =
        error instanceof GenerativeProviderError && error.message === 'GENERATION_STALE';
      await this.recordFailure(executionId, loaded, job, error, stale);
      if (stale) {
        return {
          decisionId: loaded.decision.id,
          executionId,
          eligibleForDelivery: false,
          deduplicated: false,
          reason: 'GENERATION_STALE'
        };
      }
      throw error;
    }
  }

  public async markDelivery(executionId: string, delivered: boolean): Promise<void> {
    if (!delivered) return;
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [execution] = await tx
        .select({ completedAt: generativeExecutions.generationCompletedAt })
        .from(generativeExecutions)
        .where(
          and(
            eq(generativeExecutions.organizationId, this.context.organizationId),
            eq(generativeExecutions.id, executionId)
          )
        )
        .limit(1);
      const now = new Date();
      await tx
        .update(generativeExecutions)
        .set({
          deliveryCreatedAt: now,
          generationToDeliveryMs: execution?.completedAt
            ? Math.max(0, now.getTime() - execution.completedAt.getTime())
            : null,
          updatedAt: now
        })
        .where(eq(generativeExecutions.id, executionId));
    });
  }

  private async load(job: GenerationJob) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [row] = await tx
        .select({
          candidate: interventionCandidates,
          decision: aiDecisions,
          event: commercialEvents,
          ownerMembershipId: deals.ownerMembershipId,
          state: dealStates.snapshot,
          settings: intelligenceSettings
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
          dealStates,
          and(
            eq(dealStates.organizationId, interventionCandidates.organizationId),
            eq(dealStates.dealId, interventionCandidates.dealId)
          )
        )
        .leftJoin(
          intelligenceSettings,
          eq(intelligenceSettings.organizationId, interventionCandidates.organizationId)
        )
        .where(
          and(
            eq(interventionCandidates.organizationId, this.context.organizationId),
            eq(interventionCandidates.id, job.candidateId)
          )
        )
        .limit(1);
      if (!row) return null;
      const [memory, recent, playbook] = await Promise.all([
        tx
          .select({ factType: memoryFacts.factType, value: memoryFacts.value })
          .from(memoryFacts)
          .where(
            and(
              eq(memoryFacts.organizationId, this.context.organizationId),
              eq(memoryFacts.scopeType, 'DEAL_FACT'),
              eq(memoryFacts.scopeId, row.candidate.dealId),
              eq(memoryFacts.status, 'ACTIVE')
            )
          )
          .orderBy(desc(memoryFacts.updatedAt))
          .limit(8),
        tx
          .select({
            actorType: commercialEvents.actorType,
            text: commercialEvents.text,
            occurredAt: commercialEvents.occurredAt
          })
          .from(commercialEvents)
          .where(
            and(
              eq(commercialEvents.organizationId, this.context.organizationId),
              eq(commercialEvents.dealId, row.candidate.dealId),
              ne(commercialEvents.id, row.event.id),
              sql`${commercialEvents.text} is not null`
            )
          )
          .orderBy(desc(commercialEvents.occurredAt))
          .limit(6),
        tx
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
          .limit(6)
      ]);
      return {
        ...row,
        memory,
        recent: recent.flatMap((item) =>
          item.text
            ? [
                {
                  actorType: item.actorType,
                  text: item.text,
                  occurredAt: item.occurredAt.toISOString()
                }
              ]
            : []
        ),
        playbook: playbook.map((item) => item.guidance)
      };
    });
  }

  private buildInput(loaded: NonNullable<Awaited<ReturnType<GenerativeProcessor['load']>>>) {
    const decision = loaded.decision.output;
    const interventionType =
      decision.objection ?? decision.risk ?? decision.buyingSignal ?? decision.eventClassification;
    return {
      generationType: 'INTERVENTION_GUIDANCE' as const,
      strategy: decision.strategy,
      interventionType,
      currentEvent: {
        text: loaded.event.text ?? '',
        occurredAt: loaded.event.occurredAt.toISOString()
      },
      dealState: loaded.state ?? {},
      relevantMemory: loaded.memory,
      hotContext: loaded.recent,
      companyRules: loaded.settings?.companyRules ?? [
        'Não oferecer desconto sem aprovação.',
        'Não inventar preço, prazo, feature ou condição comercial.'
      ],
      playbookSnippets: loaded.playbook,
      constraints: {
        maxInputCharacters: loaded.settings?.maxGenerationInputCharacters ?? 6_000,
        maxOutputCharacters: loaded.settings?.maxGenerationOutputCharacters ?? 700,
        questionRequired: true
      }
    };
  }

  private async findExecution(generationKey: string) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [row] = await tx
        .select()
        .from(generativeExecutions)
        .where(
          and(
            eq(generativeExecutions.organizationId, this.context.organizationId),
            eq(generativeExecutions.generationKey, generationKey)
          )
        )
        .limit(1);
      return row ?? null;
    });
  }

  private async startExecution(
    executionId: string,
    job: GenerationJob,
    loaded: NonNullable<Awaited<ReturnType<GenerativeProcessor['load']>>>,
    input: GenerationInput
  ): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx
        .insert(generativeExecutions)
        .values({
          id: executionId,
          organizationId: this.context.organizationId,
          generationJobId: job.id,
          candidateId: loaded.candidate.id,
          aiDecisionId: loaded.decision.id,
          dealId: loaded.candidate.dealId,
          commercialEventId: loaded.event.id,
          sellerMembershipId: loaded.ownerMembershipId,
          conversationId: loaded.event.conversationId,
          generationKey: job.generationKey,
          provider: this.provider.metadata.provider,
          model: 'pending',
          profile: input.profile,
          status: 'RUNNING',
          configVersion: this.provider.metadata.configVersion,
          promptVersion: GENERATION_PROMPT_VERSION,
          contextVersion: loaded.decision.contextVersion,
          policyVersion: loaded.decision.policyVersion,
          inputSummary: {
            strategy: input.strategy,
            interventionType: input.interventionType,
            eventCharacters: input.currentEvent.text.length,
            hotContextItems: input.hotContext.length,
            memoryItems: input.relevantMemory.length,
            playbookItems: input.playbookSnippets.length
          },
          attemptCount: job.attempts,
          generationStartedAt: now
        })
        .onConflictDoUpdate({
          target: [generativeExecutions.organizationId, generativeExecutions.generationKey],
          set: {
            status: 'RUNNING',
            attemptCount: job.attempts,
            generationStartedAt: now,
            errorCode: null,
            updatedAt: now
          }
        });
    });
  }

  private async commitExecution(
    executionId: string,
    loaded: NonNullable<Awaited<ReturnType<GenerativeProcessor['load']>>>,
    result: Awaited<ReturnType<GenerationEngine['run']>>,
    eligible: boolean,
    reason: string
  ): Promise<void> {
    const now = new Date();
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${this.context.organizationId}), hashtext(${loaded.candidate.id}))`
      );
      await tx
        .update(generativeExecutions)
        .set({
          provider: result.provider,
          model: result.model,
          profile: result.profile,
          status: eligible
            ? 'COMPLETED'
            : result.validation.result === 'INVALID'
              ? 'VALIDATION_FAILED'
              : 'SUPPRESSED',
          output: result.output,
          validationResult: result.validation.result,
          validationErrors: result.validation.errors,
          attemptCount: result.attempts,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          estimatedCostMicros: result.estimatedCostMicros,
          generationCompletedAt: now,
          validationCompletedAt: now,
          generationLatencyMs: result.generationLatencyMs,
          errorCode: eligible ? null : reason,
          updatedAt: now
        })
        .where(
          and(
            eq(generativeExecutions.organizationId, this.context.organizationId),
            eq(generativeExecutions.id, executionId)
          )
        );
      if (eligible && result.output) {
        await tx
          .update(interventionCandidates)
          .set({
            outcome: 'MATCHED',
            title: result.output.title,
            guidance: result.output.guidance,
            question: result.output.suggestedQuestion,
            source: 'GENERATED'
          })
          .where(
            and(
              eq(interventionCandidates.organizationId, this.context.organizationId),
              eq(interventionCandidates.id, loaded.candidate.id),
              eq(interventionCandidates.outcome, 'GENERATION_REQUIRED')
            )
          );
      } else {
        await tx
          .update(interventionCandidates)
          .set({ outcome: 'SUPPRESSED', source: reason })
          .where(
            and(
              eq(interventionCandidates.organizationId, this.context.organizationId),
              eq(interventionCandidates.id, loaded.candidate.id)
            )
          );
      }
      await tx
        .insert(aiUsage)
        .values({
          organizationId: this.context.organizationId,
          generativeExecutionId: executionId,
          dealId: loaded.candidate.dealId,
          commercialEventId: loaded.event.id,
          liveCallSessionId: loaded.event.liveCallSessionId,
          liveTranscriptTurnId: loaded.event.liveTranscriptTurnId,
          sellerMembershipId: loaded.ownerMembershipId,
          conversationId: loaded.event.conversationId,
          interventionCandidateId: loaded.candidate.id,
          provider: result.provider,
          model: result.model,
          profile: result.profile,
          purpose: 'GENERATION',
          success: eligible,
          retryCount: Math.max(0, result.attempts - 1),
          inputSize: JSON.stringify(loaded.decision.output).length,
          outputSize: result.output ? JSON.stringify(result.output).length : 0,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          latencyMs: result.generationLatencyMs,
          estimatedCostMicros: result.estimatedCostMicros,
          errorCode: eligible ? null : reason
        })
        .onConflictDoUpdate({
          target: [aiUsage.organizationId, aiUsage.generativeExecutionId],
          set: {
            success: eligible,
            retryCount: Math.max(0, result.attempts - 1),
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            latencyMs: result.generationLatencyMs,
            estimatedCostMicros: result.estimatedCostMicros,
            errorCode: eligible ? null : reason
          }
        });
    });
  }

  private async recordFailure(
    executionId: string,
    loaded: NonNullable<Awaited<ReturnType<GenerativeProcessor['load']>>>,
    job: GenerationJob,
    error: unknown,
    stale: boolean
  ): Promise<void> {
    const code = error instanceof Error ? error.message.slice(0, 80) : 'UNKNOWN';
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx
        .update(generativeExecutions)
        .set({
          status: stale ? 'STALE' : 'PROVIDER_FAILED',
          errorCode: code,
          generationCompletedAt: new Date(),
          attemptCount: job.attempts,
          updatedAt: new Date()
        })
        .where(eq(generativeExecutions.id, executionId));
      if (stale) {
        await tx
          .update(interventionCandidates)
          .set({ outcome: 'SUPPRESSED', source: 'GENERATION_STALE' })
          .where(eq(interventionCandidates.id, loaded.candidate.id));
      }
      await tx
        .insert(aiUsage)
        .values({
          organizationId: this.context.organizationId,
          generativeExecutionId: executionId,
          dealId: loaded.candidate.dealId,
          commercialEventId: loaded.event.id,
          liveCallSessionId: loaded.event.liveCallSessionId,
          liveTranscriptTurnId: loaded.event.liveTranscriptTurnId,
          sellerMembershipId: loaded.ownerMembershipId,
          conversationId: loaded.event.conversationId,
          interventionCandidateId: loaded.candidate.id,
          provider: this.provider.metadata.provider,
          model: 'unknown',
          profile: null,
          purpose: 'GENERATION',
          success: false,
          retryCount: Math.max(0, job.attempts - 1),
          errorCode: code
        })
        .onConflictDoUpdate({
          target: [aiUsage.organizationId, aiUsage.generativeExecutionId],
          set: {
            success: false,
            retryCount: Math.max(0, job.attempts - 1),
            errorCode: code
          }
        });
    });
  }

  private async isStale(
    candidateId: string,
    decisionId: string,
    decisionCreatedAt: Date,
    event: typeof commercialEvents.$inferSelect
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [candidate, newerDecision, newerEvent] = await Promise.all([
        tx
          .select({ outcome: interventionCandidates.outcome })
          .from(interventionCandidates)
          .where(
            and(
              eq(interventionCandidates.organizationId, this.context.organizationId),
              eq(interventionCandidates.id, candidateId)
            )
          )
          .limit(1),
        tx
          .select({ id: aiDecisions.id })
          .from(aiDecisions)
          .where(
            and(
              eq(aiDecisions.organizationId, this.context.organizationId),
              eq(aiDecisions.dealId, event.dealId!),
              ne(aiDecisions.id, decisionId),
              gt(aiDecisions.createdAt, decisionCreatedAt)
            )
          )
          .limit(1),
        event.conversationId
          ? tx
              .select({ id: commercialEvents.id })
              .from(commercialEvents)
              .where(
                and(
                  eq(commercialEvents.organizationId, this.context.organizationId),
                  eq(commercialEvents.conversationId, event.conversationId),
                  gt(commercialEvents.occurredAt, event.occurredAt)
                )
              )
              .limit(1)
          : Promise.resolve([])
      ]);
      return (
        candidate[0]?.outcome !== 'GENERATION_REQUIRED' ||
        Boolean(newerDecision[0] || newerEvent[0])
      );
    });
  }

  private async budgetReason(
    settings: typeof intelligenceSettings.$inferSelect | null,
    sellerMembershipId: string | null
  ): Promise<string | null> {
    const organizationLimit = settings?.organizationGenerationBudgetMicros ?? 0n;
    const sellerLimit = settings?.sellerGenerationBudgetMicros ?? 0n;
    if (organizationLimit === 0n && sellerLimit === 0n) return null;
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [organizationUsage, sellerUsage] = await Promise.all([
        tx
          .select({ total: sql<bigint>`coalesce(sum(${aiUsage.estimatedCostMicros}), 0)::bigint` })
          .from(aiUsage)
          .where(
            and(
              eq(aiUsage.organizationId, this.context.organizationId),
              eq(aiUsage.purpose, 'GENERATION')
            )
          ),
        sellerMembershipId
          ? tx
              .select({
                total: sql<bigint>`coalesce(sum(${aiUsage.estimatedCostMicros}), 0)::bigint`
              })
              .from(aiUsage)
              .where(
                and(
                  eq(aiUsage.organizationId, this.context.organizationId),
                  eq(aiUsage.sellerMembershipId, sellerMembershipId),
                  eq(aiUsage.purpose, 'GENERATION')
                )
              )
          : Promise.resolve([{ total: 0n }])
      ]);
      const organizationTotal = BigInt(organizationUsage[0]?.total ?? 0);
      const sellerTotal = BigInt(sellerUsage[0]?.total ?? 0);
      if (organizationLimit > 0n && organizationTotal >= organizationLimit)
        return 'ORGANIZATION_GENERATION_BUDGET_EXCEEDED';
      if (sellerLimit > 0n && sellerTotal >= sellerLimit)
        return 'SELLER_GENERATION_BUDGET_EXCEEDED';
      return null;
    });
  }

  private async suppressCandidate(candidateId: string, source: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx
        .update(interventionCandidates)
        .set({ outcome: 'SUPPRESSED', source })
        .where(
          and(
            eq(interventionCandidates.organizationId, this.context.organizationId),
            eq(interventionCandidates.id, candidateId)
          )
        );
    });
  }
}

export class GenerativeReadRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  public async listExecutions(limit = 100) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const rows = await tx
        .select()
        .from(generativeExecutions)
        .where(eq(generativeExecutions.organizationId, this.context.organizationId))
        .orderBy(desc(generativeExecutions.createdAt))
        .limit(Math.min(200, Math.max(1, limit)));
      return rows.map((row) => ({
        ...row,
        estimatedCostMicros: row.estimatedCostMicros.toString(),
        generationStartedAt: row.generationStartedAt.toISOString(),
        generationCompletedAt: row.generationCompletedAt?.toISOString() ?? null,
        validationCompletedAt: row.validationCompletedAt?.toISOString() ?? null,
        deliveryCreatedAt: row.deliveryCreatedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString()
      }));
    });
  }
}
