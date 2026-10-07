import { z } from 'zod';

export const allowedAudioMimeTypes = [
  'audio/wav',
  'audio/mpeg',
  'audio/ogg',
  'audio/webm'
] as const;
export type AudioMimeType = (typeof allowedAudioMimeTypes)[number];

export interface TranscriptionUsage {
  inputTokens: number;
  outputTokens: number;
  audioDurationMs: number;
  measurement: 'ACTUAL' | 'ESTIMATED';
}

export interface TranscriptionInput {
  audio: Uint8Array;
  mimeType: AudioMimeType;
  durationMs: number;
  languageHint?: string;
}

export interface TranscriptionResult {
  text: string;
  language: string | null;
  confidence: number | null;
  model: string;
  usage: TranscriptionUsage;
}

export interface TranscriptionProvider {
  readonly metadata: { provider: string; configVersion: string };
  transcribe(input: TranscriptionInput, signal?: AbortSignal): Promise<TranscriptionResult>;
}

export interface TranscriptionPricing {
  inputMicrosPerMillionTokens: bigint;
  outputMicrosPerMillionTokens: bigint;
  audioMicrosPerMinute: bigint;
}

export function estimateTranscriptionCost(
  usage: TranscriptionUsage,
  pricing: TranscriptionPricing
): bigint {
  const tokenCost =
    (BigInt(usage.inputTokens) * pricing.inputMicrosPerMillionTokens +
      BigInt(usage.outputTokens) * pricing.outputMicrosPerMillionTokens) /
    1_000_000n;
  const audioCost = (BigInt(usage.audioDurationMs) * pricing.audioMicrosPerMinute) / 60_000n;
  return tokenCost + audioCost;
}

export class TranscriptionProviderError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'TranscriptionProviderError';
  }
}

const transcriptSchema = z.object({
  text: z.string().trim().min(1).max(200_000),
  language: z.string().trim().min(2).max(35).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  model: z.string().trim().min(1),
  usage: z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    audioDurationMs: z.number().int().positive(),
    measurement: z.enum(['ACTUAL', 'ESTIMATED'])
  })
});

export function validateTranscription(value: unknown): TranscriptionResult {
  return transcriptSchema.parse(value);
}

export function detectAudioMime(data: Uint8Array): AudioMimeType | null {
  const ascii = (start: number, end: number) =>
    new TextDecoder('ascii').decode(data.slice(start, end));
  if (data.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'audio/wav';
  if (data.length >= 3 && ascii(0, 3) === 'ID3') return 'audio/mpeg';
  if (data.length >= 2 && data[0] === 0xff && (data[1]! & 0xe0) === 0xe0) return 'audio/mpeg';
  if (data.length >= 4 && ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (
    data.length >= 4 &&
    data[0] === 0x1a &&
    data[1] === 0x45 &&
    data[2] === 0xdf &&
    data[3] === 0xa3
  )
    return 'audio/webm';
  return null;
}

export function assertAudioPayload(
  data: Uint8Array,
  declaredMime: string,
  maxBytes: number
): asserts declaredMime is AudioMimeType {
  if (data.byteLength === 0) throw new Error('AUDIO_EMPTY');
  if (data.byteLength > maxBytes) throw new Error('AUDIO_TOO_LARGE');
  if (!allowedAudioMimeTypes.includes(declaredMime as AudioMimeType))
    throw new Error('AUDIO_MIME_UNSUPPORTED');
  if (detectAudioMime(data) !== declaredMime) throw new Error('AUDIO_MAGIC_MISMATCH');
}

export type FixtureTranscriptionMode =
  | 'VALID'
  | 'EMPTY'
  | 'TIMEOUT'
  | 'RATE_LIMIT'
  | 'FAILURE'
  | 'INVALID'
  | 'WRONG_LANGUAGE'
  | 'CORRUPT';

export class FixtureTranscriptionProvider implements TranscriptionProvider {
  public readonly metadata = { provider: 'fixture-transcription', configVersion: 'fixture-v1' };
  public calls = 0;
  public constructor(private readonly mode: FixtureTranscriptionMode = 'VALID') {}

  public transcribe(input: TranscriptionInput): Promise<TranscriptionResult> {
    this.calls += 1;
    if (this.mode === 'TIMEOUT') throw new TranscriptionProviderError('FIXTURE_TIMEOUT', true);
    if (this.mode === 'RATE_LIMIT') throw new TranscriptionProviderError('FIXTURE_429', true, 429);
    if (this.mode === 'FAILURE') throw new TranscriptionProviderError('FIXTURE_500', true, 500);
    if (this.mode === 'CORRUPT') throw new TranscriptionProviderError('AUDIO_CORRUPT', false);
    if (this.mode === 'INVALID')
      return Promise.resolve({
        text: 'texto',
        language: 'pt-BR',
        confidence: 2,
        model: 'fixture-v1',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          audioDurationMs: input.durationMs,
          measurement: 'ESTIMATED'
        }
      });
    const marker = new TextDecoder()
      .decode(input.audio)
      .match(/MORUBI_FIXTURE:([^\0]+)/)?.[1]
      ?.trim();
    return Promise.resolve({
      text:
        this.mode === 'EMPTY'
          ? ''
          : marker || 'Preciso entender melhor prazo, valor e prÃ³ximos passos.',
      language: this.mode === 'WRONG_LANGUAGE' ? 'und' : 'pt-BR',
      confidence: 0.99,
      model: 'fixture-v1',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        audioDurationMs: input.durationMs,
        measurement: 'ESTIMATED'
      }
    });
  }
}
