import { createHash, randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, lt, max, or, sql } from 'drizzle-orm';
import {
  TranscriptionProviderError,
  assertAudioPayload,
  estimateTranscriptionCost,
  validateTranscription,
  type AudioMimeType,
  type TranscriptionPricing,
  type TranscriptionProvider
} from '@morubi/ai';
import type { AudioAssetDevDto, AudioBinaryDto, MessageSenderType } from '@morubi/contracts';
import type { TenantContext } from '@morubi/domain';
import { audioStorageKey, type ObjectStorage } from '@morubi/storage';
import type { MorubiDatabase } from './database.js';
import { CommercialIngestionService } from './commercial-ingestion.js';
import { IntelligenceJobRepository } from './copilot.js';
import {
  aiUsage,
  audioAssets,
  audioTranscripts,
  commercialEvents,
  conversations,
  deals,
  intelligenceSettings,
  messages,
  transcriptionJobs
} from './schema.js';
import { setTenantContext } from './tenant.js';

type TranscriptionJob = typeof transcriptionJobs.$inferSelect;

export interface AudioIngestionInput {
  conversationId: string;
  messageId: string;
  sourceProvider: string;
  sourceUrl?: string | null;
  fileName?: string | null;
  mimeType: string;
  durationMs: number;
  speakerType: MessageSenderType;
  occurredAt: Date;
  data: Uint8Array;
  metadata?: Record<string, unknown>;
  correlationId: string;
}

export function audioIdempotencyKey(
  messageId: string,
  data: Uint8Array
): { sha256: string; key: string } {
  const sha256 = createHash('sha256').update(data).digest('hex');
  return {
    sha256,
    key: createHash('sha256').update(`${messageId}:${sha256}`).digest('hex')
  };
}

export function transcriptionFailureState(
  job: Pick<TranscriptionJob, 'attempts' | 'maxAttempts'>,
  error: unknown
): 'RETRY' | 'FAILED' {
  const retryable = error instanceof TranscriptionProviderError && error.retryable;
  return retryable && job.attempts < job.maxAttempts ? 'RETRY' : 'FAILED';
}

export function commercialEventSourceFromProvider(
  provider: string
): 'CRM' | 'WHATSAPP' | 'EMAIL' | 'MEET' | 'ZOOM' | 'MANUAL' | 'OTHER' {
  const normalized = provider.toUpperCase();
  if (normalized.includes('WHATSAPP')) return 'WHATSAPP';
  if (normalized.includes('EMAIL')) return 'EMAIL';
  if (normalized.includes('CRM')) return 'CRM';
  if (normalized.includes('MEET')) return 'MEET';
  if (normalized.includes('ZOOM')) return 'ZOOM';
  if (normalized.includes('FIXTURE') || normalized.includes('MANUAL')) return 'MANUAL';
  return 'OTHER';
}

