export const meetingProviders = ['MEET', 'ZOOM', 'TEAMS', 'UNKNOWN'] as const;
export type MeetingProvider = (typeof meetingProviders)[number];

export const liveSpeakerRoles = ['SELLER', 'LEAD', 'UNKNOWN'] as const;
export type LiveSpeakerRole = (typeof liveSpeakerRoles)[number];

export interface LiveSpeaker {
  role: LiveSpeakerRole;
  speakerId?: string;
  origin: AudioSource | 'FIXTURE';
  confidence: number;
}

export const callPhases = [
  'INTRODUCTION',
  'DISCOVERY',
  'PRESENTATION',
  'VALUE',
  'DECISION',
  'UNKNOWN'
] as const;
export type CallPhase = (typeof callPhases)[number];

export interface MeetingObservation {
  processName?: string;
  windowTitle?: string;
  url?: string;
  observedAt: Date;
}

export interface MeetingDetection {
  provider: MeetingProvider;
  externalId: string | null;
  title: string | null;
  confidence: number;
  active: boolean;
  evidence: 'URL_HOST' | 'PROCESS_NAME' | 'WINDOW_TITLE' | 'FIXTURE';
  observedAt: Date;
}

export interface MeetingProviderAdapter {
  readonly provider: MeetingProvider;
  detect(observation: MeetingObservation): MeetingDetection | null;
}

function normalized(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? '';
}

function meetingIdFromPath(pathname: string): string | null {
  const candidate = pathname.split('/').filter(Boolean)[0];
  return candidate && /^[a-z0-9-]{3,120}$/i.test(candidate) ? candidate : null;
}

export class MeetMeetingAdapter implements MeetingProviderAdapter {
  public readonly provider = 'MEET' as const;

  public detect(observation: MeetingObservation): MeetingDetection | null {
    if (observation.url) {
      try {
        const url = new URL(observation.url);
        if (url.protocol === 'https:' && url.hostname === 'meet.google.com') {
          return {
            provider: this.provider,
            externalId: meetingIdFromPath(url.pathname),
            title: observation.windowTitle?.slice(0, 240) ?? null,
            confidence: 0.98,
            active: true,
            evidence: 'URL_HOST',
            observedAt: observation.observedAt
          };
        }
      } catch {
        return null;
      }
    }
    const title = normalized(observation.windowTitle);
    if (title.includes('google meet') || title.includes('meet.google.com')) {
      return {
        provider: this.provider,
        externalId: null,
        title: observation.windowTitle?.slice(0, 240) ?? null,
        confidence: 0.72,
        active: true,
        evidence: 'WINDOW_TITLE',
        observedAt: observation.observedAt
      };
    }
    return null;
  }
}

export class ZoomMeetingAdapter implements MeetingProviderAdapter {
  public readonly provider = 'ZOOM' as const;

