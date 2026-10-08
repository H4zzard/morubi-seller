import {
  DeepSeekGenerativeProvider,
  FixtureGenerativeProvider,
  FixtureTranscriptionProvider,
  GeminiTranscriptionProvider,
  type GenerativeProvider,
  type TranscriptionProvider
} from '@morubi/ai';
import type { WorkerEnv } from '@morubi/config';
import {
  CopilotRepository,
  AudioAssetService,
  GenerationJobRepository,
  GenerativeProcessor,
  IntelligenceJobRepository,
  IntelligenceProcessor,
  LiveCallRepository,
  PostCallJobRepository,
  PostCallProcessor,
  TranscriptionJobRepository,
  TranscriptionProcessor,
  listWorkerQueues,
  expireStaleLiveSessions,
  resolveIntelligenceConfig,
  workerTenantContext,
  type DatabaseHandle
} from '@morubi/db';
import { FixtureDecisionProvider } from '@morubi/intelligence';
import { LocalObjectStorage } from '@morubi/storage';

export interface WorkerLogger {
  info(value: Record<string, unknown>, message: string): void;
  error(value: Record<string, unknown>, message: string): void;
}

export class MorubiWorkerService {
  private readonly generativeProvider: GenerativeProvider;
  private readonly postCallProvider: GenerativeProvider;
  private readonly transcriptionProvider: TranscriptionProvider;
  private readonly audioStorage: LocalObjectStorage;

  public constructor(
    private readonly database: DatabaseHandle,
    private readonly coordinatorDatabase: DatabaseHandle,
    private readonly env: WorkerEnv,
    private readonly log: WorkerLogger
  ) {
    this.generativeProvider = this.createGenerativeProvider();
    this.postCallProvider = this.createPostCallProvider();
    this.transcriptionProvider = this.createTranscriptionProvider();
    this.audioStorage = new LocalObjectStorage(this.env.AUDIO_STORAGE_ROOT);
  }

  public async cycle(): Promise<void> {
    if (this.env.LIVE_CALLS_ENABLED) {
      const expired = await expireStaleLiveSessions(this.coordinatorDatabase.db);
      if (expired) this.log.info({ expired }, 'Stale live call sessions closed');
    }
    const queues = await listWorkerQueues(this.coordinatorDatabase.db);
    this.log.info(
      {
        organizations: queues.length,
        transcriptionQueueDepth: queues.reduce((sum, item) => sum + item.transcriptionPending, 0),
        audioRetentionDepth: queues.reduce((sum, item) => sum + item.audioRetentionPending, 0),
        transcriptRetentionDepth: queues.reduce(
          (sum, item) => sum + item.transcriptRetentionPending,
          0
        ),
        intelligenceQueueDepth: queues.reduce((sum, item) => sum + item.intelligencePending, 0),
        generationQueueDepth: queues.reduce((sum, item) => sum + item.generationPending, 0),
        postCallQueueDepth: queues.reduce((sum, item) => sum + item.postCallPending, 0)
      },
      'Worker queue snapshot'
    );
    let remaining = this.env.WORKER_BATCH_SIZE;
    for (const queue of queues) {
      if (remaining <= 0) break;
      const context = workerTenantContext(queue.organizationId);
      if (this.env.AUDIO_INTELLIGENCE_ENABLED) {
        const purged = await new AudioAssetService(
          this.coordinatorDatabase.db,
          context,
          this.audioStorage,
          {
            maxBytes: this.env.AUDIO_MAX_BYTES,
            retentionDays: this.env.AUDIO_RETENTION_DAYS,
            provider: this.transcriptionProvider.metadata.provider,
            model: this.env.GEMINI_TRANSCRIPTION_MODEL
          }
        ).purgeExpired();
        if (purged.assets || purged.transcripts)
          this.log.info(
            { organizationId: context.organizationId, ...purged },
            'Audio retention applied'
          );
      }
      while (remaining > 0 && (await this.processTranscription(context))) remaining -= 1;
      while (remaining > 0 && (await this.processIntelligence(context))) remaining -= 1;
      while (remaining > 0 && (await this.processGeneration(context))) remaining -= 1;
      while (remaining > 0 && (await this.processPostCall(context))) remaining -= 1;
    }
  }