export class AudioAssetService {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext,
    private readonly storage: ObjectStorage,
    private readonly options: {
      maxBytes: number;
      retentionDays: number;
      provider: string;
      model: string;
    }
  ) {}

  public async ingest(
    input: AudioIngestionInput
  ): Promise<{ assetId: string; jobId: string; deduplicated: boolean }> {
    assertAudioPayload(input.data, input.mimeType, this.options.maxBytes);
    if (
      !Number.isSafeInteger(input.durationMs) ||
      input.durationMs < 250 ||
      input.durationMs > 3_600_000
    )
      throw new Error('AUDIO_DURATION_INVALID');
    const { sha256, key: idempotencyKey } = audioIdempotencyKey(input.messageId, input.data);
    const existing = await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [row] = await tx
        .select({ id: audioAssets.id })
        .from(audioAssets)
        .where(
          and(
            eq(audioAssets.organizationId, this.context.organizationId),
            eq(audioAssets.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1);
      if (!row) return null;
      const [job] = await tx
        .select({ id: transcriptionJobs.id })
        .from(transcriptionJobs)
        .where(
          and(
            eq(transcriptionJobs.organizationId, this.context.organizationId),
            eq(transcriptionJobs.audioAssetId, row.id)
          )
        )
        .orderBy(desc(transcriptionJobs.createdAt))
        .limit(1);
      return job ? { assetId: row.id, jobId: job.id, deduplicated: true as const } : null;
    });
    if (existing) return existing;
    const assetId = randomUUID();
    const extension: Record<AudioMimeType, string> = {
      'audio/wav': 'wav',
      'audio/mpeg': 'mp3',
      'audio/ogg': 'ogg',
      'audio/webm': 'webm'
    };
    const storageKey = audioStorageKey(
      this.context.organizationId,
      assetId,
      extension[input.mimeType]
    );
    await this.storage.put(storageKey, input.data);
    try {
      return await this.db.transaction(async (tx) => {
        await setTenantContext(tx, this.context);
        const [message] = await tx
          .select({ id: messages.id, deletedAt: messages.deletedAt })
          .from(messages)
          .where(
            and(
              eq(messages.organizationId, this.context.organizationId),
              eq(messages.id, input.messageId),
              eq(messages.conversationId, input.conversationId),
              eq(messages.contentType, 'AUDIO')
            )
          )
          .limit(1);
        if (!message || message.deletedAt) throw new Error('AUDIO_MESSAGE_NOT_FOUND');
        const [conversation] = await tx
          .select({ contactId: conversations.primaryContactId, dealId: conversations.dealId })
          .from(conversations)
          .where(
            and(
              eq(conversations.organizationId, this.context.organizationId),
              eq(conversations.id, input.conversationId)
            )
          )
          .limit(1);
        if (!conversation) throw new Error('AUDIO_CONVERSATION_NOT_FOUND');
        const retentionUntil = new Date(Date.now() + this.options.retentionDays * 86_400_000);
        await tx.insert(audioAssets).values({
          id: assetId,
          organizationId: this.context.organizationId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          contactId: conversation.contactId,
          dealId: conversation.dealId,
          idempotencyKey,
          sourceProvider: input.sourceProvider,
          sourceUrl: input.sourceUrl,
          storageProvider: 'local-private',
          storageKey,
          originalFileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.data.byteLength,
          durationMs: input.durationMs,
          sha256,
          speakerType: input.speakerType,
          occurredAt: input.occurredAt,
          retentionUntil,
          metadata: input.metadata
        });
        const [job] = await tx
          .insert(transcriptionJobs)
          .values({
            organizationId: this.context.organizationId,
            audioAssetId: assetId,
            processingKey: `${assetId}:${this.options.provider}:${this.options.model}:v1`,
            provider: this.options.provider,
            model: this.options.model,
            correlationId: input.correlationId
          })
          .returning({ id: transcriptionJobs.id });
        if (!job) throw new Error('AUDIO_JOB_NOT_CREATED');
        return { assetId, jobId: job.id, deduplicated: false };
      });
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
  }

  public async getBinaryByMessage(messageId: string): Promise<AudioBinaryDto | null> {
    const row = await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [value] = await tx
        .select({ key: audioAssets.storageKey, mime: audioAssets.mimeType })
        .from(audioAssets)
        .innerJoin(
          conversations,
          and(
            eq(conversations.id, audioAssets.conversationId),
            eq(conversations.organizationId, audioAssets.organizationId)
          )
        )
        .leftJoin(
          deals,
          and(
            eq(deals.id, conversations.dealId),
            eq(deals.organizationId, conversations.organizationId)
          )
        )
        .where(
          and(
            eq(audioAssets.organizationId, this.context.organizationId),
            eq(audioAssets.messageId, messageId),
            this.context.role === 'SELLER'
              ? eq(deals.ownerMembershipId, this.context.membershipId)
              : sql`true`
          )
        )
        .limit(1);
      return value ?? null;
    });
    if (!row) return null;
    const bytes = await this.storage.get(row.key);
    return { mimeType: row.mime, dataBase64: Buffer.from(bytes).toString('base64') };
  }

  public async list(limit = 100): Promise<AudioAssetDevDto[]> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const rows = await tx
        .select({
          asset: audioAssets,
          transcript: audioTranscripts.text,
          jobId: sql<
            string | null
          >`(select j.id::text from transcription_jobs j where j.organization_id = ${audioAssets.organizationId} and j.audio_asset_id = ${audioAssets.id} order by j.created_at desc limit 1)`,
          jobStatus: sql<
            string | null
          >`(select j.status::text from transcription_jobs j where j.organization_id = ${audioAssets.organizationId} and j.audio_asset_id = ${audioAssets.id} order by j.created_at desc limit 1)`,
          commercialEventId: sql<
            string | null
          >`(select e.id::text from commercial_events e where e.organization_id = ${audioAssets.organizationId} and e.audio_transcript_id = ${audioTranscripts.id} limit 1)`,
          decisionId: sql<
            string | null
          >`(select d.id::text from ai_decisions d join commercial_events e on e.organization_id = d.organization_id and e.id = d.commercial_event_id where e.organization_id = ${audioAssets.organizationId} and e.audio_transcript_id = ${audioTranscripts.id} order by d.created_at desc limit 1)`,
          interventionDeliveryId: sql<
            string | null
          >`(select v.id::text from intervention_deliveries v join intervention_candidates c on c.organization_id = v.organization_id and c.id = v.candidate_id join ai_decisions d on d.organization_id = c.organization_id and d.id = c.ai_decision_id join commercial_events e on e.organization_id = d.organization_id and e.id = d.commercial_event_id where e.organization_id = ${audioAssets.organizationId} and e.audio_transcript_id = ${audioTranscripts.id} order by v.created_at desc limit 1)`
        })
        .from(audioAssets)
        .leftJoin(
          audioTranscripts,
          and(
            eq(audioTranscripts.audioAssetId, audioAssets.id),
            eq(audioTranscripts.organizationId, audioAssets.organizationId),
            eq(audioTranscripts.status, 'CURRENT')
          )
        )
        .where(eq(audioAssets.organizationId, this.context.organizationId))
        .orderBy(desc(audioAssets.createdAt))
        .limit(limit);
      return rows.map(
        ({
          asset,
          transcript,
          jobId,
          jobStatus,
          commercialEventId,
          decisionId,
          interventionDeliveryId
        }) => ({
          id: asset.id,
          messageId: asset.messageId,
          conversationId: asset.conversationId,
          status: asset.status,
          mimeType: asset.mimeType,
          sizeBytes: asset.sizeBytes,
          durationMs: asset.durationMs,
          transcript,
          jobId,
          jobStatus,
          commercialEventId,
          decisionId,
          interventionDeliveryId,
          createdAt: asset.createdAt.toISOString()
        })
      );
    });
  }

  public async setOrganizationEnabled(enabled: boolean): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx
        .insert(intelligenceSettings)
        .values({
          organizationId: this.context.organizationId,
          intelligenceEnabled: true,
          thresholds: {
            objection: 0.7,
            risk: 0.75,
            buyingSignal: 0.7,
            intervention: 0.65,
            stateUpdate: 0.65,
            memoryUpdate: 0.8
          },
          audioIntelligenceEnabled: enabled
        })
        .onConflictDoUpdate({
          target: intelligenceSettings.organizationId,
          set: { audioIntelligenceEnabled: enabled, updatedAt: new Date() }
        });
    });
  }

  public async purgeExpired(
    transcriptRetentionDays?: number,
    limit = 100
  ): Promise<{ assets: number; transcripts: number }> {
    const retention = await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [settings] = await tx
        .select({ transcriptRetentionDays: intelligenceSettings.transcriptRetentionDays })
        .from(intelligenceSettings)
        .where(eq(intelligenceSettings.organizationId, this.context.organizationId))
        .limit(1);
      const expired = await tx
        .select({ id: audioAssets.id, storageKey: audioAssets.storageKey })
        .from(audioAssets)
        .where(
          and(
            eq(audioAssets.organizationId, this.context.organizationId),
            lt(audioAssets.retentionUntil, new Date()),
            or(
              eq(audioAssets.status, 'READY'),
              eq(audioAssets.status, 'TRANSCRIBED'),
              eq(audioAssets.status, 'FAILED')
            )
          )
        )
        .limit(limit);
      return {
        expired,
        transcriptRetentionDays: transcriptRetentionDays ?? settings?.transcriptRetentionDays ?? 90
      };
    });
    const { expired } = retention;
    for (const asset of expired) await this.storage.delete(asset.storageKey);
    const transcriptCutoff = new Date(Date.now() - retention.transcriptRetentionDays * 86_400_000);
    const transcriptIds = await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      if (expired.length)
        await tx
          .update(audioAssets)
          .set({ status: 'EXPIRED', updatedAt: new Date() })
          .where(
            and(
              eq(audioAssets.organizationId, this.context.organizationId),
              inArray(
                audioAssets.id,
                expired.map((item) => item.id)
              )
            )
          );
      const rows = await tx
        .select({ id: audioTranscripts.id })
        .from(audioTranscripts)
        .where(
          and(
            eq(audioTranscripts.organizationId, this.context.organizationId),
            lt(audioTranscripts.createdAt, transcriptCutoff)
          )
        )
        .limit(limit);
      if (rows.length) {
        const ids = rows.map((row) => row.id);
        await tx
          .update(commercialEvents)
          .set({
            text: null,
            metadata: sql`${commercialEvents.metadata} || '{"retentionRedacted":true}'::jsonb`
          })
          .where(
            and(
              eq(commercialEvents.organizationId, this.context.organizationId),
              inArray(commercialEvents.audioTranscriptId, ids)
            )
          );
        await tx
          .delete(audioTranscripts)
          .where(
            and(
              eq(audioTranscripts.organizationId, this.context.organizationId),
              inArray(audioTranscripts.id, ids)
            )
          );
      }
      return rows.map((row) => row.id);
    });
    return { assets: expired.length, transcripts: transcriptIds.length };
  }
}

