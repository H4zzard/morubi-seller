import { and, asc, desc, eq, lt, or, sql } from 'drizzle-orm';
import type { CallReportDto, CallTranscriptDto } from '@morubi/contracts';
import type { GenerativeProvider, ProviderPricing } from '@morubi/ai';
import type { TenantContext } from '@morubi/domain';
import { errors } from '@morubi/domain';
import {
  POST_CALL_PROCESSING_VERSION,
  POST_CALL_PROMPT_VERSION,
  buildSafeProposals,
  reconcilePostCallReport,
  segmentTranscript,
  type PostCallReportContent,
  type PostCallTurn
} from '@morubi/post-call';
import type { MorubiDatabase } from './database.js';
import {
  aiUsage,
  callReportRevisions,
  callReports,
  dealStates,
  liveCallSessions,
  liveTranscriptTurns,
  memoryFacts,
  postCallJobs,
  realtimeEvents
} from './schema.js';
import { setTenantContext } from './tenant.js';

type DatabaseTransaction = Parameters<Parameters<MorubiDatabase['transaction']>[0]>[0];
export type PostCallJob = typeof postCallJobs.$inferSelect;

function safeErrorCode(error: unknown): string {
  return (error instanceof Error ? error.message : 'UNKNOWN').slice(0, 80);
}

function countEvidence(content: PostCallReportContent): number {
  const matches = JSON.stringify(content).match(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi);
  return new Set(matches ?? []).size;
}

function canReadSession(context: TenantContext, sellerMembershipId: string): boolean {
  return context.role !== 'SELLER' || context.membershipId === sellerMembershipId;
}

function reportDto(
  report: typeof callReports.$inferSelect,
  revision: typeof callReportRevisions.$inferSelect | null
): CallReportDto {
  return {
    id: report.id,
    liveCallSessionId: report.liveCallSessionId,
    status: report.status,
    processingVersion: report.processingVersion,
    failureCode: report.failureCode,
    currentRevision: revision
      ? {
          id: revision.id,
          version: revision.version,
          status: revision.status,
          processingVersion: revision.processingVersion,
          provider: revision.provider,
          model: revision.model,
          content: revision.content,
          proposals: revision.proposals,
          inputTokens: revision.inputTokens,
          outputTokens: revision.outputTokens,
          estimatedCostMicros: revision.estimatedCostMicros.toString(),
          generatedAt: revision.generatedAt.toISOString()
        }
      : null,
    createdAt: report.createdAt.toISOString(),
    updatedAt: report.updatedAt.toISOString()
  };
}

export async function enqueuePostCallInTransaction(
  tx: DatabaseTransaction,
  input: {
    organizationId: string;
    sessionId: string;
    sellerMembershipId: string;
    dealId: string | null;
    conversationId: string | null;
    correlationId: string;
  }
): Promise<void> {
  const now = new Date();
  await tx
    .insert(callReports)
    .values({
      organizationId: input.organizationId,
      liveCallSessionId: input.sessionId,
      status: 'PROCESSING',
      processingVersion: POST_CALL_PROCESSING_VERSION
    })
    .onConflictDoUpdate({
      target: [callReports.organizationId, callReports.liveCallSessionId],
      set: {
        status: 'PROCESSING',
        processingVersion: POST_CALL_PROCESSING_VERSION,
        failureCode: null,
        updatedAt: now
      }
    });
  await tx
    .insert(postCallJobs)
    .values({
      organizationId: input.organizationId,
      liveCallSessionId: input.sessionId,
      processingVersion: POST_CALL_PROCESSING_VERSION,
      correlationId: input.correlationId,
      priority: 10
    })
    .onConflictDoNothing();
  await tx.insert(realtimeEvents).values({
    organizationId: input.organizationId,
    sellerMembershipId: input.sellerMembershipId,
    type: 'call_report.processing',
    correlationId: input.correlationId,
    conversationId: input.conversationId,
    dealId: input.dealId,
    liveCallSessionId: input.sessionId,
    payload: { liveCallSessionId: input.sessionId, status: 'PROCESSING' },
    expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000)
  });
}

