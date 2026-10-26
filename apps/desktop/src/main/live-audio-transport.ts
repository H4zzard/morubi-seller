import WebSocket, { type RawData } from 'ws';
import type { LiveTranscriptTurnDto, LiveTranscriptionStatusDto } from '@morubi/contracts';
import {
  decodeLiveAudioAcknowledgement,
  encodeLiveAudioPacket,
  liveAudioChannels,
  liveAudioMimeType,
  liveAudioSampleRate,
  type LiveAudioChunk,
  type TransportAudioSource
} from '@morubi/live-calls';
import type { DesktopApiClient } from './desktop-api-client.js';

type TranscriptListener = (turn: LiveTranscriptTurnDto) => void;
type StatusListener = (status: LiveTranscriptionStatusDto) => void;

interface PendingAcknowledgement {
  resolve(): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

function acknowledgementKey(source: TransportAudioSource, sequence: number): string {
  return `${source}:${sequence}`;
}

function asBytes(data: RawData): Uint8Array {
  if (Buffer.isBuffer(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) {
    const value = Buffer.concat(data);
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  throw new Error('LIVE_AUDIO_ACK_INVALID');
}

export class LiveAudioTransportClient {
  private socket: WebSocket | null = null;
  private sessionId: string | null = null;
  private closedByClient = false;
  private ready = false;
  private reconnects = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private connectPromise: Promise<void> | null = null;
  private readonly pending = new Map<string, PendingAcknowledgement>();
  private readonly transcriptListeners = new Set<TranscriptListener>();
  private readonly statusListeners = new Set<StatusListener>();

  public constructor(private readonly api: DesktopApiClient) {}

  public onTranscript(listener: TranscriptListener): () => void {
    this.transcriptListeners.add(listener);
    return () => this.transcriptListeners.delete(listener);
  }

  public onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  public async start(sessionId: string): Promise<void> {
    if (this.sessionId && this.sessionId !== sessionId)
      throw new Error('LIVE_AUDIO_TRANSPORT_ALREADY_ACTIVE');
    if (this.ready && this.sessionId === sessionId) return;
    this.sessionId = sessionId;
    this.closedByClient = false;
    this.reconnects = 0;
    await this.connect(false);
  }

  public async send(chunk: LiveAudioChunk): Promise<void> {
    if (
      (chunk.source !== 'LOCAL_MIC' && chunk.source !== 'SYSTEM_AUDIO') ||
      chunk.mimeType !== liveAudioMimeType
    )
      throw new Error('LIVE_AUDIO_FORMAT_INVALID');
    if (!this.socket || !this.ready || this.socket.readyState !== WebSocket.OPEN)
      throw new Error('LIVE_AUDIO_TRANSPORT_NOT_READY');
    if (this.socket.bufferedAmount > 1_048_576) throw new Error('LIVE_AUDIO_BACKPRESSURE');
    const source = chunk.source;
    const key = acknowledgementKey(source, chunk.sequence);
    if (this.pending.has(key)) throw new Error('LIVE_AUDIO_PACKET_PENDING');
    const encoded = encodeLiveAudioPacket({
      source,
      sequence: chunk.sequence,
      capturedAtMs: chunk.capturedAt.getTime(),
      durationMs: chunk.durationMs,
      sampleRate: liveAudioSampleRate,
      channels: liveAudioChannels,
      data: chunk.data
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error('LIVE_AUDIO_ACK_TIMEOUT'));
      }, 10_000);
      this.pending.set(key, { resolve, reject, timer });
      this.socket!.send(encoded, { binary: true }, (error) => {
        if (!error) return;
        const pending = this.pending.get(key);
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(key);
        pending.reject(new Error('LIVE_AUDIO_SEND_FAILED'));
      });
    });
  }

  public stop(): Promise<void> {
    this.closedByClient = true;
    this.sessionId = null;
    this.ready = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.rejectPending('LIVE_AUDIO_TRANSPORT_STOPPED');
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close(1000, 'client stopped');
    this.emitStatus('DISCONNECTED');
    return Promise.resolve();
  }