  private async processTranscription(
    context: ReturnType<typeof workerTenantContext>
  ): Promise<boolean> {
    if (!this.env.AUDIO_INTELLIGENCE_ENABLED) return false;
    const jobs = new TranscriptionJobRepository(this.database.db, context);
    const job = await jobs.claimNext();
    if (!job) return false;
    const startedAt = performance.now();
    try {
      const result = await new TranscriptionProcessor(
        this.database.db,
        context,
        this.audioStorage,
        this.transcriptionProvider,
        {
          inputMicrosPerMillionTokens:
            this.env.GEMINI_TRANSCRIPTION_INPUT_COST_MICROS_PER_MILLION_TOKENS,
          outputMicrosPerMillionTokens:
            this.env.GEMINI_TRANSCRIPTION_OUTPUT_COST_MICROS_PER_MILLION_TOKENS,
          audioMicrosPerMinute: this.env.GEMINI_TRANSCRIPTION_AUDIO_COST_MICROS_PER_MINUTE
        }
      ).process(job);
      await jobs.complete(job.id);
      this.log.info(
        {
          jobType: 'TRANSCRIPTION',
          organizationId: context.organizationId,
          correlationId: job.correlationId,
          jobId: job.id,
          transcriptId: result.transcriptId,
          eventId: result.eventId,
          providerLatencyMs: result.providerLatencyMs,
          audioToTranscriptMs: result.audioToTranscriptMs,
          attempts: job.attempts,
          processingLatencyMs: Math.round(performance.now() - startedAt)
        },
        'Worker job completed'
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'SOURCE_DELETED') await jobs.cancel(job.id);
      else await jobs.fail(job, error);
      this.log.error(
        {
          jobType: 'TRANSCRIPTION',
          organizationId: context.organizationId,
          correlationId: job.correlationId,
          jobId: job.id,
          attempts: job.attempts,
          errorCode: error instanceof Error ? error.message : 'UNKNOWN'
        },
        'Worker job failed'
      );
    }
    return true;
  }

  private async processIntelligence(
    context: ReturnType<typeof workerTenantContext>
  ): Promise<boolean> {
    const jobs = new IntelligenceJobRepository(this.database.db, context);
    const job = await jobs.claimNext();
    if (!job) return false;
    const startedAt = performance.now();
    try {
      const config = await resolveIntelligenceConfig(this.database.db, context, {
        intelligenceEnabled: this.env.INTELLIGENCE_ENABLED,
        policy: {
          shadowMode: this.env.SHADOW_MODE,
          interventionsVisible: this.env.INTERVENTIONS_VISIBLE,
          thresholds: {
            objection: 0.7,
            risk: 0.75,
            buyingSignal: 0.7,
            intervention: 0.65,
            stateUpdate: 0.65,
            memoryUpdate: 0.8
          }
        }
      });
      const result = await new IntelligenceProcessor(
        this.database.db,
        context,
        new FixtureDecisionProvider(),
        config
      ).processEvent(job.commercialEventId);
      const delivery = await new CopilotRepository(this.database.db, context).deliverDecision(
        result.decisionId,
        job.correlationId,
        result.stateVersion,
        {
          shadowMode: this.env.SHADOW_MODE,
          interventionsVisible: this.env.INTERVENTIONS_VISIBLE,
          realtimeEnabled: this.env.REALTIME_ENABLED,
          feedbackEnabled: this.env.SELLER_FEEDBACK_ENABLED
        }
      );
      let speechToCardMs: number | null = null;
      if (job.source === 'LIVE_CALL') {
        const live = new LiveCallRepository(this.database.db, context, this.env.LIVE_CALLS_ENABLED);
        await live.recordDecisionForEvent(
          job.commercialEventId,
          result.decisionId,
          delivery.delivery?.deliveryId ?? null
        );
        const eventSession = delivery.delivery?.liveCallSessionId;
        if (eventSession)
          speechToCardMs = (await live.get(eventSession))?.metrics.speechToCardMs ?? null;
      }
      await jobs.complete(job.id);
      this.log.info(
        {
          jobType: 'INTELLIGENCE',
          organizationId: context.organizationId,
          correlationId: job.correlationId,
          jobId: job.id,
          attempts: job.attempts,
          decisionId: result.decisionId,
          deliveryId: delivery.delivery?.deliveryId,
          speechToCardMs,
          processingLatencyMs: Math.round(performance.now() - startedAt)
        },
        'Worker job completed'
      );
      return true;
    } catch (error) {
      await jobs.fail(job, error);
      this.log.error(
        {
          jobType: 'INTELLIGENCE',
          organizationId: context.organizationId,
          correlationId: job.correlationId,
          jobId: job.id,
          attempts: job.attempts,
          terminal: job.attempts >= job.maxAttempts,
          errorCode: error instanceof Error ? error.name : 'UNKNOWN'
        },
        'Worker job failed'
      );
      return true;
    }
  }