export class PostCallJobRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  public async claimNext(): Promise<PostCallJob | null> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const staleLock = new Date(Date.now() - 10 * 60_000);
      const [job] = await tx
        .select()
        .from(postCallJobs)
        .where(
          and(
            eq(postCallJobs.organizationId, this.context.organizationId),
            or(
              eq(postCallJobs.status, 'PENDING'),
              eq(postCallJobs.status, 'RETRY'),
              and(eq(postCallJobs.status, 'PROCESSING'), lt(postCallJobs.lockedAt, staleLock))
            ),
            sql`${postCallJobs.availableAt} <= now()`
          )
        )
        .orderBy(
          desc(postCallJobs.priority),
          asc(postCallJobs.availableAt),
          asc(postCallJobs.createdAt)
        )
        .limit(1)
        .for('update', { skipLocked: true });
      if (!job) return null;
      const [claimed] = await tx
        .update(postCallJobs)
        .set({
          status: 'PROCESSING',
          lockedAt: new Date(),
          attempts: job.attempts + 1,
          updatedAt: new Date()
        })
        .where(eq(postCallJobs.id, job.id))
        .returning();
      return claimed ?? null;
    });
  }

  public async complete(jobId: string): Promise<void> {
    await this.finish(jobId, {
      status: 'COMPLETED',
      lockedAt: null,
      finishedAt: new Date(),
      errorCode: null
    });
  }

  public async fail(job: PostCallJob, error: unknown): Promise<void> {
    const terminal = job.attempts >= job.maxAttempts;
    const errorCode = safeErrorCode(error);
    await this.finish(job.id, {
      status: terminal ? 'FAILED' : 'RETRY',
      availableAt: new Date(Date.now() + Math.min(120_000, 2_000 * 2 ** job.attempts)),
      lockedAt: null,
      finishedAt: terminal ? new Date() : null,
      errorCode
    });
    if (terminal) {
      await this.db.transaction(async (tx) => {
        await setTenantContext(tx, this.context);
        const [session] = await tx
          .select()
          .from(liveCallSessions)
          .where(
            and(
              eq(liveCallSessions.organizationId, this.context.organizationId),
              eq(liveCallSessions.id, job.liveCallSessionId)
            )
          )
          .limit(1);
        if (!session) return;
        await tx
          .update(callReports)
          .set({ status: 'FAILED', failureCode: errorCode, updatedAt: new Date() })
          .where(
            and(
              eq(callReports.organizationId, this.context.organizationId),
              eq(callReports.liveCallSessionId, job.liveCallSessionId)
            )
          );
        await tx.insert(realtimeEvents).values({
          organizationId: this.context.organizationId,
          sellerMembershipId: session.sellerMembershipId,
          type: 'call_report.failed',
          correlationId: job.correlationId,
          conversationId: session.conversationId,
          dealId: session.dealId,
          liveCallSessionId: session.id,
          payload: { liveCallSessionId: session.id, status: 'FAILED', retryable: false },
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000)
        });
      });
    }
  }

  private async finish(
    jobId: string,
    values: Partial<typeof postCallJobs.$inferInsert>
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx
        .update(postCallJobs)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(postCallJobs.organizationId, this.context.organizationId),
            eq(postCallJobs.id, jobId)
          )
        );
    });
  }
}