  private connect(reconnecting: boolean): Promise<void> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.open(reconnecting).finally(() => {
      this.connectPromise = null;
    });
    return this.connectPromise;
  }

  private async open(reconnecting: boolean): Promise<void> {
    const sessionId = this.sessionId;
    if (!sessionId || this.closedByClient) throw new Error('LIVE_AUDIO_TRANSPORT_STOPPED');
    this.emitStatus(reconnecting ? 'RECONNECTING' : 'CONNECTING');
    const config = await this.api.liveAudioConnection(sessionId);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(config.url, {
        headers: config.headers,
        perMessageDeflate: false
      });
      this.socket = socket;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error('LIVE_AUDIO_CONNECT_TIMEOUT'));
      }, 10_000);
      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          this.handleAcknowledgement(data);
          return;
        }
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(Buffer.from(asBytes(data)).toString('utf8')) as Record<
            string,
            unknown
          >;
        } catch {
          return;
        }
        if (message.type === 'ready' && message.sessionId === sessionId) {
          this.ready = true;
          this.emitStatus('CONNECTED');
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            resolve();
          }
          return;
        }
        if (message.type === 'transcript' && message.turn && typeof message.turn === 'object') {
          const turn = message.turn as LiveTranscriptTurnDto;
          if (turn.sessionId === sessionId && typeof turn.text === 'string')
            this.transcriptListeners.forEach((listener) => listener(turn));
          return;
        }
        if (message.type === 'status' && message.status && typeof message.status === 'object') {
          const status = message.status as LiveTranscriptionStatusDto;
          this.statusListeners.forEach((listener) =>
            listener({ ...status, reconnects: this.reconnects })
          );
          return;
        }
        if (message.type === 'error') this.emitStatus('UNSTABLE', 'A transcrição está instável.');
      });
      socket.once('error', () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('LIVE_AUDIO_CONNECTION_FAILED'));
        }
      });
      socket.once('close', (code) => {
        clearTimeout(timer);
        this.ready = false;
        this.rejectPending('LIVE_AUDIO_CONNECTION_LOST');
        if (!settled) {
          settled = true;
          reject(
            new Error(
              code === 4403 ? 'LIVE_TRANSCRIPTION_UNAVAILABLE' : 'LIVE_AUDIO_CONNECTION_CLOSED'
            )
          );
        }
        if (!this.closedByClient && this.sessionId === sessionId) this.scheduleReconnect();
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer || this.closedByClient || !this.sessionId) return;
    if (this.reconnects >= 5) {
      this.emitStatus('FAILED', 'A transcrição foi interrompida. A captura continua ativa.');
      return;
    }
    this.reconnects += 1;
    this.emitStatus('RECONNECTING', 'Reconectando a transcrição…');
    const delay = Math.min(5_000, 250 * 2 ** (this.reconnects - 1));
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(true).catch(() => this.scheduleReconnect());
    }, delay);
  }

  private handleAcknowledgement(data: RawData): void {
    let acknowledgement: { source: TransportAudioSource; sequence: number };
    try {
      acknowledgement = decodeLiveAudioAcknowledgement(asBytes(data));
    } catch {
      return;
    }
    const key = acknowledgementKey(acknowledgement.source, acknowledgement.sequence);
    const pending = this.pending.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(key);
    pending.resolve();
  }

  private rejectPending(code: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(code));
    }
    this.pending.clear();
  }

  private emitStatus(state: LiveTranscriptionStatusDto['state'], message?: string): void {
    const status: LiveTranscriptionStatusDto = {
      state,
      reconnects: this.reconnects,
      droppedChunks: 0,
      gapDetected: state === 'UNSTABLE',
      ...(message ? { message } : {})
    };
    this.statusListeners.forEach((listener) => listener(status));
  }
}
