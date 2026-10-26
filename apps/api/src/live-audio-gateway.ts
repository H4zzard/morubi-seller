import WebSocket, { type RawData } from 'ws';
import type { ApiEnv } from '@morubi/config';
import type { LiveTranscriptTurnDto, LiveTranscriptionStatusDto } from '@morubi/contracts';
import { LiveCallRepository, type DatabaseHandle } from '@morubi/db';
import type { TenantContext } from '@morubi/domain';
import {
  decodeLiveAudioPacket,
  encodeLiveAudioAcknowledgement,
  liveAudioMimeType,
  type LiveAudioChunk,
  type RealtimeTranscriptTurn,
  type RealtimeTranscriptionProvider,
  type RealtimeTranscriptionStream,
  type RealtimeTranscriptionUsageSnapshot,
  type TransportAudioSource
} from '@morubi/live-calls';

interface ConnectionRecord {
  id: string;
  socket: WebSocket;
}

interface SequenceState {
  latest: Map<TransportAudioSource, number>;
  expiresAt: number;
}

export type LiveAudioServerMessage =
  | { type: 'ready'; sessionId: string }
  | { type: 'transcript'; turn: LiveTranscriptTurnDto }
  | { type: 'status'; status: LiveTranscriptionStatusDto }
  | { type: 'error'; code: string; recoverable: boolean };