  public detect(observation: MeetingObservation): MeetingDetection | null {
    const process = normalized(observation.processName);
    if (['zoom.exe', 'zoom.us', 'zoom'].includes(process)) {
      return {
        provider: this.provider,
        externalId: null,
        title: observation.windowTitle?.slice(0, 240) ?? null,
        confidence: 0.9,
        active: true,
        evidence: 'PROCESS_NAME',
        observedAt: observation.observedAt
      };
    }
    if (observation.url) {
      try {
        const url = new URL(observation.url);
        if (
          url.protocol === 'https:' &&
          (url.hostname === 'zoom.us' || url.hostname.endsWith('.zoom.us'))
        ) {
          return {
            provider: this.provider,
            externalId: meetingIdFromPath(url.pathname.replace(/^\/j\//, '/')),
            title: observation.windowTitle?.slice(0, 240) ?? null,
            confidence: 0.95,
            active: true,
            evidence: 'URL_HOST',
            observedAt: observation.observedAt
          };
        }
      } catch {
        return null;
      }
    }
    return null;
  }
}

export class MeetingDetector {
  public constructor(
    private readonly adapters: readonly MeetingProviderAdapter[] = [
      new MeetMeetingAdapter(),
      new ZoomMeetingAdapter()
    ]
  ) {}

  public detect(observation: MeetingObservation): MeetingDetection | null {
    return (
      this.adapters
        .map((adapter) => adapter.detect(observation))
        .filter((item): item is MeetingDetection => item !== null)
        .sort((left, right) => right.confidence - left.confidence)[0] ?? null
    );
  }
}

export class FixtureMeetingDetector {
  public detect(provider: Exclude<MeetingProvider, 'UNKNOWN'>, now = new Date()): MeetingDetection {
    return {
      provider,
      externalId: `fixture-${provider.toLowerCase()}`,
      title: `${provider} fixture call`,
      confidence: 1,
      active: true,
      evidence: 'FIXTURE',
      observedAt: now
    };
  }
}

export type AudioSource = 'LOCAL_SPEAKER' | 'REMOTE_AUDIO' | 'MIXED' | 'UNKNOWN';
export type CaptureHealth = 'IDLE' | 'STARTING' | 'ACTIVE' | 'PAUSED' | 'STOPPED' | 'FAILED';

export interface LiveAudioChunk {
  id: string;
  sequence: number;
  capturedAt: Date;
  durationMs: number;
  mimeType: string;
  source: AudioSource;
  data: Uint8Array;
}

export interface LiveAudioCaptureProvider {
  readonly platform: 'WINDOWS' | 'MACOS' | 'FIXTURE';
  readonly mode: 'MICROPHONE' | 'SYSTEM_AUDIO' | 'MIXED' | 'FIXTURE';
  start(onChunk: (chunk: LiveAudioChunk) => void): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  stop(): Promise<void>;
  health(): CaptureHealth;
}

export interface SpeechSegment {
  id: string;
  sequence: number;
  startedAt: Date;
  endedAt: Date;
  durationMs: number;
  source: AudioSource;
  chunks: LiveAudioChunk[];
}

export interface SpeechSegmenter {
  accept(chunk: LiveAudioChunk): SpeechSegment[];
  flush(): SpeechSegment[];
}

/** Deterministic boundary used by fixtures; a real VAD can replace it without changing STT. */
export class FixtureSpeechSegmenter implements SpeechSegmenter {
  public accept(chunk: LiveAudioChunk): SpeechSegment[] {
    return [
      {
        id: `segment:${chunk.id}`,
        sequence: chunk.sequence,
        startedAt: chunk.capturedAt,
        endedAt: new Date(chunk.capturedAt.getTime() + chunk.durationMs),
        durationMs: chunk.durationMs,
        source: chunk.source,
        chunks: [chunk]
      }
    ];
  }

  public flush(): SpeechSegment[] {
    return [];
  }
}

export class FixtureLiveAudioCaptureProvider implements LiveAudioCaptureProvider {
  public readonly platform = 'FIXTURE' as const;
  public readonly mode = 'FIXTURE' as const;
  private state: CaptureHealth = 'IDLE';
  private listener: ((chunk: LiveAudioChunk) => void) | null = null;

  public start(onChunk: (chunk: LiveAudioChunk) => void): Promise<void> {
    if (this.state === 'ACTIVE' || this.state === 'PAUSED')
      throw new Error('CAPTURE_ALREADY_ACTIVE');
    this.listener = onChunk;
    this.state = 'ACTIVE';
    return Promise.resolve();
  }

  public pause(): Promise<void> {
    if (this.state !== 'ACTIVE') throw new Error('CAPTURE_NOT_ACTIVE');
    this.state = 'PAUSED';
    return Promise.resolve();
  }

  public resume(): Promise<void> {
    if (this.state !== 'PAUSED') throw new Error('CAPTURE_NOT_PAUSED');
    this.state = 'ACTIVE';
    return Promise.resolve();
  }

  public stop(): Promise<void> {
    this.listener = null;
    this.state = 'STOPPED';
    return Promise.resolve();
  }

  public health(): CaptureHealth {
    return this.state;
  }

  public emit(chunk: LiveAudioChunk): boolean {
    if (this.state !== 'ACTIVE' || !this.listener) return false;
    this.listener(chunk);
    return true;
  }
}

export class BoundedAudioBuffer {
  private readonly chunks: LiveAudioChunk[] = [];
  private bufferedBytes = 0;
  private dropped = 0;

  public constructor(private readonly maxBytes: number) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('BUFFER_LIMIT_INVALID');
  }

  public push(chunk: LiveAudioChunk): void {
    if (chunk.data.byteLength > this.maxBytes) {
      this.dropped += 1;
      return;
    }
    this.chunks.push(chunk);
    this.bufferedBytes += chunk.data.byteLength;
    while (this.bufferedBytes > this.maxBytes) {
      const removed = this.chunks.shift();
      if (!removed) break;
      this.bufferedBytes -= removed.data.byteLength;
      this.dropped += 1;
    }
  }

  public shift(): LiveAudioChunk | null {
    const chunk = this.chunks.shift();
    if (!chunk) return null;
    this.bufferedBytes -= chunk.data.byteLength;
    return chunk;
  }

  /** Reads the oldest chunk without removing it, so a transport failure can retry safely. */
  public peek(): LiveAudioChunk | null {
    return this.chunks[0] ?? null;
  }

  /** Removes an acknowledged chunk only when it is still at the head of the queue. */
  public acknowledge(chunkId: string): boolean {
    const chunk = this.chunks[0];
    if (!chunk || chunk.id !== chunkId) return false;
    this.chunks.shift();
    this.bufferedBytes -= chunk.data.byteLength;
    return true;
  }

  public clear(): void {
    this.chunks.length = 0;
    this.bufferedBytes = 0;
  }

  public snapshot(): { chunks: number; bytes: number; droppedChunks: number } {
    return { chunks: this.chunks.length, bytes: this.bufferedBytes, droppedChunks: this.dropped };
  }
}

export interface RealtimeTranscriptTurn {
  clientTurnId: string;
  speakerRole: LiveSpeakerRole;
  speakerId?: string;
  speakerOrigin: AudioSource | 'FIXTURE';
  speakerConfidence: number;
  text: string;
  isPartial: boolean;
  isFinal: boolean;
  startedAt: Date;
  endedAt: Date | null;
  confidence: number | null;
  sequence: number;
}

export interface RealtimeTranscriptionStream {
  accept(chunk: LiveAudioChunk): Promise<void>;
  close(): Promise<void>;
}

export interface RealtimeTranscriptionProvider {
  readonly metadata: { provider: string; model: string; configVersion: string };
  open(
    input: { sessionId: string; language?: string },
    onTurn: (turn: RealtimeTranscriptTurn) => void
  ): Promise<RealtimeTranscriptionStream>;
}

export interface FixtureRealtimeScriptEntry {
  partial?: string;
  final: string;
  speakerRole: LiveSpeakerRole;
  durationMs: number;
}

export class FixtureRealtimeTranscriptionProvider implements RealtimeTranscriptionProvider {
  public readonly metadata = {
    provider: 'fixture-realtime',
    model: 'fixture-realtime-v1',
    configVersion: 'fixture-realtime-config-v1'
  };