export class PostCallReadRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  private async session(sessionId: string) {
    const [session] = await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      return tx
        .select()
        .from(liveCallSessions)
        .where(
          and(
            eq(liveCallSessions.organizationId, this.context.organizationId),
            eq(liveCallSessions.id, sessionId)
          )
        )
        .limit(1);
    });
    return session && canReadSession(this.context, session.sellerMembershipId) ? session : null;
  }

  public async getReport(sessionId: string): Promise<CallReportDto | null> {
    const session = await this.session(sessionId);
    if (!session) return null;
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [report] = await tx
        .select()
        .from(callReports)
        .where(
          and(
            eq(callReports.organizationId, this.context.organizationId),
            eq(callReports.liveCallSessionId, sessionId)
          )
        )
        .limit(1);
      if (!report) return null;
      const [revision] = await tx
        .select()
        .from(callReportRevisions)
        .where(
          and(
            eq(callReportRevisions.organizationId, this.context.organizationId),
            eq(callReportRevisions.callReportId, report.id),
            eq(callReportRevisions.status, 'CURRENT')
          )
        )
        .limit(1);
      return reportDto(report, revision ?? null);
    });
  }

  public async list(limit = 50): Promise<CallReportDto[]> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const rows = await tx
        .select({ report: callReports, session: liveCallSessions })
        .from(callReports)
        .innerJoin(
          liveCallSessions,
          and(
            eq(liveCallSessions.organizationId, callReports.organizationId),
            eq(liveCallSessions.id, callReports.liveCallSessionId)
          )
        )
        .where(
          this.context.role === 'SELLER'
            ? and(
                eq(callReports.organizationId, this.context.organizationId),
                eq(liveCallSessions.sellerMembershipId, this.context.membershipId)
              )
            : eq(callReports.organizationId, this.context.organizationId)
        )
        .orderBy(desc(callReports.createdAt))
        .limit(Math.min(Math.max(limit, 1), 100));
      const result: CallReportDto[] = [];
      for (const row of rows) {
        const [revision] = await tx
          .select()
          .from(callReportRevisions)
          .where(
            and(
              eq(callReportRevisions.organizationId, this.context.organizationId),
              eq(callReportRevisions.callReportId, row.report.id),
              eq(callReportRevisions.status, 'CURRENT')
            )
          )
          .limit(1);
        result.push(reportDto(row.report, revision ?? null));
      }
      return result;
    });
  }

  public async transcript(sessionId: string): Promise<CallTranscriptDto | null> {
    const session = await this.session(sessionId);
    if (!session) return null;
    const turns = await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      return tx
        .select()
        .from(liveTranscriptTurns)
        .where(
          and(
            eq(liveTranscriptTurns.organizationId, this.context.organizationId),
            eq(liveTranscriptTurns.liveCallSessionId, sessionId),
            eq(liveTranscriptTurns.isFinal, true)
          )
        )
        .orderBy(asc(liveTranscriptTurns.sequence));
    });
    return {
      liveCallSessionId: sessionId,
      turns: turns.map((turn) => ({
        id: turn.id,
        sequence: turn.sequence,
        speakerRole: turn.speakerRole,
        text: turn.text,
        startedAt: turn.startedAt.toISOString(),
        endedAt: turn.endedAt?.toISOString() ?? null
      }))
    };
  }

  public async retry(sessionId: string, correlationId: string): Promise<CallReportDto> {
    const session = await this.session(sessionId);
    if (!session || session.status !== 'ENDED') throw errors.notFound();
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [job] = await tx
        .select()
        .from(postCallJobs)
        .where(
          and(
            eq(postCallJobs.organizationId, this.context.organizationId),
            eq(postCallJobs.liveCallSessionId, sessionId),
            eq(postCallJobs.processingVersion, POST_CALL_PROCESSING_VERSION)
          )
        )
        .limit(1)
        .for('update');
      if (!job) {
        await enqueuePostCallInTransaction(tx, {
          organizationId: this.context.organizationId,
          sessionId,
          sellerMembershipId: session.sellerMembershipId,
          dealId: session.dealId,
          conversationId: session.conversationId,
          correlationId
        });
        return;
      }
      if (job.status === 'PENDING' || job.status === 'PROCESSING' || job.status === 'RETRY') return;
      await tx
        .update(postCallJobs)
        .set({
          status: 'RETRY',
          attempts: 0,
          availableAt: new Date(),
          lockedAt: null,
          finishedAt: null,
          errorCode: null,
          correlationId,
          updatedAt: new Date()
        })
        .where(eq(postCallJobs.id, job.id));
      await tx
        .update(callReports)
        .set({ status: 'PROCESSING', failureCode: null, updatedAt: new Date() })
        .where(
          and(
            eq(callReports.organizationId, this.context.organizationId),
            eq(callReports.liveCallSessionId, sessionId)
          )
        );
    });
    return (await this.getReport(sessionId))!;
  }
}

export interface PostCallProcessorConfig {
  enabled: boolean;
  maxSegmentCharacters: number;
  maxOutputCharacters: number;
  pricing: ProviderPricing;
}

