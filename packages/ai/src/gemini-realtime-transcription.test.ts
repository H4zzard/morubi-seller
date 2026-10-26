import { describe, expect, it, vi } from 'vitest';
import type { LiveAudioChunk } from '@morubi/live-calls';
import {
  GeminiRealtimeTranscriptionProvider,
  type GeminiRealtimeSocket
} from './gemini-realtime-transcription.js';

class FakeSocket implements GeminiRealtimeSocket {
  public readyState = 0;
  public readonly sent: Record<string, unknown>[] = [];
  private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  public constructor() {
    queueMicrotask(() => {
      this.readyState = 1;
      this.emit('open');
    });
  }

  public on(event: 'open' | 'close' | 'error' | 'message', listener: (...args: unknown[]) => void) {
    const listeners = this.listeners.get(event) ?? new Set();
    listeners.add(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  public off(
    event: 'open' | 'close' | 'error' | 'message',
    listener: (...args: unknown[]) => void
  ) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  public send(data: string, callback: (error?: Error) => void): void {
    const value = JSON.parse(data) as Record<string, unknown>;
    this.sent.push(value);
    callback();
    if (value.setup) queueMicrotask(() => this.message({ setupComplete: {} }));
  }

  public close(): void {
    this.readyState = 3;
    this.emit('close');
  }

  public message(value: unknown): void {
    this.emit('message', Buffer.from(JSON.stringify(value)));
  }

  private emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((listener) => listener(...args));
  }
}

function chunk(source: 'LOCAL_MIC' | 'SYSTEM_AUDIO', sequence = 0): LiveAudioChunk {
  return {
    id: `${source}:${sequence}`,
    source,
    sequence,
    capturedAt: new Date('2026-10-23T12:00:00.000Z'),
    durationMs: 100,
    mimeType: 'audio/pcm;rate=16000',
    data: new Uint8Array(3_200)
  };
}

describe('GeminiRealtimeTranscriptionProvider', () => {
  it('uses server-side auth, streams PCM and emits separate interim/final turns', async () => {
    const sockets: FakeSocket[] = [];
    const factory = vi.fn((_url: string, key: string) => {
      expect(key).toBe('server-secret');
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    const provider = new GeminiRealtimeTranscriptionProvider(
      { apiKey: 'server-secret', configVersion: 'test-v1', connectTimeoutMs: 1_000 },
      factory
    );
    const turns: Array<{ text: string; final: boolean; origin: string }> = [];
    const usage = vi.fn();
    const stream = await provider.open(
      { sessionId: 'session-1', language: 'pt-BR', onUsage: usage },
      (turn) => turns.push({ text: turn.text, final: turn.isFinal, origin: turn.speakerOrigin })
    );
    await stream.accept(chunk('LOCAL_MIC'));

    expect(factory.mock.calls[0]?.[0]).not.toContain('server-secret');
    expect(sockets[0]?.sent).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          realtimeInput: {
            audio: expect.objectContaining({ mimeType: 'audio/pcm;rate=16000' })
          }
        })
      ])
    );
    sockets[0]?.message({
      serverContent: { interimInputTranscription: { text: 'bom' } }
    });
    sockets[0]?.message({ serverContent: { inputTranscription: { text: 'bom dia' } } });
    sockets[0]?.message({
      usageMetadata: { promptTokenCount: 25, responseTokenCount: 4, totalTokenCount: 29 }
    });
    expect(turns).toEqual([
      { text: 'bom', final: false, origin: 'LOCAL_MIC' },
      { text: 'bom dia', final: true, origin: 'LOCAL_MIC' }
    ]);
    expect(usage).toHaveBeenCalledWith({
      inputTokens: 25,
      outputTokens: 4,
      totalTokens: 29,
      measurement: 'ACTUAL'
    });
    await stream.close();
  });

  it('rejects mixed sources and non-PCM payloads', async () => {
    const provider = new GeminiRealtimeTranscriptionProvider(
      { apiKey: 'server-secret', configVersion: 'test-v1', connectTimeoutMs: 1_000 },
      () => new FakeSocket()
    );
    const stream = await provider.open({ sessionId: 'session-1' }, () => undefined);
    await stream.accept(chunk('LOCAL_MIC'));
    await expect(stream.accept(chunk('SYSTEM_AUDIO', 1))).rejects.toThrow(
      'TRANSCRIPTION_SOURCE_MIXED'
    );
    await expect(
      stream.accept({ ...chunk('LOCAL_MIC', 2), mimeType: 'audio/webm' })
    ).rejects.toThrow('LIVE_AUDIO_FORMAT_INVALID');
    await stream.close();
  });
});