  public constructor(private readonly script: readonly FixtureRealtimeScriptEntry[]) {}

  public open(
    input: { sessionId: string; language?: string },
    onTurn: (turn: RealtimeTranscriptTurn) => void
  ): Promise<RealtimeTranscriptionStream> {
    let cursor = 0;
    let closed = false;
    return Promise.resolve({
      accept: (chunk) => {
        if (closed) throw new Error('TRANSCRIPTION_STREAM_CLOSED');
        const entry = this.script[cursor++];
        if (!entry) return Promise.resolve();
        const startedAt = chunk.capturedAt;
        if (entry.partial) {
          onTurn({
            clientTurnId: `${input.sessionId}:${chunk.sequence}`,
            speakerRole: entry.speakerRole,
            speakerOrigin: 'FIXTURE',
            speakerConfidence: 1,
            text: entry.partial,
            isPartial: true,
            isFinal: false,
            startedAt,
            endedAt: null,
            confidence: null,
            sequence: chunk.sequence
          });
        }
        onTurn({
          clientTurnId: `${input.sessionId}:${chunk.sequence}`,
          speakerRole: entry.speakerRole,
          speakerOrigin: 'FIXTURE',
          speakerConfidence: 1,
          text: entry.final,
          isPartial: false,
          isFinal: true,
          startedAt,
          endedAt: new Date(startedAt.getTime() + entry.durationMs),
          confidence: 1,
          sequence: chunk.sequence
        });
        return Promise.resolve();
      },
      close: () => {
        closed = true;
        return Promise.resolve();
      }
    });
  }
}

export interface AggregatedTurn extends RealtimeTranscriptTurn {
  sourceTurnIds: string[];
}

function asAggregated(turn: RealtimeTranscriptTurn): AggregatedTurn {
  return { ...turn, sourceTurnIds: [turn.clientTurnId] };
}

export class LiveTurnAggregator {
  private pending: AggregatedTurn | null = null;