export class PostCallProcessor {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext,
    private readonly provider: GenerativeProvider,
    private readonly config: PostCallProcessorConfig
  ) {}

  public async process(
    job: PostCallJob
  ): Promise<{ revisionId: string; version: number; deduplicated: boolean }> {
    if (!this.config.enabled) throw new Error('POST_CALL_INTELLIGENCE_DISABLED');
    const loaded = await this.load(job.liveCallSessionId);
    if (!loaded || loaded.session.status !== 'ENDED')
      throw new Error('POST_CALL_SESSION_NOT_ENDED');
    if (!loaded.turns.length) throw new Error('POST_CALL_EMPTY_TRANSCRIPT');
    const segments = segmentTranscript(loaded.turns, this.config.maxSegmentCharacters);
    let inputTokens = 0;
    let outputTokens = 0;
    let model = 'unknown';
    const partials: PostCallReportContent[] = [];
    for (const segment of segments) {
      const generated = await this.provider.analyzePostCall({
        profile: 'POST_CALL_ANALYSIS',
        phase: 'EXTRACT',
        processingVersion: job.processingVersion,
        sessionId: loaded.session.id,
        segmentIndex: segment.index,
        segmentCount: segments.length,
        turns: segment.turns,
        partialReports: [],
        dealState: loaded.dealState,
        liveMemory: { ...loaded.session.memory },
        constraints: {
          maxInputCharacters: this.config.maxSegmentCharacters,
          maxOutputCharacters: this.config.maxOutputCharacters
        }
      });
      inputTokens += generated.inputTokens;
      outputTokens += generated.outputTokens;
      model = generated.model;
      partials.push(
        reconcilePostCallReport(generated.output, new Set(segment.turns.map((turn) => turn.id)))
      );
    }
    let content = partials[0]!;
    if (partials.length > 1) {
      const merged = await this.provider.analyzePostCall({
        profile: 'POST_CALL_ANALYSIS',
        phase: 'MERGE',
        processingVersion: job.processingVersion,
        sessionId: loaded.session.id,
        segmentIndex: segments.length,
        segmentCount: segments.length,
        turns: [],
        partialReports: partials,
        dealState: loaded.dealState,
        liveMemory: { ...loaded.session.memory },
        constraints: {
          maxInputCharacters: this.config.maxSegmentCharacters,
          maxOutputCharacters: this.config.maxOutputCharacters
        }
      });
      inputTokens += merged.inputTokens;
      outputTokens += merged.outputTokens;
      model = merged.model;
      content = reconcilePostCallReport(
        merged.output,
        new Set(loaded.turns.map((turn) => turn.id))
      );
    }
    const proposals = buildSafeProposals(content, loaded.existingValues);
    const estimatedCostMicros =
      (BigInt(inputTokens) * this.config.pricing.inputMicrosPerMillionTokens +
        BigInt(outputTokens) * this.config.pricing.outputMicrosPerMillionTokens) /
      1_000_000n;
    return this.commit(job, loaded, content, proposals, {
      model,
      inputTokens,
      outputTokens,
      estimatedCostMicros,
      latencyMs: Math.max(0, Date.now() - job.lockedAt!.getTime())
    });
  }

  private async load(sessionId: string) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [session] = await tx
        .select()
        .from(liveCallSessions)
        .where(
          and(
            eq(liveCallSessions.organizationId, this.context.organizationId),
            eq(liveCallSessions.id, sessionId)
          )
        )
        .limit(1);
      if (!session) return null;
      const turns = await tx
        .select()
        .from(liveTranscriptTurns)
        .where(
          and(
            eq(liveTranscriptTurns.organizationId, this.context.organizationId),
            eq(liveTranscriptTurns.liveCallSessionId, sessionId),
            eq(liveTranscriptTurns.isFinal, true)
          )
        )
        .orderBy(asc(liveTranscriptTurns.sequence));
      const [state] = session.dealId
        ? await tx
            .select({ snapshot: dealStates.snapshot })
            .from(dealStates)
            .where(
              and(
                eq(dealStates.organizationId, this.context.organizationId),
                eq(dealStates.dealId, session.dealId)
              )
            )
            .limit(1)
        : [];
      const memory = session.dealId
        ? await tx
            .select({ factType: memoryFacts.factType, value: memoryFacts.value })
            .from(memoryFacts)
            .where(
              and(
                eq(memoryFacts.organizationId, this.context.organizationId),
                eq(memoryFacts.scopeType, 'DEAL_FACT'),
                eq(memoryFacts.scopeId, session.dealId),
                eq(memoryFacts.status, 'ACTIVE')
              )
            )
        : [];
      const existingValues = new Set(
        memory.map(
          (item) =>
            `${item.factType}:${item.value.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')}`
        )
      );
      for (const [field, value] of Object.entries(
        (state?.snapshot ?? {}) as Record<string, unknown>
      ))
        if (typeof value === 'string')
          existingValues.add(
            `${field}:${value.trim().toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ')}`
          );
      return {
        session,
        dealState: state?.snapshot ?? {},
        existingValues,
        turns: turns.map((turn): PostCallTurn => ({
          id: turn.id,
          sequence: turn.sequence,
          speakerRole: turn.speakerRole,
          text: turn.text,
          startedAt: turn.startedAt.toISOString()
        }))
      };
    });
  }

  private async commit(
    job: PostCallJob,
    loaded: NonNullable<Awaited<ReturnType<PostCallProcessor['load']>>>,
    content: PostCallReportContent,
    proposals: ReturnType<typeof buildSafeProposals>,
    usage: {
      model: string;
      inputTokens: number;
      outputTokens: number;
      estimatedCostMicros: bigint;
      latencyMs: number;
    }
  ) {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${this.context.organizationId}), hashtext(${loaded.session.id}))`
      );
      const [report] = await tx
        .select()
        .from(callReports)
        .where(
          and(
            eq(callReports.organizationId, this.context.organizationId),
            eq(callReports.liveCallSessionId, loaded.session.id)
          )
        )
        .limit(1)
        .for('update');
      if (!report) throw new Error('POST_CALL_REPORT_NOT_FOUND');
      const [latest] = await tx
        .select()
        .from(callReportRevisions)
        .where(
          and(
            eq(callReportRevisions.organizationId, this.context.organizationId),
            eq(callReportRevisions.callReportId, report.id)
          )
        )
        .orderBy(desc(callReportRevisions.version))
        .limit(1);
      if (
        latest?.processingVersion === job.processingVersion &&
        latest.status === 'CURRENT' &&
        job.attempts > 1
      )
        return { revisionId: latest.id, version: latest.version, deduplicated: true };
      await tx
        .update(callReportRevisions)
        .set({ status: 'SUPERSEDED' })
        .where(
          and(
            eq(callReportRevisions.organizationId, this.context.organizationId),
            eq(callReportRevisions.callReportId, report.id),
            eq(callReportRevisions.status, 'CURRENT')
          )
        );
      const [revision] = await tx
        .insert(callReportRevisions)
        .values({
          organizationId: this.context.organizationId,
          callReportId: report.id,
          liveCallSessionId: loaded.session.id,
          version: (latest?.version ?? 0) + 1,
          processingVersion: job.processingVersion,
          provider: this.provider.metadata.provider,
          model: usage.model,
          promptVersion: POST_CALL_PROMPT_VERSION,
          configVersion: this.provider.metadata.configVersion,
          content,
          proposals,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          estimatedCostMicros: usage.estimatedCostMicros,
          evidenceCount: countEvidence(content)
        })
        .returning();
      if (!revision) throw new Error('POST_CALL_REVISION_NOT_CREATED');
      await tx
        .update(callReports)
        .set({
          status: 'READY',
          processingVersion: job.processingVersion,
          failureCode: null,
          readyAt: new Date(),
          updatedAt: new Date()
        })
        .where(eq(callReports.id, report.id));
      await tx.insert(aiUsage).values({
        organizationId: this.context.organizationId,
        callReportRevisionId: revision.id,
        liveCallSessionId: loaded.session.id,
        dealId: loaded.session.dealId,
        sellerMembershipId: loaded.session.sellerMembershipId,
        conversationId: loaded.session.conversationId,
        provider: this.provider.metadata.provider,
        model: usage.model,
        profile: 'POST_CALL_ANALYSIS',
        purpose: 'POST_CALL_ANALYSIS',
        success: true,
        retryCount: Math.max(0, job.attempts - 1),
        inputSize: loaded.turns.reduce((sum, turn) => sum + turn.text.length, 0),
        outputSize: JSON.stringify(content).length,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        latencyMs: usage.latencyMs,
        estimatedCostMicros: usage.estimatedCostMicros
      });
      await tx.insert(realtimeEvents).values({
        organizationId: this.context.organizationId,
        sellerMembershipId: loaded.session.sellerMembershipId,
        type: 'call_report.ready',
        correlationId: job.correlationId,
        conversationId: loaded.session.conversationId,
        dealId: loaded.session.dealId,
        liveCallSessionId: loaded.session.id,
        payload: {
          liveCallSessionId: loaded.session.id,
          reportId: report.id,
          revisionId: revision.id,
          status: 'READY'
        },
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60_000)
      });
      return { revisionId: revision.id, version: revision.version, deduplicated: false };
    });
  }
}
