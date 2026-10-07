import { describe, expect, it } from 'vitest';
import {
  BoundedAudioBuffer,
  FixtureLiveAudioCaptureProvider,
  FixtureMeetingDetector,
  FixtureRealtimeTranscriptionProvider,
  FixtureSpeechSegmenter,
  HeuristicCallPhaseDetector,
  LiveTurnAggregator,
  MeetingDetector,
  emptyLiveCallMemory,
  fixtureLiveCallScript,
  liveCardDisposition,
  updateLiveCallMemory,
  type LiveAudioChunk,
  type RealtimeTranscriptTurn
} from './index.js';

function turn(
  sequence: number,
  text: string,
  speakerRole: 'SELLER' | 'LEAD' = 'LEAD',
  start = sequence * 1_000
): RealtimeTranscriptTurn {
  return {
    clientTurnId: `turn-${sequence}`,
    speakerRole,
    speakerOrigin: 'FIXTURE',
    speakerConfidence: 1,
    text,
    isPartial: false,
    isFinal: true,
    startedAt: new Date(start),
    endedAt: new Date(start + 500),
    confidence: 1,
    sequence
  };
}

function chunk(sequence: number, bytes = 4): LiveAudioChunk {
  return {
    id: String(sequence),
    sequence,
    capturedAt: new Date(sequence * 1_000),
    durationMs: 1_000,
    mimeType: 'audio/webm',
    source: 'UNKNOWN',
    data: new Uint8Array(bytes)
  };
}

describe('meeting detection', () => {
  it('detects Meet by exact HTTPS host and Zoom by process', () => {
    const detector = new MeetingDetector();
    expect(
      detector.detect({ url: 'https://meet.google.com/abc-defg-hij', observedAt: new Date() })
    ).toMatchObject({ provider: 'MEET', externalId: 'abc-defg-hij' });
    expect(
      detector.detect({ processName: 'Zoom.exe', windowTitle: 'Daily', observedAt: new Date() })
    ).toMatchObject({ provider: 'ZOOM', evidence: 'PROCESS_NAME' });
  });

  it('does not treat lookalike hosts or arbitrary titles as meetings', () => {
    const detector = new MeetingDetector();
    expect(
      detector.detect({ url: 'https://meet.google.com.evil.test/a', observedAt: new Date() })
    ).toBeNull();
    expect(detector.detect({ windowTitle: 'Quarterly report', observedAt: new Date() })).toBeNull();
    expect(new FixtureMeetingDetector().detect('MEET')).toMatchObject({ confidence: 1 });
  });
});

describe('capture and backpressure', () => {
  it('keeps voice activity behind a replaceable speech segmenter contract', () => {
    const segments = new FixtureSpeechSegmenter().accept(chunk(4));
    expect(segments[0]).toMatchObject({ sequence: 4, durationMs: 1_000, source: 'UNKNOWN' });
  });

  it('requires an active fixture capture and supports pause/resume/stop', async () => {
    const capture = new FixtureLiveAudioCaptureProvider();
    const received: number[] = [];
    await capture.start((item) => received.push(item.sequence));
    expect(capture.emit(chunk(1))).toBe(true);
    await capture.pause();
    expect(capture.emit(chunk(2))).toBe(false);
    await capture.resume();
    expect(capture.emit(chunk(3))).toBe(true);
    await capture.stop();
    expect(received).toEqual([1, 3]);
  });

  it('drops oldest chunks instead of growing without bounds', () => {
    const buffer = new BoundedAudioBuffer(8);
    buffer.push(chunk(1));
    buffer.push(chunk(2));
    buffer.push(chunk(3));
    expect(buffer.snapshot()).toEqual({ chunks: 2, bytes: 8, droppedChunks: 1 });
    expect(buffer.shift()?.sequence).toBe(2);
  });

  it('retains an unacknowledged chunk across a simulated reconnect', () => {
    const buffer = new BoundedAudioBuffer(8);
    buffer.push(chunk(1));
    const beforeDisconnect = buffer.peek();
    expect(beforeDisconnect?.sequence).toBe(1);
    expect(buffer.snapshot().chunks).toBe(1);

    const afterReconnect = buffer.peek();
    expect(afterReconnect?.id).toBe(beforeDisconnect?.id);
    expect(buffer.acknowledge(afterReconnect!.id)).toBe(true);
    expect(buffer.snapshot()).toEqual({ chunks: 0, bytes: 0, droppedChunks: 0 });
  });
});

describe('realtime transcription and aggregation', () => {
  it('emits partial and final fixture turns deterministically', async () => {
    const output: RealtimeTranscriptTurn[] = [];
    const provider = new FixtureRealtimeTranscriptionProvider(fixtureLiveCallScript);
    const stream = await provider.open({ sessionId: 'session' }, (item) => output.push(item));
    await stream.accept(chunk(1));
    await stream.close();
    expect(output.map((item) => item.isFinal)).toEqual([false, true]);
    expect(output[1]?.text).toContain('principal desafio');
  });

  it('ignores partials, merges adjacent same-speaker finals and flushes on speaker change', () => {
    const aggregator = new LiveTurnAggregator();
    expect(aggregator.accept({ ...turn(1, 'Eu...'), isPartial: true, isFinal: false })).toEqual([]);
    expect(aggregator.accept(turn(1, 'Eu'))).toEqual([]);
    expect(aggregator.accept(turn(2, 'acho que está caro', 'LEAD', 1_000))).toEqual([]);
    const ready = aggregator.accept(turn(3, 'Entendi.', 'SELLER', 3_000));
    expect(ready[0]).toMatchObject({
      text: 'Eu acho que está caro',
      sourceTurnIds: ['turn-1', 'turn-2']
    });
  });
});

describe('incremental memory, phase and card policy', () => {
  it('keeps bounded incremental memory and rejects stale updates', () => {
    const updated = updateLiveCallMemory(emptyLiveCallMemory(), {
      sequence: 2,
      phase: 'DISCOVERY',
      phaseConfidence: 0.7,
      pain: 'Perda de leads'
    });
    expect(updated).toMatchObject({ phase: 'DISCOVERY', pains: ['Perda de leads'] });
    expect(updateLiveCallMemory(updated, { sequence: 1, objection: 'Preço' })).toBe(updated);
  });

  it('detects phase heuristically without claiming certainty', () => {
    expect(
      new HeuristicCallPhaseDetector().detect('Qual o impacto desse problema hoje?', 'INTRODUCTION')
    ).toEqual({ phase: 'DISCOVERY', confidence: 0.7, origin: 'HEURISTIC' });
  });

  it('expires stale cards and preempts only with higher priority', () => {
    const now = new Date('2026-10-07T12:00:00Z');
    expect(
      liveCardDisposition({
        cardSequence: 2,
        latestSequence: 3,
        now,
        expiresAt: new Date('2026-10-07T12:01:00Z'),
        priority: 90
      })
    ).toBe('STALE');
    expect(
      liveCardDisposition({
        cardSequence: 3,
        latestSequence: 3,
        now,
        expiresAt: new Date('2026-10-07T12:01:00Z'),
        priority: 90,
        currentPriority: 60
      })
    ).toBe('PREEMPT');
  });
});