  private async processGeneration(
    context: ReturnType<typeof workerTenantContext>
  ): Promise<boolean> {
    const jobs = new GenerationJobRepository(this.database.db, context);
    const job = await jobs.claimNext();
    if (!job) return false;
    const startedAt = performance.now();
    const processor = new GenerativeProcessor(this.database.db, context, this.generativeProvider, {
      generativeAiEnabled: this.env.GENERATIVE_AI_ENABLED && this.env.DEEPSEEK_ENABLED,
      pricing: {
        inputMicrosPerMillionTokens: this.env.DEEPSEEK_INPUT_COST_MICROS_PER_MILLION_TOKENS,
        outputMicrosPerMillionTokens: this.env.DEEPSEEK_OUTPUT_COST_MICROS_PER_MILLION_TOKENS
      },
      maxValidationRetries: 1
    });
    try {
      const result = await processor.process(job);
      let deliveryId: string | undefined;
      if (result.eligibleForDelivery) {
        const delivery = await new CopilotRepository(this.database.db, context).deliverDecision(
          result.decisionId,
          job.correlationId,
          null,
          {
            shadowMode: this.env.SHADOW_MODE,
            interventionsVisible: this.env.INTERVENTIONS_VISIBLE,
            realtimeEnabled: this.env.REALTIME_ENABLED,
            feedbackEnabled: this.env.SELLER_FEEDBACK_ENABLED
          }
        );
        deliveryId = delivery.delivery?.deliveryId;
        if (result.executionId)
          await processor.markDelivery(result.executionId, Boolean(deliveryId));
      }
      if (this.env.LIVE_CALLS_ENABLED)
        await new LiveCallRepository(this.database.db, context, true).recordGenerationForCandidate(
          job.candidateId
        );
      await jobs.complete(job.id);
      this.log.info(
        {
          jobType: 'GENERATION',
          organizationId: context.organizationId,
          correlationId: job.correlationId,
          jobId: job.id,
          attempts: job.attempts,
          executionId: result.executionId,
          deliveryId,
          result: result.reason,
          processingLatencyMs: Math.round(performance.now() - startedAt)
        },
        'Worker job completed'
      );
      return true;
    } catch (error) {
      await jobs.fail(job, error);
      this.log.error(
        {
          jobType: 'GENERATION',
          organizationId: context.organizationId,
          correlationId: job.correlationId,
          jobId: job.id,
          attempts: job.attempts,
          terminal: job.attempts >= job.maxAttempts,
          errorCode: error instanceof Error ? error.name : 'UNKNOWN'
        },
        'Worker job failed'
      );
      return true;
    }
  }

  private createGenerativeProvider(): GenerativeProvider {
    if (!this.env.GENERATIVE_AI_ENABLED || !this.env.DEEPSEEK_ENABLED)
      return {
        metadata: { provider: 'disabled', configVersion: 'disabled-v1' },
        generate: () => Promise.reject(new Error('GENERATION_PROVIDER_DISABLED')),
        analyzePostCall: () => Promise.reject(new Error('POST_CALL_PROVIDER_DISABLED'))
      };
    return new DeepSeekGenerativeProvider({
      apiKey: this.env.DEEPSEEK_API_KEY!,
      baseUrl: this.env.DEEPSEEK_BASE_URL,
      fastModel: this.env.DEEPSEEK_FAST_MODEL,
      reasoningModel: this.env.DEEPSEEK_REASONING_MODEL,
      fastTimeoutMs: this.env.DEEPSEEK_FAST_TIMEOUT_MS,
      reasoningTimeoutMs: this.env.DEEPSEEK_REASONING_TIMEOUT_MS,
      maxOutputTokens: this.env.DEEPSEEK_MAX_OUTPUT_TOKENS,
      configVersion: 'deepseek-config-v1'
    });
  }