function sendJson(socket: WebSocket, message: LiveAudioServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function rawBytes(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) {
    const buffer = Buffer.concat(data);
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error('LIVE_AUDIO_PACKET_INVALID');
}

function closeReason(code: string): string {
  return code.slice(0, 120);
}

export class LiveAudioGateway {
  private readonly active = new Map<string, ConnectionRecord>();
  private readonly sequences = new Map<string, SequenceState>();

  public constructor(
    private readonly database: DatabaseHandle,
    private readonly env: ApiEnv,
    private readonly provider: RealtimeTranscriptionProvider | null
  ) {}

  public available(): boolean {
    return Boolean(
      this.env.LIVE_CALLS_ENABLED &&
      this.env.LIVE_TRANSCRIPTION_ENABLED &&
      this.env.GEMINI_TRANSCRIPTION_ENABLED &&
      this.provider
    );
  }

  public async accept(
    socket: WebSocket,
    context: TenantContext,
    sessionId: string,
    correlationId: string
  ): Promise<void> {
    if (!this.available() || !this.provider) {
      socket.close(4403, closeReason('LIVE_TRANSCRIPTION_UNAVAILABLE'));
      return;
    }
    const repository = new LiveCallRepository(this.database.db, context, true);
    const [session, settings] = await Promise.all([
      repository.get(sessionId),
      repository.settings({ liveTranscriptionEnabled: this.env.LIVE_TRANSCRIPTION_ENABLED })
    ]);
    if (
      !session ||
      session.sellerMembershipId !== context.membershipId ||
      session.status !== 'ACTIVE' ||
      session.transcriptionMode !== 'REALTIME'
    ) {
      socket.close(4404, closeReason('LIVE_TRANSCRIPTION_SESSION_INVALID'));
      return;
    }
    if (
      !settings.liveTranscriptionEnabled ||
      !session.consent?.transcriptionAuthorized ||
      !session.consent.captureSources.includes('LOCAL_MIC') ||
      !session.consent.captureSources.includes('SYSTEM_AUDIO')
    ) {
      socket.close(4403, closeReason('LIVE_TRANSCRIPTION_CONSENT_REQUIRED'));
      return;
    }

    const key = `${context.organizationId}:${sessionId}`;
    if (this.active.has(key)) {
      socket.close(4409, closeReason('LIVE_TRANSCRIPTION_CONNECTION_EXISTS'));
      return;
    }
    const organizationConnections = [...this.active.keys()].filter((candidate) =>
      candidate.startsWith(`${context.organizationId}:`)
    ).length;
    if (organizationConnections >= this.env.LIVE_AUDIO_MAX_CONNECTIONS_PER_ORG) {
      socket.close(4429, closeReason('LIVE_TRANSCRIPTION_ORGANIZATION_LIMIT'));
      return;
    }

    const connectionId = crypto.randomUUID();
    this.active.set(key, { id: connectionId, socket });
    const remembered = this.sequences.get(key);
    const latestSequence =
      remembered && remembered.expiresAt > Date.now()
        ? remembered.latest
        : new Map<TransportAudioSource, number>();
    const streams = new Map<TransportAudioSource, RealtimeTranscriptionStream>();
    let closed = false;
    let queuedBytes = 0;
    let processedAudioMs = 0;
    let flushedAudioSeconds = 0;
    let flushedCostMicros = 0n;
    let flushedInputTokens = 0;
    let flushedOutputTokens = 0;
    const providerUsage = new Map<TransportAudioSource, RealtimeTranscriptionUsageSnapshot>();
    let missingPackets = 0;
    let turnQueue = Promise.resolve();
    let packetQueue = Promise.resolve();

    const status = (state: LiveTranscriptionStatusDto['state'], message?: string) =>
      sendJson(socket, {
        type: 'status',
        status: {
          state,
          reconnects: 0,
          droppedChunks: missingPackets,
          gapDetected: missingPackets > 0,
          ...(message ? { message } : {})
        }
      });

    const flushUsage = async (): Promise<void> => {
      const totalSeconds = Math.floor(processedAudioMs / 1_000);
      const totalInputTokens = [...providerUsage.values()].reduce(
        (sum, usage) => sum + usage.inputTokens,
        0
      );
      const totalOutputTokens = [...providerUsage.values()].reduce(
        (sum, usage) => sum + usage.outputTokens,
        0
      );
      const hasActualUsage = totalInputTokens > 0 || totalOutputTokens > 0;
      const totalCost = hasActualUsage
        ? BigInt(
            Math.ceil(
              (totalInputTokens * this.env.GEMINI_LIVE_INPUT_COST_MICROS_PER_MILLION_TOKENS +
                totalOutputTokens * this.env.GEMINI_LIVE_OUTPUT_COST_MICROS_PER_MILLION_TOKENS) /
                1_000_000
            )
          )
        : BigInt(
            Math.ceil(
              (processedAudioMs * this.env.LIVE_TRANSCRIPTION_COST_MICROS_PER_MINUTE) / 60_000
            )
          );
      const audioProcessedSeconds = totalSeconds - flushedAudioSeconds;
      const estimatedCostMicros = totalCost - flushedCostMicros;
      const inputTokens = totalInputTokens - flushedInputTokens;
      const outputTokens = totalOutputTokens - flushedOutputTokens;
      if (
        audioProcessedSeconds <= 0 &&
        estimatedCostMicros <= 0n &&
        inputTokens <= 0 &&
        outputTokens <= 0
      )
        return;
      await repository.recordTranscriptionUsage(sessionId, {
        provider: this.provider!.metadata.provider,
        model: this.provider!.metadata.model,
        audioProcessedSeconds,
        estimatedCostMicros,
        inputTokens,
        outputTokens,
        usageMeasurement: hasActualUsage ? 'ACTUAL' : 'ESTIMATED'
      });
      flushedAudioSeconds = totalSeconds;
      flushedCostMicros = totalCost;
      flushedInputTokens = totalInputTokens;
      flushedOutputTokens = totalOutputTokens;
    };

    const transcriptDto = (turn: RealtimeTranscriptTurn): LiveTranscriptTurnDto => ({
      id: turn.clientTurnId,
      sessionId,
      clientTurnId: turn.clientTurnId,
      speakerRole: turn.speakerRole,
      speakerOrigin: turn.speakerOrigin,
      speakerConfidence: turn.speakerConfidence,
      text: turn.text,
      isPartial: turn.isPartial,
      isFinal: turn.isFinal,
      startedAt: turn.startedAt.toISOString(),
      endedAt: turn.endedAt?.toISOString() ?? null,
      confidence: turn.confidence,
      provider: this.provider!.metadata.provider,
      model: this.provider!.metadata.model,
      sequence: turn.sequence,
      commercialEventId: null,
      transcriptFinalAt: turn.isFinal ? new Date().toISOString() : null
    });

    const receiveTurn = (turn: RealtimeTranscriptTurn): void => {
      const sourceOffset = turn.speakerOrigin === 'SYSTEM_AUDIO' ? 1 : 0;
      const normalized = { ...turn, sequence: turn.sequence * 2 + sourceOffset };
      if (!normalized.isFinal) {
        sendJson(socket, { type: 'transcript', turn: transcriptDto(normalized) });
        return;
      }
      turnQueue = turnQueue
        .then(async () => {
          const durationMs = Math.max(
            0,
            (normalized.endedAt?.getTime() ?? normalized.startedAt.getTime()) -
              normalized.startedAt.getTime()
          );
          const result = await repository.acceptTurn(
            sessionId,
            {
              ...normalized,
              provider: this.provider!.metadata.provider,
              model: this.provider!.metadata.model,
              audioProcessedMs: 0,
              estimatedCostMicros: 0n,
              endedAt: normalized.endedAt ?? new Date(normalized.startedAt.getTime() + durationMs)
            },
            correlationId,
            { emitCommercialEvent: false }
          );
          sendJson(socket, { type: 'transcript', turn: result.turn });
        })
        .catch(() => {
          sendJson(socket, {
            type: 'error',
            code: 'TRANSCRIPT_PERSISTENCE_FAILED',
            recoverable: true
          });
          status('UNSTABLE', 'Algumas falas podem não ter sido salvas.');
        });
    };

    const streamFor = async (
      source: TransportAudioSource
    ): Promise<RealtimeTranscriptionStream> => {
      const existing = streams.get(source);
      if (existing) return existing;
      const opened = await this.provider!.open(
        {
          sessionId,
          language: 'pt-BR',
          onUsage: (usage) => providerUsage.set(source, usage)
        },
        receiveTurn
      );
      streams.set(source, opened);
      return opened;
    };

    const handlePacket = async (data: RawData): Promise<void> => {
      const packet = decodeLiveAudioPacket(rawBytes(data), this.env.LIVE_AUDIO_MAX_PACKET_BYTES);
      const now = Date.now();
      const startedAt = session.startedAt ? new Date(session.startedAt).getTime() : now;
      if (packet.capturedAtMs < startedAt - 30_000 || packet.capturedAtMs > now + 10_000)
        throw new Error('LIVE_AUDIO_TIMESTAMP_OUT_OF_RANGE');
      const expectedBytes = Math.round(
        (packet.durationMs * packet.sampleRate * packet.channels * 2) / 1_000
      );
      if (Math.abs(expectedBytes - packet.data.byteLength) > 32)
        throw new Error('LIVE_AUDIO_DURATION_MISMATCH');
      const previous = latestSequence.get(packet.source);
      if (previous !== undefined && packet.sequence <= previous) {
        socket.send(encodeLiveAudioAcknowledgement(packet.source, packet.sequence), {
          binary: true
        });
        return;
      }
      if (previous !== undefined && packet.sequence > previous + 1) {
        missingPackets += packet.sequence - previous - 1;
        status('UNSTABLE', 'A conexão perdeu um pequeno trecho de áudio.');
      }
      latestSequence.set(packet.source, packet.sequence);
      const chunk: LiveAudioChunk = {
        id: `${sessionId}:${packet.source}:${packet.sequence}`,
        sequence: packet.sequence,
        capturedAt: new Date(packet.capturedAtMs),
        durationMs: packet.durationMs,
        mimeType: liveAudioMimeType,
        source: packet.source,
        data: packet.data
      };
      await (await streamFor(packet.source)).accept(chunk);
      processedAudioMs += packet.durationMs;
      socket.send(encodeLiveAudioAcknowledgement(packet.source, packet.sequence), { binary: true });
    };

    const usageTimer = setInterval(() => void flushUsage().catch(() => undefined), 10_000);
    usageTimer.unref();
    const sessionTimer = setTimeout(
      () => socket.close(4408, closeReason('LIVE_TRANSCRIPTION_DURATION_LIMIT')),
      this.env.LIVE_AUDIO_MAX_SESSION_MINUTES * 60_000
    );
    sessionTimer.unref();
    const heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.ping();
    }, 15_000);
    heartbeat.unref();

    const cleanup = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      clearInterval(usageTimer);
      clearInterval(heartbeat);
      clearTimeout(sessionTimer);
      const current = this.active.get(key);
      if (current?.id === connectionId) this.active.delete(key);
      this.sequences.set(key, { latest: latestSequence, expiresAt: Date.now() + 120_000 });
      await packetQueue.catch(() => undefined);
      await Promise.allSettled([...streams.values()].map((stream) => stream.close()));
      await turnQueue.catch(() => undefined);
      await flushUsage().catch(() => undefined);
    };

    socket.on('message', (data, isBinary) => {
      if (!isBinary || closed) {
        socket.close(4400, closeReason('LIVE_AUDIO_BINARY_REQUIRED'));
        return;
      }
      queuedBytes += rawBytes(data).byteLength;
      if (queuedBytes > settings.maxBufferBytes) {
        socket.close(4429, closeReason('LIVE_AUDIO_BACKPRESSURE_LIMIT'));
        return;
      }
      packetQueue = packetQueue
        .then(() => handlePacket(data))
        .catch((error: unknown) => {
          const code = error instanceof Error ? error.message : 'LIVE_AUDIO_PACKET_FAILED';
          sendJson(socket, { type: 'error', code, recoverable: false });
          socket.close(4400, closeReason(code));
        })
        .finally(() => {
          queuedBytes = Math.max(0, queuedBytes - rawBytes(data).byteLength);
        });
    });
    socket.once('close', () => void cleanup());
    socket.once('error', () => void cleanup());
    sendJson(socket, { type: 'ready', sessionId });
    status('CONNECTED');
  }
}