  public constructor(
    private readonly options: { maxGapMs: number; maxCharacters: number; maxDurationMs: number } = {
      maxGapMs: 1_200,
      maxCharacters: 1_500,
      maxDurationMs: 30_000
    }
  ) {}

  public accept(turn: RealtimeTranscriptTurn): AggregatedTurn[] {
    if (!turn.isFinal || turn.isPartial || !turn.text.trim()) return [];
    if (!this.pending) {
      this.pending = asAggregated(turn);
      return [];
    }
    const pendingEnd = this.pending.endedAt?.getTime() ?? this.pending.startedAt.getTime();
    const turnEnd = turn.endedAt?.getTime() ?? turn.startedAt.getTime();
    const combinedText = `${this.pending.text.trim()} ${turn.text.trim()}`;
    const canMerge =
      this.pending.speakerRole === turn.speakerRole &&
      turn.startedAt.getTime() - pendingEnd <= this.options.maxGapMs &&
      combinedText.length <= this.options.maxCharacters &&
      turnEnd - this.pending.startedAt.getTime() <= this.options.maxDurationMs;
    if (canMerge) {
      this.pending = {
        ...this.pending,
        text: combinedText,
        endedAt: turn.endedAt,
        confidence:
          this.pending.confidence === null || turn.confidence === null
            ? null
            : Math.min(this.pending.confidence, turn.confidence),
        sequence: turn.sequence,
        sourceTurnIds: [...this.pending.sourceTurnIds, turn.clientTurnId]
      };
      return [];
    }
    const ready = this.pending;
    this.pending = asAggregated(turn);
    return [ready];
  }

  public flushExpired(at: Date): AggregatedTurn[] {
    if (!this.pending) return [];
    const end = this.pending.endedAt ?? this.pending.startedAt;
    if (at.getTime() - end.getTime() < this.options.maxGapMs) return [];
    return this.flush();
  }