  private createPostCallProvider(): GenerativeProvider {
    if (this.env.POST_CALL_PROVIDER === 'fixture') return new FixtureGenerativeProvider();
    if (!this.env.DEEPSEEK_ENABLED || !this.env.DEEPSEEK_API_KEY)
      return {
        metadata: { provider: 'disabled', configVersion: 'disabled-v1' },
        generate: () => Promise.reject(new Error('GENERATION_PROVIDER_DISABLED')),
        analyzePostCall: () => Promise.reject(new Error('POST_CALL_PROVIDER_DISABLED'))
      };
    return new DeepSeekGenerativeProvider({
      apiKey: this.env.DEEPSEEK_API_KEY,
      baseUrl: this.env.DEEPSEEK_BASE_URL,
      fastModel: this.env.DEEPSEEK_FAST_MODEL,
      reasoningModel: this.env.DEEPSEEK_REASONING_MODEL,
      fastTimeoutMs: this.env.DEEPSEEK_FAST_TIMEOUT_MS,
      reasoningTimeoutMs: this.env.DEEPSEEK_REASONING_TIMEOUT_MS,
      maxOutputTokens: this.env.DEEPSEEK_MAX_OUTPUT_TOKENS,
      configVersion: 'deepseek-post-call-config-v1'
    });
  }

  private async processPostCall(context: ReturnType<typeof workerTenantContext>): Promise<boolean> {
    if (!this.env.POST_CALL_INTELLIGENCE_ENABLED) return false;
    const jobs = new PostCallJobRepository(this.database.db, context);
    const job = await jobs.claimNext();
    if (!job) return false;
    const startedAt = performance.now();
    try {
      const result = await new PostCallProcessor(this.database.db, context, this.postCallProvider, {
        enabled: true,
        maxSegmentCharacters: this.env.POST_CALL_MAX_SEGMENT_CHARACTERS,
        maxOutputCharacters: this.env.POST_CALL_MAX_OUTPUT_CHARACTERS,
        pricing: {
          inputMicrosPerMillionTokens: this.env.DEEPSEEK_INPUT_COST_MICROS_PER_MILLION_TOKENS,
          outputMicrosPerMillionTokens: this.env.DEEPSEEK_OUTPUT_COST_MICROS_PER_MILLION_TOKENS
        }
      }).process(job);
      await jobs.complete(job.id);
      this.log.info(
        {
          jobType: 'POST_CALL_ANALYSIS',
          organizationId: context.organizationId,
          correlationId: job.correlationId,
          jobId: job.id,
          revisionId: result.revisionId,
          version: result.version,
          attempts: job.attempts,
          processingLatencyMs: Math.round(performance.now() - startedAt)
        },
        'Worker job completed'
      );
    } catch (error) {
      await jobs.fail(job, error);
      this.log.error(
        {
          jobType: 'POST_CALL_ANALYSIS',
          organizationId: context.organizationId,
          correlationId: job.correlationId,
          jobId: job.id,
          attempts: job.attempts,
          terminal: job.attempts >= job.maxAttempts,
          errorCode: error instanceof Error ? error.name : 'UNKNOWN'
        },
        'Worker job failed'
      );
    }
    return true;
  }

  private createTranscriptionProvider(): TranscriptionProvider {
    if (this.env.AUDIO_INTELLIGENCE_ENABLED && this.env.GEMINI_TRANSCRIPTION_ENABLED) {
      return new GeminiTranscriptionProvider({
        apiKey: this.env.GEMINI_API_KEY!,
        baseUrl: this.env.GEMINI_BASE_URL,
        model: this.env.GEMINI_TRANSCRIPTION_MODEL,
        timeoutMs: this.env.GEMINI_TRANSCRIPTION_TIMEOUT_MS,
        configVersion: 'gemini-transcription-v1'
      });
    }
    if (this.env.NODE_ENV !== 'production') return new FixtureTranscriptionProvider();
    return {
      metadata: { provider: 'disabled', configVersion: 'disabled-v1' },
      transcribe: () => Promise.reject(new Error('TRANSCRIPTION_PROVIDER_DISABLED'))
    };
  }
}
