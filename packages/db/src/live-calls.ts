import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type {
  LiveCallDetailDto,
  LiveCallSessionDto,
  LiveCallSettingsDto,
  LiveCallTurnResultDto,
  LiveTranscriptTurnDto,
  MeetingProvider
} from '@morubi/contracts';
import type { TenantContext } from '@morubi/domain';
import { errors } from '@morubi/domain';
import {
  HeuristicCallPhaseDetector,
  emptyLiveCallMemory,
  updateLiveCallMemory
} from '@morubi/live-calls';
import { CommercialIngestionService } from './commercial-ingestion.js';
import { IntelligenceJobRepository } from './copilot.js';
import type { MorubiDatabase } from './database.js';
import {
  aiDecisions,
  aiUsage,
  callConsentRecords,
  callUsage,
  commercialEvents,
  contacts,
  conversations,
  deals,
  intelligenceSettings,
  interventionDeliveries,
  interventionCandidates,
  liveCallSessions,
  liveTranscriptTurns
} from './schema.js';
import { setTenantContext } from './tenant.js';

type DatabaseTransaction = Parameters<Parameters<MorubiDatabase['transaction']>[0]>[0];
type SessionStatus = typeof liveCallSessions.$inferSelect.status;

const activeStatuses: readonly SessionStatus[] = ['STARTING', 'ACTIVE', 'ENDING'];

export const allowedLiveSessionTransitions: Record<SessionStatus, readonly SessionStatus[]> = {
  DETECTED: ['READY', 'STARTING', 'CANCELLED', 'FAILED'],
  READY: ['STARTING', 'CANCELLED', 'FAILED'],
  STARTING: ['ACTIVE', 'ENDING', 'FAILED', 'CANCELLED'],
  ACTIVE: ['ENDING', 'FAILED'],
  ENDING: ['ENDED', 'FAILED'],
  ENDED: [],
  FAILED: [],
  CANCELLED: []
};

export function assertLiveSessionTransition(from: SessionStatus, to: SessionStatus): void {
  if (!allowedLiveSessionTransitions[from].includes(to))
    throw new Error(`LIVE_SESSION_INVALID_TRANSITION:${from}:${to}`);
}

export function liveCommercialEventSource(provider: MeetingProvider): 'MEET' | 'ZOOM' | 'OTHER' {
  if (provider === 'MEET') return 'MEET';
  if (provider === 'ZOOM') return 'ZOOM';
  return 'OTHER';
}

