import WebSocket from 'ws';
import {
  liveAudioChannels,
  liveAudioMimeType,
  type LiveAudioChunk,
  type RealtimeTranscriptTurn,
  type RealtimeTranscriptionProvider,
  type RealtimeTranscriptionStream,
  type RealtimeTranscriptionUsageSnapshot,
  type TransportAudioSource
} from '@morubi/live-calls';

export interface GeminiRealtimeTranscriptionConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  language?: string;
  configVersion: string;
  connectTimeoutMs?: number;
  sessionRenewalMs?: number;
}

export interface GeminiRealtimeSocket {
  readonly readyState: number;
  on(event: 'open' | 'close' | 'error' | 'message', listener: (...args: unknown[]) => void): this;
  off(event: 'open' | 'close' | 'error' | 'message', listener: (...args: unknown[]) => void): this;
  send(data: string, callback: (error?: Error) => void): void;
  close(code?: number, reason?: string): void;
}

export type GeminiRealtimeSocketFactory = (url: string, apiKey: string) => GeminiRealtimeSocket;

interface ProviderConnection {
  socket: GeminiRealtimeSocket;
  openedAt: number;
  send(chunk: LiveAudioChunk): Promise<void>;
  finish(): Promise<void>;
}

interface TranscriptPayload {
  text?: unknown;
}

function normalizeWebSocketBase(value: string): string {
  const url = new URL(value);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  if (url.protocol === 'http:') url.protocol = 'ws:';
  if (url.protocol !== 'wss:' && url.protocol !== 'ws:')
    throw new Error('GEMINI_LIVE_BASE_URL_INVALID');
  return url.toString().replace(/\/$/, '');
}

function defaultSocketFactory(url: string, apiKey: string): GeminiRealtimeSocket {
  return new WebSocket(url, { headers: { 'x-goog-api-key': apiKey } });
}

function rawText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8');
  if (Array.isArray(value)) return Buffer.concat(value).toString('utf8');
  if (value instanceof ArrayBuffer) return Buffer.from(value).toString('utf8');
  if (ArrayBuffer.isView(value))
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('utf8');
  return '';
}

function sourceSpeaker(
  source: TransportAudioSource
): Pick<RealtimeTranscriptTurn, 'speakerRole' | 'speakerOrigin' | 'speakerConfidence'> {
  return source === 'LOCAL_MIC'
    ? { speakerRole: 'SELLER', speakerOrigin: 'LOCAL_MIC', speakerConfidence: 1 }
    : { speakerRole: 'UNKNOWN', speakerOrigin: 'SYSTEM_AUDIO', speakerConfidence: 1 };
}

export class GeminiRealtimeTranscriptionProvider implements RealtimeTranscriptionProvider {
  public readonly metadata;

  public constructor(
    private readonly config: GeminiRealtimeTranscriptionConfig,
    private readonly socketFactory: GeminiRealtimeSocketFactory = defaultSocketFactory
  ) {
    if (!config.apiKey.trim()) throw new Error('GEMINI_API_KEY_REQUIRED');
    this.metadata = {
      provider: 'gemini-live',
      model: config.model ?? 'gemini-3.5-transcribe-live',
      configVersion: config.configVersion
    };
  }