  public flush(): AggregatedTurn[] {
    if (!this.pending) return [];
    const ready = this.pending;
    this.pending = null;
    return [ready];
  }
}

export interface LiveCallMemory {
  phase: CallPhase;
  phaseConfidence: number;
  pains: string[];
  objections: string[];
  openQuestions: string[];
  buyingSignals: string[];
  sellerActions: string[];
  lastInterventionId: string | null;
  lastSequence: number;
}

export function emptyLiveCallMemory(): LiveCallMemory {
  return {
    phase: 'INTRODUCTION',
    phaseConfidence: 0.5,
    pains: [],
    objections: [],
    openQuestions: [],
    buyingSignals: [],
    sellerActions: [],
    lastInterventionId: null,
    lastSequence: 0
  };
}

function appendBounded(values: readonly string[], candidate: string | undefined): string[] {
  if (!candidate?.trim()) return [...values];
  const normalizedCandidate = candidate.trim();
  const withoutDuplicate = values.filter(
    (value) => value.toLocaleLowerCase() !== normalizedCandidate.toLocaleLowerCase()
  );
  return [...withoutDuplicate, normalizedCandidate].slice(-6);
}

export function updateLiveCallMemory(
  current: LiveCallMemory,
  update: {
    sequence: number;
    phase?: CallPhase;
    phaseConfidence?: number;
    pain?: string;
    objection?: string;
    openQuestion?: string;
    buyingSignal?: string;
    sellerAction?: string;
    interventionId?: string | null;
  }
): LiveCallMemory {
  if (update.sequence < current.lastSequence) return current;
  return {
    phase: update.phase ?? current.phase,
    phaseConfidence: update.phaseConfidence ?? current.phaseConfidence,
    pains: appendBounded(current.pains, update.pain),
    objections: appendBounded(current.objections, update.objection),
    openQuestions: appendBounded(current.openQuestions, update.openQuestion),
    buyingSignals: appendBounded(current.buyingSignals, update.buyingSignal),
    sellerActions: appendBounded(current.sellerActions, update.sellerAction),
    lastInterventionId:
      update.interventionId === undefined ? current.lastInterventionId : update.interventionId,
    lastSequence: update.sequence
  };
}

export interface PhaseDetection {
  phase: CallPhase;
  confidence: number;
  origin: 'HEURISTIC' | 'DECISION_PROVIDER';
}

export class HeuristicCallPhaseDetector {
  public detect(text: string, current: CallPhase): PhaseDetection {
    const value = text.toLocaleLowerCase();
    if (/pr[oó]ximo passo|contrato|assinar|decidir|aprova/.test(value))
      return { phase: 'DECISION', confidence: 0.76, origin: 'HEURISTIC' };
    if (/valor|retorno|investimento|pre[cç]o|custo/.test(value))
      return { phase: 'VALUE', confidence: 0.72, origin: 'HEURISTIC' };
    if (/demonstra|solu[cç][aã]o|funciona|produto/.test(value))
      return { phase: 'PRESENTATION', confidence: 0.68, origin: 'HEURISTIC' };
    if (/desafio|problema|impacto|hoje|processo/.test(value))
      return { phase: 'DISCOVERY', confidence: 0.7, origin: 'HEURISTIC' };
    return { phase: current, confidence: 0.5, origin: 'HEURISTIC' };
  }
}

export function liveCardDisposition(input: {
  cardSequence: number;
  latestSequence: number;
  now: Date;
  expiresAt: Date;
  priority: number;
  currentPriority?: number;
}): 'DELIVER' | 'STALE' | 'EXPIRED' | 'PREEMPT' {
  if (input.now >= input.expiresAt) return 'EXPIRED';
  if (input.cardSequence < input.latestSequence) return 'STALE';
  if (input.currentPriority !== undefined && input.priority > input.currentPriority)
    return 'PREEMPT';
  return 'DELIVER';
}

export async function runSyntheticLiveLoad(input: {
  sessions: number;
  turnsPerSession: number;
  bufferBytes?: number;
}): Promise<{
  sessions: number;
  turns: number;
  finalTurns: number;
  elapsedMs: number;
  peakBufferedBytes: number;
}> {
  const started = performance.now();
  let finalTurns = 0;
  let peakBufferedBytes = 0;
  await Promise.all(
    Array.from({ length: input.sessions }, async (_, sessionIndex) => {
      const buffer = new BoundedAudioBuffer(input.bufferBytes ?? 64 * 1024);
      const script = Array.from({ length: input.turnsPerSession }, (_, turnIndex) => ({
        partial: `parcial ${turnIndex}`,
        final: turnIndex % 4 === 3 ? 'Mas achei o valor muito alto.' : `Turno ${turnIndex}`,
        speakerRole: turnIndex % 2 === 0 ? ('SELLER' as const) : ('LEAD' as const),
        durationMs: 800
      }));
      const provider = new FixtureRealtimeTranscriptionProvider(script);
      const aggregator = new LiveTurnAggregator({
        maxGapMs: 200,
        maxCharacters: 1_500,
        maxDurationMs: 30_000
      });
      const stream = await provider.open({ sessionId: `load-${sessionIndex}` }, (turn) => {
        finalTurns += aggregator.accept(turn).length;
      });
      for (let sequence = 0; sequence < input.turnsPerSession; sequence += 1) {
        const chunk: LiveAudioChunk = {
          id: `${sessionIndex}:${sequence}`,
          sequence,
          capturedAt: new Date(sequence * 1_000),
          durationMs: 800,
          mimeType: 'audio/webm',
          source: sequence % 2 === 0 ? 'LOCAL_SPEAKER' : 'REMOTE_AUDIO',
          data: new Uint8Array(1_024)
        };
        buffer.push(chunk);
        peakBufferedBytes = Math.max(peakBufferedBytes, buffer.snapshot().bytes);
        const next = buffer.peek();
        if (next) {
          await stream.accept(next);
          buffer.acknowledge(next.id);
        }
      }
      finalTurns += aggregator.flush().length;
      await stream.close();
    })
  );
  return {
    sessions: input.sessions,
    turns: input.sessions * input.turnsPerSession,
    finalTurns,
    elapsedMs: performance.now() - started,
    peakBufferedBytes
  };
}

export async function runFixtureSpeechToCardBenchmark(samples = 100): Promise<{
  samples: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}> {
  if (!Number.isInteger(samples) || samples < 1) throw new Error('BENCHMARK_SAMPLES_INVALID');
  const latencies: number[] = [];
  const phaseDetector = new HeuristicCallPhaseDetector();
  for (let sample = 0; sample < samples; sample += 1) {
    const provider = new FixtureRealtimeTranscriptionProvider([
      {
        final: 'Mas achei o valor muito alto.',
        speakerRole: 'LEAD',
        durationMs: 1_000
      }
    ]);
    const started = performance.now();
    const stream = await provider.open({ sessionId: `latency-${sample}` }, (turn) => {
      if (!turn.isFinal) return;
      const phase = phaseDetector.detect(turn.text, 'DISCOVERY');
      liveCardDisposition({
        cardSequence: turn.sequence,
        latestSequence: turn.sequence,
        now: new Date(),
        expiresAt: new Date(Date.now() + 20_000),
        priority: phase.phase === 'VALUE' ? 80 : 50
      });
      latencies.push(performance.now() - started);
    });
    await stream.accept({
      id: `latency:${sample}`,
      sequence: sample,
      capturedAt: new Date(),
      durationMs: 1_000,
      mimeType: 'audio/webm',
      source: 'REMOTE_AUDIO',
      data: new Uint8Array(1_024)
    });
    await stream.close();
  }
  const sorted = latencies.sort((left, right) => left - right);
  const percentile = (value: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)] ?? 0;
  return {
    samples,
    p50Ms: percentile(0.5),
    p95Ms: percentile(0.95),
    maxMs: sorted.at(-1) ?? 0
  };
}

export const fixtureLiveCallScript: readonly FixtureRealtimeScriptEntry[] = [
  {
    partial: 'Qual seu principal...',
    final: 'Qual é o principal desafio da operação hoje?',
    speakerRole: 'SELLER',
    durationMs: 2_000
  },
  {
    partial: 'Hoje perdemos...',
    final: 'Hoje perdemos muitos leads porque o retorno demora.',
    speakerRole: 'LEAD',
    durationMs: 3_000
  },
  {
    partial: 'Mas achei o valor...',
    final: 'Mas achei o valor muito alto.',
    speakerRole: 'LEAD',
    durationMs: 2_000
  }
];