function sessionDto(row: typeof liveCallSessions.$inferSelect): LiveCallSessionDto {
  return {
    id: row.id,
    sellerMembershipId: row.sellerMembershipId,
    dealId: row.dealId,
    contactId: row.contactId,
    conversationId: row.conversationId,
    calendarEventId: row.calendarEventId,
    meetingProvider: row.provider,
    meetingExternalId: row.meetingExternalId,
    meetingTitle: row.meetingTitle,
    status: row.status,
    captureMode: row.captureMode,
    transcriptionMode: row.transcriptionMode,
    currentPhase: row.currentPhase,
    phaseConfidence: row.phaseConfidence,
    phaseOrigin: row.phaseOrigin,
    memory: row.memory,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    lastHeartbeatAt: row.lastHeartbeatAt?.toISOString() ?? null,
    failureCode: row.failureCode,
    detectionConfidence: row.detectionConfidence,
    detectionEvidence: row.detectionEvidence,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function turnDto(row: typeof liveTranscriptTurns.$inferSelect): LiveTranscriptTurnDto {
  return {
    id: row.id,
    sessionId: row.liveCallSessionId,
    clientTurnId: row.clientTurnId,
    speakerRole: row.speakerRole,
    speakerOrigin: row.speakerOrigin,
    speakerConfidence: row.speakerConfidence,
    text: row.text,
    isPartial: row.isPartial,
    isFinal: row.isFinal,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    confidence: row.confidence,
    provider: row.provider,
    model: row.model,
    sequence: row.sequence,
    commercialEventId: row.commercialEventId,
    transcriptFinalAt: row.transcriptFinalAt?.toISOString() ?? null
  };
}

function canManageSession(context: TenantContext, sellerMembershipId: string): boolean {
  return context.role !== 'SELLER' || context.membershipId === sellerMembershipId;
}

export interface CreateLiveCallInput {
  meetingProvider: MeetingProvider;
  meetingExternalId?: string | undefined;
  meetingTitle?: string | undefined;
  dealId?: string | undefined;
  contactId?: string | undefined;
  conversationId?: string | undefined;
  calendarEventId?: string | undefined;
  detectionConfidence: number;
  detectionEvidence: string;
}

export interface StartLiveCallInput {
  consentMode: 'MANUAL_CONFIRMATION' | 'ORGANIZATION_POLICY';
  policyVersion: string;
  captureMode: 'MICROPHONE' | 'SYSTEM_AUDIO' | 'MIXED' | 'FIXTURE';
  transcriptionMode: 'REALTIME' | 'FIXTURE';
  captureSources: string[];
}

export interface LinkLiveCallContextInput {
  dealId?: string | undefined;
  contactId?: string | undefined;
  conversationId?: string | undefined;
  calendarEventId?: string | undefined;
}

export interface AcceptLiveTurnInput {
  clientTurnId: string;
  speakerRole: 'SELLER' | 'LEAD' | 'UNKNOWN';
  speakerOrigin: string;
  speakerConfidence: number;
  text: string;
  isPartial: boolean;
  isFinal: boolean;
  startedAt: Date;
  endedAt: Date | null;
  confidence: number | null;
  provider: string;
  model: string;
  sequence: number;
  audioProcessedMs: number;
  estimatedCostMicros: bigint;
}

export class LiveCallRepository {
  private readonly phaseDetector = new HeuristicCallPhaseDetector();

  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext,
    private readonly environmentEnabled = true
  ) {}

  private run<T>(operation: (tx: DatabaseTransaction) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      return operation(tx);
    });
  }

  public async settings(defaults?: Partial<LiveCallSettingsDto>): Promise<LiveCallSettingsDto> {
    return this.run(async (tx) => {
      const [row] = await tx
        .select()
        .from(intelligenceSettings)
        .where(eq(intelligenceSettings.organizationId, this.context.organizationId))
        .limit(1);
      return {
        callCaptureEnabled: row?.liveCallsEnabled ?? defaults?.callCaptureEnabled ?? false,
        meetDetectionEnabled: row?.meetDetectionEnabled ?? defaults?.meetDetectionEnabled ?? false,
        zoomDetectionEnabled: row?.zoomDetectionEnabled ?? defaults?.zoomDetectionEnabled ?? false,
        liveTranscriptionEnabled:
          row?.liveTranscriptionEnabled ?? defaults?.liveTranscriptionEnabled ?? false,
        liveCopilotEnabled: row?.liveCopilotEnabled ?? defaults?.liveCopilotEnabled ?? false,
        liveGenerationEnabled:
          row?.liveGenerationEnabled ?? defaults?.liveGenerationEnabled ?? false,
        autoStartEnabled: row?.callAutoStartEnabled ?? defaults?.autoStartEnabled ?? false,
        rawAudioRetentionDays:
          row?.rawLiveAudioRetentionDays ?? defaults?.rawAudioRetentionDays ?? 0,
        transcriptRetentionDays:
          row?.liveTranscriptRetentionDays ?? defaults?.transcriptRetentionDays ?? 90,
        maxBufferBytes: row?.liveMaxBufferBytes ?? defaults?.maxBufferBytes ?? 4_194_304,
        turnAggregationGapMs:
          row?.liveTurnAggregationGapMs ?? defaults?.turnAggregationGapMs ?? 1_200,
        liveCardTtlSeconds: row?.liveCardTtlSeconds ?? defaults?.liveCardTtlSeconds ?? 20
      };
    });
  }

  public async updateSettings(input: LiveCallSettingsDto): Promise<LiveCallSettingsDto> {
    if (input.autoStartEnabled && input.rawAudioRetentionDays > 0)
      throw new Error('AUTO_START_WITH_RAW_RETENTION_NOT_ALLOWED');
    return this.run(async (tx) => {
      await tx
        .insert(intelligenceSettings)
        .values({
          organizationId: this.context.organizationId,
          thresholds: {
            objection: 0.7,
            risk: 0.75,
            buyingSignal: 0.7,
            intervention: 0.65,
            stateUpdate: 0.65,
            memoryUpdate: 0.8
          },
          liveCallsEnabled: input.callCaptureEnabled,
          meetDetectionEnabled: input.meetDetectionEnabled,
          zoomDetectionEnabled: input.zoomDetectionEnabled,
          liveTranscriptionEnabled: input.liveTranscriptionEnabled,
          liveCopilotEnabled: input.liveCopilotEnabled,
          liveGenerationEnabled: input.liveGenerationEnabled,
          callAutoStartEnabled: input.autoStartEnabled,
          rawLiveAudioRetentionDays: input.rawAudioRetentionDays,
          liveTranscriptRetentionDays: input.transcriptRetentionDays,
          liveMaxBufferBytes: input.maxBufferBytes,
          liveTurnAggregationGapMs: input.turnAggregationGapMs,
          liveCardTtlSeconds: input.liveCardTtlSeconds
        })
        .onConflictDoUpdate({
          target: intelligenceSettings.organizationId,
          set: {
            liveCallsEnabled: input.callCaptureEnabled,
            meetDetectionEnabled: input.meetDetectionEnabled,
            zoomDetectionEnabled: input.zoomDetectionEnabled,
            liveTranscriptionEnabled: input.liveTranscriptionEnabled,
            liveCopilotEnabled: input.liveCopilotEnabled,
            liveGenerationEnabled: input.liveGenerationEnabled,
            callAutoStartEnabled: input.autoStartEnabled,
            rawLiveAudioRetentionDays: input.rawAudioRetentionDays,
            liveTranscriptRetentionDays: input.transcriptRetentionDays,
            liveMaxBufferBytes: input.maxBufferBytes,
            liveTurnAggregationGapMs: input.turnAggregationGapMs,
            liveCardTtlSeconds: input.liveCardTtlSeconds,
            updatedAt: new Date()
          }
        });
      return input;
    });
  }

  public async create(input: CreateLiveCallInput): Promise<LiveCallSessionDto> {
    if (!this.environmentEnabled) throw errors.notFound();
    return this.run(async (tx) => {
      const [active] = await tx
        .select()
        .from(liveCallSessions)
        .where(
          and(
            eq(liveCallSessions.organizationId, this.context.organizationId),
            eq(liveCallSessions.sellerMembershipId, this.context.membershipId),
            inArray(liveCallSessions.status, [...activeStatuses])
          )
        )
        .limit(1);
      if (active) return sessionDto(active);

      let dealId = input.dealId ?? null;
      let contactId = input.contactId ?? null;
      let conversationId = input.conversationId ?? null;
      if (conversationId) {
        const [conversation] = await tx
          .select({
            id: conversations.id,
            dealId: conversations.dealId,
            contactId: conversations.primaryContactId
          })
          .from(conversations)
          .where(
            and(
              eq(conversations.organizationId, this.context.organizationId),
              eq(conversations.id, conversationId)
            )
          )
          .limit(1);
        if (!conversation) throw errors.notFound();
        if (dealId && conversation.dealId && dealId !== conversation.dealId)
          throw new Error('LIVE_CALL_CONTEXT_MISMATCH');
        dealId ??= conversation.dealId;
        contactId ??= conversation.contactId;
      }
      if (dealId) {
        const [deal] = await tx
          .select({ ownerMembershipId: deals.ownerMembershipId })
          .from(deals)
          .where(and(eq(deals.organizationId, this.context.organizationId), eq(deals.id, dealId)))
          .limit(1);
        if (
          !deal ||
          (this.context.role === 'SELLER' && deal.ownerMembershipId !== this.context.membershipId)
        )
          throw errors.notFound();
        if (!conversationId) {
          const [conversation] = await tx
            .select({ id: conversations.id, contactId: conversations.primaryContactId })
            .from(conversations)
            .where(
              and(
                eq(conversations.organizationId, this.context.organizationId),
                eq(conversations.dealId, dealId)
              )
            )
            .orderBy(desc(conversations.lastMessageAt), desc(conversations.createdAt))
            .limit(1);
          conversationId = conversation?.id ?? null;
          contactId ??= conversation?.contactId ?? null;
        }
      }
      if (contactId) {
        const [contact] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(
              eq(contacts.organizationId, this.context.organizationId),
              eq(contacts.id, contactId)
            )
          )
          .limit(1);
        if (!contact) throw errors.notFound();
      }
      const [created] = await tx
        .insert(liveCallSessions)
        .values({
          organizationId: this.context.organizationId,
          sellerMembershipId: this.context.membershipId,
          dealId,
          contactId,
          conversationId,
          calendarEventId: input.calendarEventId,
          provider: input.meetingProvider,
          meetingExternalId: input.meetingExternalId,
          meetingTitle: input.meetingTitle,
          status: 'DETECTED',
          memory: emptyLiveCallMemory(),
          detectionConfidence: input.detectionConfidence,
          detectionEvidence: input.detectionEvidence
        })
        .returning();
      if (!created) throw new Error('LIVE_SESSION_NOT_CREATED');
      return sessionDto(created);
    });
  }

  public async start(sessionId: string, input: StartLiveCallInput): Promise<LiveCallSessionDto> {
    if (!this.environmentEnabled) throw errors.notFound();
    return this.run(async (tx) => {
      const session = await this.loadOwnedForUpdate(tx, sessionId);
      const settings = await this.settingsInTransaction(tx);
      if (!settings.callCaptureEnabled || !settings.liveTranscriptionEnabled)
        throw new Error('LIVE_CALLS_DISABLED');
      if (input.consentMode === 'ORGANIZATION_POLICY' && !settings.autoStartEnabled)
        throw new Error('LIVE_AUTO_START_DISABLED');
      if (session.provider === 'MEET' && !settings.meetDetectionEnabled)
        throw new Error('MEET_DETECTION_DISABLED');
      if (session.provider === 'ZOOM' && !settings.zoomDetectionEnabled)
        throw new Error('ZOOM_DETECTION_DISABLED');
      assertLiveSessionTransition(session.status, 'STARTING');
      const now = new Date();
      await tx
        .insert(callConsentRecords)
        .values({
          organizationId: this.context.organizationId,
          liveCallSessionId: session.id,
          mode: input.consentMode,
          confirmedByMembershipId: this.context.membershipId,
          confirmedAt: now,
          policyVersion: input.policyVersion,
          captureSources: input.captureSources
        })
        .onConflictDoNothing();
      const [updated] = await tx
        .update(liveCallSessions)
        .set({
          status: 'ACTIVE',
          captureMode: input.captureMode,
          transcriptionMode: input.transcriptionMode,
          startedAt: session.startedAt ?? now,
          lastHeartbeatAt: now,
          failureCode: null,
          updatedAt: now
        })
        .where(eq(liveCallSessions.id, session.id))
        .returning();
      await tx
        .insert(callUsage)
        .values({
          organizationId: this.context.organizationId,
          liveCallSessionId: session.id,
          sellerMembershipId: session.sellerMembershipId,
          provider: input.transcriptionMode === 'FIXTURE' ? 'fixture-realtime' : 'realtime',
          model: input.transcriptionMode === 'FIXTURE' ? 'fixture-realtime-v1' : 'configured'
        })
        .onConflictDoNothing();
      return sessionDto(updated!);
    });
  }

  public async linkContext(
    sessionId: string,
    input: LinkLiveCallContextInput
  ): Promise<LiveCallSessionDto> {
    return this.run(async (tx) => {
      const session = await this.loadOwnedForUpdate(tx, sessionId);
      let dealId = input.dealId ?? session.dealId;
      let contactId = input.contactId ?? session.contactId;
      const conversationId = input.conversationId ?? session.conversationId;
      if (conversationId) {
        const [conversation] = await tx
          .select({
            dealId: conversations.dealId,
            contactId: conversations.primaryContactId
          })
          .from(conversations)
          .where(
            and(
              eq(conversations.organizationId, this.context.organizationId),
              eq(conversations.id, conversationId)
            )
          )
          .limit(1);
        if (!conversation) throw errors.notFound();
        if (dealId && conversation.dealId && dealId !== conversation.dealId)
          throw new Error('LIVE_CALL_CONTEXT_MISMATCH');
        dealId ??= conversation.dealId;
        contactId ??= conversation.contactId;
      }
      if (dealId) {
        const [deal] = await tx
          .select({ ownerMembershipId: deals.ownerMembershipId })
          .from(deals)
          .where(and(eq(deals.organizationId, this.context.organizationId), eq(deals.id, dealId)))
          .limit(1);
        if (
          !deal ||
          (this.context.role === 'SELLER' && deal.ownerMembershipId !== this.context.membershipId)
        )
          throw errors.notFound();
      }
      if (contactId) {
        const [contact] = await tx
          .select({ id: contacts.id })
          .from(contacts)
          .where(
            and(
              eq(contacts.organizationId, this.context.organizationId),
              eq(contacts.id, contactId)
            )
          )
          .limit(1);
        if (!contact) throw errors.notFound();
      }
      const [updated] = await tx
        .update(liveCallSessions)
        .set({
          dealId,
          contactId,
          conversationId,
          calendarEventId: input.calendarEventId ?? session.calendarEventId,
          updatedAt: new Date()
        })
        .where(eq(liveCallSessions.id, session.id))
        .returning();
      if (!updated) throw errors.notFound();
      return sessionDto(updated);
    });
  }

  public async heartbeat(
    sessionId: string,
    input: { bufferedBytes: number; droppedChunks: number }
  ): Promise<{ receivedAt: string; bufferAccepted: boolean }> {
    return this.run(async (tx) => {
      const session = await this.loadOwnedForUpdate(tx, sessionId);
      if (session.status !== 'ACTIVE') throw new Error('LIVE_SESSION_NOT_ACTIVE');
      const settings = await this.settingsInTransaction(tx);
      const now = new Date();
      await tx
        .update(liveCallSessions)
        .set({ lastHeartbeatAt: now, updatedAt: now })
        .where(eq(liveCallSessions.id, session.id));
      await tx
        .update(callUsage)
        .set({ droppedChunks: input.droppedChunks, updatedAt: now })
        .where(
          and(
            eq(callUsage.organizationId, this.context.organizationId),
            eq(callUsage.liveCallSessionId, session.id)
          )
        );
      return {
        receivedAt: now.toISOString(),
        bufferAccepted: input.bufferedBytes <= settings.maxBufferBytes
      };
    });
  }

  public async acceptTurn(
    sessionId: string,
    input: AcceptLiveTurnInput,
    correlationId: string
  ): Promise<LiveCallTurnResultDto> {
    const persisted = await this.run(async (tx) => {
      const session = await this.loadOwnedForUpdate(tx, sessionId);
      if (session.status !== 'ACTIVE') throw new Error('LIVE_SESSION_NOT_ACTIVE');
      const settings = await this.settingsInTransaction(tx);
      if (!settings.liveTranscriptionEnabled) throw new Error('LIVE_TRANSCRIPTION_DISABLED');
      const [existing] = await tx
        .select()
        .from(liveTranscriptTurns)
        .where(
          and(
            eq(liveTranscriptTurns.organizationId, this.context.organizationId),
            eq(liveTranscriptTurns.liveCallSessionId, session.id),
            eq(liveTranscriptTurns.clientTurnId, input.clientTurnId)
          )
        )
        .limit(1);
      if (existing?.isFinal) return { session, turn: existing, deduplicated: true };
      const now = new Date();
      const values = {
        organizationId: this.context.organizationId,
        liveCallSessionId: session.id,
        clientTurnId: input.clientTurnId,
        speakerRole: input.speakerRole,
        speakerOrigin: input.speakerOrigin,
        speakerConfidence: input.speakerConfidence,
        text: input.text,
        isPartial: input.isPartial,
        isFinal: input.isFinal,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        confidence: input.confidence,
        provider: input.provider,
        model: input.model,
        sequence: input.sequence,
        transcriptFinalAt: input.isFinal ? now : null,
        updatedAt: now
      };
      const [turn] = await tx
        .insert(liveTranscriptTurns)
        .values(values)
        .onConflictDoUpdate({
          target: [
            liveTranscriptTurns.organizationId,
            liveTranscriptTurns.liveCallSessionId,
            liveTranscriptTurns.clientTurnId
          ],
          set: values
        })
        .returning();
      if (!turn) throw new Error('LIVE_TURN_NOT_PERSISTED');
      if (input.isFinal) {
        const phase = this.phaseDetector.detect(input.text, session.currentPhase);
        const memory = updateLiveCallMemory(session.memory, {
          sequence: input.sequence,
          phase: phase.phase,
          phaseConfidence: phase.confidence
        });
        await tx
          .update(liveCallSessions)
          .set({
            currentPhase: phase.phase,
            phaseConfidence: phase.confidence,
            phaseOrigin: phase.origin,
            memory,
            lastHeartbeatAt: now,
            updatedAt: now
          })
          .where(eq(liveCallSessions.id, session.id));
        await tx
          .update(interventionDeliveries)
          .set({ status: 'EXPIRED', updatedAt: now })
          .where(
            and(
              eq(interventionDeliveries.organizationId, this.context.organizationId),
              eq(interventionDeliveries.liveCallSessionId, session.id),
              inArray(interventionDeliveries.status, ['CREATED', 'DELIVERED', 'VIEWED'])
            )
          );
        await tx
          .insert(callUsage)
          .values({
            organizationId: this.context.organizationId,
            liveCallSessionId: session.id,
            sellerMembershipId: session.sellerMembershipId,
            provider: input.provider,
            model: input.model,
            audioProcessedSeconds: Math.ceil(input.audioProcessedMs / 1_000),
            transcriptionInputUnits: 1,
            costTotalMicros: input.estimatedCostMicros
          })
          .onConflictDoUpdate({
            target: [callUsage.organizationId, callUsage.liveCallSessionId],
            set: {
              provider: input.provider,
              model: input.model,
              audioProcessedSeconds: sql`${callUsage.audioProcessedSeconds} + ${Math.ceil(input.audioProcessedMs / 1_000)}`,
              transcriptionInputUnits: sql`${callUsage.transcriptionInputUnits} + 1`,
              costTotalMicros: sql`${callUsage.costTotalMicros} + ${input.estimatedCostMicros}`,
              updatedAt: now
            }
          });
      }
      return { session, turn, deduplicated: false };
    });

    if (!persisted.turn.isFinal)
      return {
        turn: turnDto(persisted.turn),
        commercialEventId: null,
        intelligenceJobId: null,
        deduplicated: persisted.deduplicated
      };
    if (persisted.turn.commercialEventId)
      return {
        turn: turnDto(persisted.turn),
        commercialEventId: persisted.turn.commercialEventId,
        intelligenceJobId: null,
        deduplicated: true
      };

    const ingestion = new CommercialIngestionService(this.db, this.context);
    const event = await ingestion.ingestCommercialEvent(
      {
        provider: `morubi-live-${persisted.session.provider.toLowerCase()}`,
        externalWorkspaceId: this.context.organizationId,
        externalId: `${persisted.session.id}:${persisted.turn.clientTurnId}`,
        idempotencyKey: `${persisted.session.id}:${persisted.turn.clientTurnId}:final-v1`,
        providerOccurredAt: persisted.turn.startedAt,
        observedAt: new Date(),
        rawPayload: {
          liveCallSessionId: persisted.session.id,
          liveTranscriptTurnId: persisted.turn.id,
          sequence: persisted.turn.sequence
        }
      },
      {
        contactId: persisted.session.contactId,
        dealId: persisted.session.dealId,
        conversationId: persisted.session.conversationId,
        liveCallSessionId: persisted.session.id,
        liveTranscriptTurnId: persisted.turn.id,
        contentOrigin: 'CALL_TRANSCRIPT',
        actorType: persisted.turn.speakerRole,
        source: liveCommercialEventSource(persisted.session.provider),
        type: 'TRANSCRIPT',
        text: persisted.turn.text,
        occurredAt: persisted.turn.startedAt,
        metadata: {
          liveCallSessionId: persisted.session.id,
          liveTranscriptTurnId: persisted.turn.id,
          sequence: persisted.turn.sequence,
          speakerOrigin: persisted.turn.speakerOrigin,
          speakerConfidence: persisted.turn.speakerConfidence,
          transcriptUntrusted: true
        }
      }
    );
    await this.run(async (tx) => {
      await tx
        .update(liveTranscriptTurns)
        .set({ commercialEventId: event.id, updatedAt: new Date() })
        .where(
          and(
            eq(liveTranscriptTurns.organizationId, this.context.organizationId),
            eq(liveTranscriptTurns.id, persisted.turn.id)
          )
        );
    });
    const intelligenceJobId = persisted.session.dealId
      ? await new IntelligenceJobRepository(this.db, this.context).enqueue(
          event.id,
          correlationId,
          {
            priority: 100,
            source: 'LIVE_CALL',
            deadlineAt: new Date(Date.now() + 5_000)
          }
        )
      : null;
    return {
      turn: { ...turnDto(persisted.turn), commercialEventId: event.id },
      commercialEventId: event.id,
      intelligenceJobId,
      deduplicated: persisted.deduplicated
    };
  }

  public async end(sessionId: string): Promise<LiveCallSessionDto> {
    return this.run(async (tx) => {
      const session = await this.loadOwnedForUpdate(tx, sessionId);
      if (session.status === 'ENDED') return sessionDto(session);
      assertLiveSessionTransition(session.status, 'ENDING');
      const now = new Date();
      const duration = session.startedAt
        ? Math.max(0, Math.round((now.getTime() - session.startedAt.getTime()) / 1_000))
        : 0;
      const [updated] = await tx
        .update(liveCallSessions)
        .set({ status: 'ENDED', endedAt: now, lastHeartbeatAt: now, updatedAt: now })
        .where(eq(liveCallSessions.id, session.id))
        .returning();
      await tx
        .update(callUsage)
        .set({ callDurationSeconds: duration, updatedAt: now })
        .where(
          and(
            eq(callUsage.organizationId, this.context.organizationId),
            eq(callUsage.liveCallSessionId, session.id)
          )
        );
      return sessionDto(updated!);
    });
  }

  public async get(sessionId: string): Promise<LiveCallDetailDto | null> {
    return this.run(async (tx) => {
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
      if (!session || !canManageSession(this.context, session.sellerMembershipId)) return null;
      const [consent, usage, latestDelivery, turns, commercialContext] = await Promise.all([
        tx
          .select()
          .from(callConsentRecords)
          .where(
            and(
              eq(callConsentRecords.organizationId, this.context.organizationId),
              eq(callConsentRecords.liveCallSessionId, session.id)
            )
          )
          .limit(1),
        tx
          .select()
          .from(callUsage)
          .where(
            and(
              eq(callUsage.organizationId, this.context.organizationId),
              eq(callUsage.liveCallSessionId, session.id)
            )
          )
          .limit(1),
        tx
          .select({ latency: interventionDeliveries.endToEndLatencyMs })
          .from(interventionDeliveries)
          .where(
            and(
              eq(interventionDeliveries.organizationId, this.context.organizationId),
              eq(interventionDeliveries.liveCallSessionId, session.id)
            )
          )
          .orderBy(desc(interventionDeliveries.createdAt))
          .limit(1),
        tx
          .select()
          .from(liveTranscriptTurns)
          .where(
            and(
              eq(liveTranscriptTurns.organizationId, this.context.organizationId),
              eq(liveTranscriptTurns.liveCallSessionId, session.id)
            )
          )
          .orderBy(desc(liveTranscriptTurns.sequence), desc(liveTranscriptTurns.createdAt))
          .limit(100),
        tx
          .select({
            contactName: contacts.name,
            companyName: contacts.companyName,
            dealTitle: deals.title
          })
          .from(liveCallSessions)
          .leftJoin(
            contacts,
            and(
              eq(contacts.organizationId, liveCallSessions.organizationId),
              eq(contacts.id, liveCallSessions.contactId)
            )
          )
          .leftJoin(
            deals,
            and(
              eq(deals.organizationId, liveCallSessions.organizationId),
              eq(deals.id, liveCallSessions.dealId)
            )
          )
          .where(
            and(
              eq(liveCallSessions.organizationId, this.context.organizationId),
              eq(liveCallSessions.id, session.id)
            )
          )
          .limit(1)
      ]);
      const usageRow = usage[0];
      return {
        ...sessionDto(session),
        context: {
          contactName: commercialContext[0]?.contactName ?? null,
          companyName: commercialContext[0]?.companyName ?? null,
          dealTitle: commercialContext[0]?.dealTitle ?? null
        },
        consent: consent[0]
          ? {
              mode: consent[0].mode,
              confirmedAt: consent[0].confirmedAt.toISOString(),
              policyVersion: consent[0].policyVersion,
              captureSources: consent[0].captureSources
            }
          : null,
        turns: turns.reverse().map(turnDto),
        metrics: {
          callDurationSeconds: usageRow?.callDurationSeconds ?? 0,
          audioProcessedSeconds: usageRow?.audioProcessedSeconds ?? 0,
          decisionCount: usageRow?.decisionCount ?? 0,
          generationCount: usageRow?.generationCount ?? 0,
          cardsDelivered: usageRow?.cardsDelivered ?? 0,
          droppedChunks: usageRow?.droppedChunks ?? 0,
          costTotalMicros: (usageRow?.costTotalMicros ?? 0n).toString(),
          speechToCardMs: latestDelivery[0]?.latency ?? null
        }
      };
    });
  }

  public async current(): Promise<LiveCallDetailDto | null> {
    const sessionId = await this.run(async (tx) => {
      const [session] = await tx
        .select({ id: liveCallSessions.id })
        .from(liveCallSessions)
        .where(
          and(
            eq(liveCallSessions.organizationId, this.context.organizationId),
            eq(liveCallSessions.sellerMembershipId, this.context.membershipId),
            inArray(liveCallSessions.status, ['DETECTED', 'READY', ...activeStatuses])
          )
        )
        .orderBy(desc(liveCallSessions.createdAt))
        .limit(1);
      return session?.id ?? null;
    });
    return sessionId ? this.get(sessionId) : null;
  }

  public async recordDecision(sessionId: string, delivered: boolean): Promise<void> {
    await this.run(async (tx) => {
      await tx
        .update(callUsage)
        .set({
          decisionCount: sql`${callUsage.decisionCount} + 1`,
          cardsDelivered: delivered
            ? sql`${callUsage.cardsDelivered} + 1`
            : callUsage.cardsDelivered,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(callUsage.organizationId, this.context.organizationId),
            eq(callUsage.liveCallSessionId, sessionId)
          )
        );
    });
  }

  public async recordDecisionForEvent(
    commercialEventId: string,
    decisionId: string,
    deliveryId: string | null
  ): Promise<void> {
    await this.run(async (tx) => {
      const [row] = await tx
        .select({
          session: liveCallSessions,
          turnSequence: liveTranscriptTurns.sequence,
          actorType: commercialEvents.actorType,
          decision: aiDecisions.output,
          decisionCostMicros: aiUsage.estimatedCostMicros
        })
        .from(commercialEvents)
        .innerJoin(
          liveCallSessions,
          and(
            eq(liveCallSessions.organizationId, commercialEvents.organizationId),
            eq(liveCallSessions.id, commercialEvents.liveCallSessionId)
          )
        )
        .leftJoin(
          liveTranscriptTurns,
          and(
            eq(liveTranscriptTurns.organizationId, commercialEvents.organizationId),
            eq(liveTranscriptTurns.id, commercialEvents.liveTranscriptTurnId)
          )
        )
        .innerJoin(
          aiDecisions,
          and(
            eq(aiDecisions.organizationId, commercialEvents.organizationId),
            eq(aiDecisions.id, decisionId)
          )
        )
        .leftJoin(
          aiUsage,
          and(
            eq(aiUsage.organizationId, aiDecisions.organizationId),
            eq(aiUsage.aiDecisionId, aiDecisions.id)
          )
        )
        .where(
          and(
            eq(commercialEvents.organizationId, this.context.organizationId),
            eq(commercialEvents.id, commercialEventId)
          )
        )
        .limit(1);
      if (!row) return;
      const decision = row.decision;
      const stateUpdate = decision.stateUpdates.find((update) => update.operation !== 'REMOVE');
      const memory = updateLiveCallMemory(row.session.memory, {
        sequence: row.turnSequence ?? row.session.memory.lastSequence,
        ...(decision.objection ? { objection: `Objeção: ${decision.objection}` } : {}),
        ...(decision.buyingSignal ? { buyingSignal: decision.buyingSignal } : {}),
        ...(decision.eventClassification === 'QUESTION'
          ? { openQuestion: 'Pergunta aberta detectada' }
          : {}),
        ...(row.actorType === 'SELLER' && stateUpdate
          ? { sellerAction: `${stateUpdate.field}: ${String(stateUpdate.value)}` }
          : {}),
        interventionId: deliveryId
      });
      await tx
        .update(liveCallSessions)
        .set({ memory, updatedAt: new Date() })
        .where(eq(liveCallSessions.id, row.session.id));
      await tx
        .update(callUsage)
        .set({
          decisionCount: sql`${callUsage.decisionCount} + 1`,
          cardsDelivered: deliveryId
            ? sql`${callUsage.cardsDelivered} + 1`
            : callUsage.cardsDelivered,
          costTotalMicros: sql`${callUsage.costTotalMicros} + ${row.decisionCostMicros ?? 0n}`,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(callUsage.organizationId, this.context.organizationId),
            eq(callUsage.liveCallSessionId, row.session.id)
          )
        );
    });
  }

  public async recordGenerationForCandidate(candidateId: string): Promise<void> {
    await this.run(async (tx) => {
      const [row] = await tx
        .select({
          sessionId: commercialEvents.liveCallSessionId,
          generationCostMicros: aiUsage.estimatedCostMicros
        })
        .from(interventionCandidates)
        .innerJoin(
          commercialEvents,
          and(
            eq(commercialEvents.organizationId, interventionCandidates.organizationId),
            eq(commercialEvents.id, interventionCandidates.commercialEventId)
          )
        )
        .leftJoin(
          aiUsage,
          and(
            eq(aiUsage.organizationId, interventionCandidates.organizationId),
            eq(aiUsage.interventionCandidateId, interventionCandidates.id),
            eq(aiUsage.purpose, 'GENERATION')
          )
        )
        .where(
          and(
            eq(interventionCandidates.organizationId, this.context.organizationId),
            eq(interventionCandidates.id, candidateId)
          )
        )
        .limit(1);
      if (!row?.sessionId) return;
      await tx
        .update(callUsage)
        .set({
          generationCount: sql`${callUsage.generationCount} + 1`,
          costTotalMicros: sql`${callUsage.costTotalMicros} + ${row.generationCostMicros ?? 0n}`,
          updatedAt: new Date()
        })
        .where(
          and(
            eq(callUsage.organizationId, this.context.organizationId),
            eq(callUsage.liveCallSessionId, row.sessionId)
          )
        );
    });
  }

  private async loadOwnedForUpdate(tx: DatabaseTransaction, sessionId: string) {
    const [session] = await tx
      .select()
      .from(liveCallSessions)
      .where(
        and(
          eq(liveCallSessions.organizationId, this.context.organizationId),
          eq(liveCallSessions.id, sessionId)
        )
      )
      .limit(1)
      .for('update');
    if (!session || !canManageSession(this.context, session.sellerMembershipId))
      throw errors.notFound();
    return session;
  }

  private async settingsInTransaction(tx: DatabaseTransaction): Promise<LiveCallSettingsDto> {
    const [row] = await tx
      .select()
      .from(intelligenceSettings)
      .where(eq(intelligenceSettings.organizationId, this.context.organizationId))
      .limit(1);
    return {
      callCaptureEnabled: row?.liveCallsEnabled ?? false,
      meetDetectionEnabled: row?.meetDetectionEnabled ?? false,
      zoomDetectionEnabled: row?.zoomDetectionEnabled ?? false,
      liveTranscriptionEnabled: row?.liveTranscriptionEnabled ?? false,
      liveCopilotEnabled: row?.liveCopilotEnabled ?? false,
      liveGenerationEnabled: row?.liveGenerationEnabled ?? false,
      autoStartEnabled: row?.callAutoStartEnabled ?? false,
      rawAudioRetentionDays: row?.rawLiveAudioRetentionDays ?? 0,
      transcriptRetentionDays: row?.liveTranscriptRetentionDays ?? 90,
      maxBufferBytes: row?.liveMaxBufferBytes ?? 4_194_304,
      turnAggregationGapMs: row?.liveTurnAggregationGapMs ?? 1_200,
      liveCardTtlSeconds: row?.liveCardTtlSeconds ?? 20
    };
  }
}

export async function expireStaleLiveSessions(
  db: MorubiDatabase,
  staleBefore = new Date(Date.now() - 60_000)
): Promise<number> {
  const rows = await db
    .update(liveCallSessions)
    .set({
      status: 'FAILED',
      failureCode: 'HEARTBEAT_STALE',
      endedAt: new Date(),
      updatedAt: new Date()
    })
    .where(
      and(
        inArray(liveCallSessions.status, ['STARTING', 'ACTIVE', 'ENDING']),
        sql`${liveCallSessions.lastHeartbeatAt} < ${staleBefore}`
      )
    )
    .returning({ id: liveCallSessions.id });
  return rows.length;
}