  public async open(
    input: {
      sessionId: string;
      language?: string;
      onUsage?: (usage: RealtimeTranscriptionUsageSnapshot) => void;
    },
    onTurn: (turn: RealtimeTranscriptTurn) => void
  ): Promise<RealtimeTranscriptionStream> {
    let closed = false;
    let connection: ProviderConnection | null = null;
    let renewal: Promise<void> | null = null;
    let source: TransportAudioSource | null = null;
    let utteranceOrdinal = 0;
    let utteranceStartedAt: Date | null = null;
    let latestAudioAt: Date | null = null;
    let accumulatedInputTokens = 0;
    let accumulatedOutputTokens = 0;

    const emit = (payload: TranscriptPayload, final: boolean): void => {
      const text = typeof payload.text === 'string' ? payload.text.trim() : '';
      if (!text || !source || !utteranceStartedAt) return;
      const endedAt = latestAudioAt ?? utteranceStartedAt;
      const clientTurnId = `${input.sessionId}:${source}:${utteranceOrdinal}`;
      onTurn({
        clientTurnId,
        ...sourceSpeaker(source),
        text,
        isPartial: !final,
        isFinal: final,
        startedAt: utteranceStartedAt,
        endedAt: final ? endedAt : null,
        confidence: null,
        sequence: utteranceOrdinal
      });
      if (final) {
        utteranceOrdinal += 1;
        utteranceStartedAt = null;
        latestAudioAt = null;
      }
    };

    const createConnection = async (): Promise<ProviderConnection> => {
      const base = normalizeWebSocketBase(
        this.config.baseUrl ?? 'wss://generativelanguage.googleapis.com'
      );
      const socket = this.socketFactory(
        `${base}/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent`,
        this.config.apiKey
      );
      const timeoutMs = this.config.connectTimeoutMs ?? 10_000;
      let setupComplete = false;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          cleanup();
          socket.close(4000, 'setup timeout');
          reject(new Error('GEMINI_LIVE_CONNECT_TIMEOUT'));
        }, timeoutMs);
        const cleanup = () => {
          clearTimeout(timer);
          socket.off('open', onOpen);
          socket.off('error', onError);
          socket.off('close', onClose);
          socket.off('message', onMessage);
        };
        const onOpen = () => {
          socket.send(
            JSON.stringify({
              setup: {
                model: `models/${this.metadata.model}`,
                generationConfig: { responseModalities: ['TEXT'] },
                inputAudioTranscription: {
                  languageCodes: [input.language ?? this.config.language ?? 'pt-BR']
                }
              }
            }),
            (error) => {
              if (error) {
                cleanup();
                reject(new Error('GEMINI_LIVE_SETUP_FAILED'));
              }
            }
          );
        };
        const onError = () => {
          cleanup();
          reject(new Error('GEMINI_LIVE_CONNECTION_FAILED'));
        };
        const onClose = () => {
          if (setupComplete) return;
          cleanup();
          reject(new Error('GEMINI_LIVE_CONNECTION_CLOSED'));
        };
        const onMessage = (data: unknown) => {
          let message: Record<string, unknown>;
          try {
            message = JSON.parse(rawText(data)) as Record<string, unknown>;
          } catch {
            return;
          }
          if (message.setupComplete !== undefined) {
            setupComplete = true;
            cleanup();
            resolve();
          }
        };
        socket.on('open', onOpen);
        socket.on('error', onError);
        socket.on('close', onClose);
        socket.on('message', onMessage);
      });

      let connectionInputTokens = 0;
      let connectionOutputTokens = 0;
      const onMessage = (data: unknown) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(rawText(data)) as Record<string, unknown>;
        } catch {
          return;
        }
        const usage = message.usageMetadata as Record<string, unknown> | undefined;
        if (usage) {
          const nextInput = Number(usage.promptTokenCount ?? usage.inputTokenCount ?? 0);
          const nextOutput = Number(usage.responseTokenCount ?? usage.outputTokenCount ?? 0);
          if (Number.isSafeInteger(nextInput) && nextInput >= connectionInputTokens) {
            accumulatedInputTokens += nextInput - connectionInputTokens;
            connectionInputTokens = nextInput;
          }
          if (Number.isSafeInteger(nextOutput) && nextOutput >= connectionOutputTokens) {
            accumulatedOutputTokens += nextOutput - connectionOutputTokens;
            connectionOutputTokens = nextOutput;
          }
          input.onUsage?.({
            inputTokens: accumulatedInputTokens,
            outputTokens: accumulatedOutputTokens,
            totalTokens: accumulatedInputTokens + accumulatedOutputTokens,
            measurement: 'ACTUAL'
          });
        }
        const content = message.serverContent as Record<string, unknown> | undefined;
        if (!content) return;
        if (content.interimInputTranscription) emit(content.interimInputTranscription, false);
        if (content.inputTranscription) emit(content.inputTranscription, true);
      };
      socket.on('message', onMessage);
      return {
        socket,
        openedAt: Date.now(),
        send: (chunk) =>
          new Promise<void>((resolve, reject) => {
            if (socket.readyState !== WebSocket.OPEN) {
              reject(new Error('GEMINI_LIVE_CONNECTION_CLOSED'));
              return;
            }
            socket.send(
              JSON.stringify({
                realtimeInput: {
                  audio: {
                    data: Buffer.from(chunk.data).toString('base64'),
                    mimeType: liveAudioMimeType
                  }
                }
              }),
              (error) => (error ? reject(new Error('GEMINI_LIVE_SEND_FAILED')) : resolve())
            );
          }),
        finish: () =>
          new Promise<void>((resolve) => {
            if (socket.readyState !== WebSocket.OPEN) {
              socket.close();
              resolve();
              return;
            }
            socket.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }), () => {
              setTimeout(() => {
                socket.close(1000, 'stream complete');
                resolve();
              }, 250);
            });
          })
      };
    };

    connection = await createConnection();
    const renewIfNeeded = async (): Promise<void> => {
      if (closed || !connection) throw new Error('TRANSCRIPTION_STREAM_CLOSED');
      const renewalMs = this.config.sessionRenewalMs ?? 540_000;
      if (
        Date.now() - connection.openedAt < renewalMs &&
        connection.socket.readyState === WebSocket.OPEN
      )
        return;
      if (!renewal) {
        renewal = (async () => {
          const previous = connection;
          const next = await createConnection();
          connection = next;
          await previous?.finish();
        })().finally(() => {
          renewal = null;
        });
      }
      await renewal;
    };

    return {
      accept: async (chunk) => {
        if (closed) throw new Error('TRANSCRIPTION_STREAM_CLOSED');
        if (chunk.source !== 'LOCAL_MIC' && chunk.source !== 'SYSTEM_AUDIO')
          throw new Error('LIVE_AUDIO_SOURCE_INVALID');
        if (chunk.mimeType !== liveAudioMimeType) throw new Error('LIVE_AUDIO_FORMAT_INVALID');
        if (chunk.data.byteLength % (liveAudioChannels * 2) !== 0)
          throw new Error('LIVE_AUDIO_PAYLOAD_INVALID');
        if (source && source !== chunk.source) throw new Error('TRANSCRIPTION_SOURCE_MIXED');
        source = chunk.source;
        utteranceStartedAt ??= chunk.capturedAt;
        latestAudioAt = new Date(chunk.capturedAt.getTime() + chunk.durationMs);
        await renewIfNeeded();
        await connection!.send(chunk);
      },
      close: async () => {
        if (closed) return;
        closed = true;
        await renewal?.catch(() => undefined);
        await connection?.finish();
        connection = null;
      }
    };
  }
}