export class TranscriptionJobRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  public async claimNext(): Promise<TranscriptionJob | null> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const stale = new Date(Date.now() - 5 * 60_000);
      const [job] = await tx
        .select()
        .from(transcriptionJobs)
        .where(
          and(
            eq(transcriptionJobs.organizationId, this.context.organizationId),
            or(
              eq(transcriptionJobs.status, 'PENDING'),
              eq(transcriptionJobs.status, 'RETRY'),
              and(eq(transcriptionJobs.status, 'PROCESSING'), lt(transcriptionJobs.lockedAt, stale))
            ),
            sql`${transcriptionJobs.availableAt} <= now()`
          )
        )
        .orderBy(asc(transcriptionJobs.availableAt), asc(transcriptionJobs.createdAt))
        .limit(1)
        .for('update', { skipLocked: true });
      if (!job) return null;
      const [claimed] = await tx
        .update(transcriptionJobs)
        .set({
          status: 'PROCESSING',
          lockedAt: new Date(),
          attempts: job.attempts + 1,
          updatedAt: new Date()
        })
        .where(eq(transcriptionJobs.id, job.id))
        .returning();
      if (claimed)
        await tx
          .update(audioAssets)
          .set({ status: 'TRANSCRIBING', failureCode: null, updatedAt: new Date() })
          .where(eq(audioAssets.id, claimed.audioAssetId));
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
  public async cancel(jobId: string): Promise<void> {
    await this.finish(jobId, {
      status: 'CANCELLED',
      finishedAt: new Date(),
      lockedAt: null,
      errorCode: 'SOURCE_DELETED'
    });
  }

  public async fail(job: TranscriptionJob, error: unknown): Promise<void> {
    const terminal = transcriptionFailureState(job, error) === 'FAILED';
    const code = error instanceof Error ? error.message.slice(0, 100) : 'UNKNOWN';
    await this.finish(job.id, {
      status: terminal ? 'FAILED' : 'RETRY',
      availableAt: new Date(Date.now() + Math.min(60_000, 1000 * 2 ** job.attempts)),
      finishedAt: terminal ? new Date() : null,
      lockedAt: null,
      errorCode: code
    });
    if (terminal)
      await this.db.transaction(async (tx) => {
        await setTenantContext(tx, this.context);
        await tx
          .update(audioAssets)
          .set({ status: 'FAILED', failureCode: code, updatedAt: new Date() })
          .where(
            and(
              eq(audioAssets.organizationId, this.context.organizationId),
              eq(audioAssets.id, job.audioAssetId)
            )
          );
      });
  }

  private async finish(
    jobId: string,
    values: Partial<typeof transcriptionJobs.$inferInsert>
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx
        .update(transcriptionJobs)
        .set({ ...values, updatedAt: new Date() })
        .where(
          and(
            eq(transcriptionJobs.organizationId, this.context.organizationId),
            eq(transcriptionJobs.id, jobId)
          )
        );
    });
  }
}

export class TranscriptionProcessor {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext,
    private readonly storage: ObjectStorage,
    private readonly provider: TranscriptionProvider,
    private readonly pricing: TranscriptionPricing
  ) {}

  public async process(job: TranscriptionJob): Promise<{
    transcriptId: string;
    eventId: string | null;
    providerLatencyMs: number;
    audioToTranscriptMs: number;
  }> {
    const loaded = await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [row] = await tx
        .select({
          asset: audioAssets,
          deletedAt: messages.deletedAt,
          enabled: intelligenceSettings.audioIntelligenceEnabled
        })
        .from(audioAssets)
        .innerJoin(
          messages,
          and(
            eq(messages.id, audioAssets.messageId),
            eq(messages.organizationId, audioAssets.organizationId)
          )
        )
        .leftJoin(
          intelligenceSettings,
          eq(intelligenceSettings.organizationId, audioAssets.organizationId)
        )
        .where(
          and(
            eq(audioAssets.organizationId, this.context.organizationId),
            eq(audioAssets.id, job.audioAssetId)
          )
        )
        .limit(1);
      return row ?? null;
    });
    if (!loaded) throw new Error('AUDIO_ASSET_NOT_FOUND');
    if (job.provider !== this.provider.metadata.provider)
      throw new TranscriptionProviderError('TRANSCRIPTION_PROVIDER_MISMATCH', false);
    if (loaded.deletedAt || loaded.asset.status === 'DELETED')
      throw new TranscriptionProviderError('SOURCE_DELETED', false);
    if (loaded.enabled === false)
      throw new TranscriptionProviderError('AUDIO_DISABLED_FOR_ORGANIZATION', false);
    const data = await this.storage.get(loaded.asset.storageKey);
    assertAudioPayload(data, loaded.asset.mimeType, Math.max(loaded.asset.sizeBytes, 1));
    const providerStartedAt = performance.now();
    const output = validateTranscription(
      await this.provider.transcribe({
        audio: data,
        mimeType: loaded.asset.mimeType,
        durationMs: loaded.asset.durationMs
      })
    );
    const providerLatencyMs = Math.round(performance.now() - providerStartedAt);
    const transcript = await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${loaded.asset.id}, 0))`);
      const [existing] = await tx
        .select()
        .from(audioTranscripts)
        .where(
          and(
            eq(audioTranscripts.organizationId, this.context.organizationId),
            eq(audioTranscripts.transcriptionJobId, job.id)
          )
        )
        .limit(1);
      if (existing) return existing;
      const [versionRow] = await tx
        .select({ value: max(audioTranscripts.version) })
        .from(audioTranscripts)
        .where(
          and(
            eq(audioTranscripts.organizationId, this.context.organizationId),
            eq(audioTranscripts.audioAssetId, loaded.asset.id)
          )
        );
      const version = (versionRow?.value ?? 0) + 1;
      await tx
        .update(audioTranscripts)
        .set({ status: 'SUPERSEDED', updatedAt: new Date() })
        .where(
          and(
            eq(audioTranscripts.organizationId, this.context.organizationId),
            eq(audioTranscripts.audioAssetId, loaded.asset.id),
            eq(audioTranscripts.status, 'CURRENT')
          )
        );
      const [created] = await tx
        .insert(audioTranscripts)
        .values({
          organizationId: this.context.organizationId,
          audioAssetId: loaded.asset.id,
          transcriptionJobId: job.id,
          version,
          provider: this.provider.metadata.provider,
          model: output.model,
          text: output.text,
          language: output.language,
          confidence: output.confidence,
          inputTokens: output.usage.inputTokens,
          outputTokens: output.usage.outputTokens,
          audioDurationMs: output.usage.audioDurationMs,
          usageMeasurement: output.usage.measurement,
          estimatedCostMicros: estimateTranscriptionCost(output.usage, this.pricing)
        })
        .returning();
      if (!created) throw new Error('TRANSCRIPT_NOT_CREATED');
      await tx
        .update(audioAssets)
        .set({ status: 'TRANSCRIBED', failureCode: null, updatedAt: new Date() })
        .where(eq(audioAssets.id, loaded.asset.id));
      return created;
    });
    const audioToTranscriptMs = Math.max(
      0,
      transcript.createdAt.getTime() - loaded.asset.createdAt.getTime()
    );
    if (!loaded.asset.dealId)
      return { transcriptId: transcript.id, eventId: null, providerLatencyMs, audioToTranscriptMs };
    const ingestion = new CommercialIngestionService(this.db, this.context);
    const event = await ingestion.ingestCommercialEvent(
      {
        provider: 'morubi-audio-transcript',
        externalWorkspaceId: this.context.organizationId,
        externalId: transcript.id,
        idempotencyKey: `${transcript.id}:v${transcript.version}`,
        providerOccurredAt: loaded.asset.occurredAt,
        observedAt: new Date(),
        rawPayload: {
          audioAssetId: loaded.asset.id,
          transcriptId: transcript.id,
          version: transcript.version
        }
      },
      {
        contactId: loaded.asset.contactId,
        dealId: loaded.asset.dealId,
        conversationId: loaded.asset.conversationId,
        messageId: loaded.asset.messageId,
        audioTranscriptId: transcript.id,
        contentOrigin: 'AUDIO_TRANSCRIPT',
        actorType: loaded.asset.speakerType,
        source: commercialEventSourceFromProvider(loaded.asset.sourceProvider),
        type: 'MESSAGE',
        text: transcript.text,
        occurredAt: loaded.asset.occurredAt,
        metadata: {
          audioAssetId: loaded.asset.id,
          transcriptVersion: transcript.version,
          provider: transcript.provider,
          model: transcript.model
        }
      }
    );
    await new IntelligenceJobRepository(this.db, this.context).enqueue(event.id, job.correlationId);
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      await tx
        .insert(aiUsage)
        .values({
          organizationId: this.context.organizationId,
          audioAssetId: loaded.asset.id,
          audioTranscriptId: transcript.id,
          dealId: loaded.asset.dealId!,
          commercialEventId: event.id,
          conversationId: loaded.asset.conversationId,
          provider: transcript.provider,
          model: transcript.model,
          purpose: 'TRANSCRIPTION',
          success: true,
          retryCount: Math.max(0, job.attempts - 1),
          inputSize: loaded.asset.sizeBytes,
          outputSize: transcript.text.length,
          inputTokens: transcript.inputTokens,
          outputTokens: transcript.outputTokens,
          audioDurationMs: transcript.audioDurationMs,
          usageMeasurement: transcript.usageMeasurement,
          estimatedCostMicros: transcript.estimatedCostMicros
        })
        .onConflictDoNothing();
    });
    return {
      transcriptId: transcript.id,
      eventId: event.id,
      providerLatencyMs,
      audioToTranscriptMs
    };
  }
}

export function syntheticWavFixture(text: string, durationMs = 1_000): Uint8Array {
  const payload = new TextEncoder().encode(`MORUBI_FIXTURE:${text}\0`);
  const size = Math.max(Math.round((8000 * durationMs) / 1000), payload.byteLength);
  const data = new Uint8Array(44 + size);
  const view = new DataView(data.buffer);
  data.set(new TextEncoder().encode('RIFF'), 0);
  view.setUint32(4, data.length - 8, true);
  data.set(new TextEncoder().encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  data.set(new TextEncoder().encode('data'), 36);
  view.setUint32(40, size, true);
  data.set(payload, 44);
  return data;
}

export const devAudioScenarios = {
  PRICE:
    'O valor ficou acima do que eu esperava. VocÃª consegue explicar o retorno desse investimento?',
  TIMING: 'Gostei da proposta, mas precisamos resolver isso ainda neste mÃªs.',
  COMPETITOR: 'TambÃ©m estamos avaliando um concorrente e vamos comparar integraÃ§Ã£o e suporte.',
  BUYING_SIGNAL: 'Faz sentido para nÃ³s. Pode enviar os prÃ³ximos passos e a minuta?',
  NEUTRAL: 'Obrigado pela conversa. Vou revisar o material com calma.'
} as const;
