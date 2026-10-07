import {
  TranscriptionProviderError,
  validateTranscription,
  type TranscriptionInput,
  type TranscriptionProvider,
  type TranscriptionResult
} from './transcription.js';

export interface GeminiTranscriptionConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs: number;
  configVersion: string;
  circuitFailureThreshold?: number;
  circuitResetMs?: number;
}

type Fetcher = typeof fetch;

export class GeminiTranscriptionProvider implements TranscriptionProvider {
  public readonly metadata;
  private failures = 0;
  private openedAt: number | null = null;

  public constructor(
    private readonly config: GeminiTranscriptionConfig,
    private readonly fetcher: Fetcher = fetch
  ) {
    this.metadata = { provider: 'gemini', configVersion: config.configVersion };
  }

  public async transcribe(
    input: TranscriptionInput,
    outerSignal?: AbortSignal
  ): Promise<TranscriptionResult> {
    const base = (this.config.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(
      /\/$/,
      ''
    );
    const threshold = this.config.circuitFailureThreshold ?? 4;
    const resetMs = this.config.circuitResetMs ?? 30_000;
    if (this.openedAt !== null && Date.now() - this.openedAt < resetMs)
      throw new TranscriptionProviderError('PROVIDER_CIRCUIT_OPEN', true);
    if (this.openedAt !== null) {
      this.openedAt = null;
      this.failures = 0;
    }
    const controller = new AbortController();
    const abort = () => controller.abort(outerSignal?.reason);
    outerSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let fileName: string | undefined;
    try {
      const started = await this.fetcher(`${base}/upload/v1beta/files`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'x-goog-api-key': this.config.apiKey,
          'x-goog-upload-protocol': 'resumable',
          'x-goog-upload-command': 'start',
          'x-goog-upload-header-content-length': String(input.audio.byteLength),
          'x-goog-upload-header-content-type': input.mimeType,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ file: { display_name: `morubi-audio-${crypto.randomUUID()}` } })
      });
      if (!started.ok) throw this.httpError('GEMINI_UPLOAD_START', started.status);
      const uploadUrl = started.headers.get('x-goog-upload-url');
      if (!uploadUrl) throw new TranscriptionProviderError('GEMINI_UPLOAD_URL_MISSING', false);
      const uploaded = await this.fetcher(uploadUrl, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'x-goog-api-key': this.config.apiKey,
          'x-goog-upload-command': 'upload, finalize',
          'x-goog-upload-offset': '0',
          'content-length': String(input.audio.byteLength)
        },
        body: new Blob([input.audio.slice().buffer])
      });
      if (!uploaded.ok) throw this.httpError('GEMINI_UPLOAD', uploaded.status);
      const uploadedPayload = (await uploaded.json()) as {
        file?: { name?: string; uri?: string; mimeType?: string; mime_type?: string };
      };
      fileName = uploadedPayload.file?.name;
      const uri = uploadedPayload.file?.uri;
      if (!uri) throw new TranscriptionProviderError('GEMINI_FILE_URI_MISSING', false);
      const response = await this.fetcher(`${base}/v1beta/interactions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'x-goog-api-key': this.config.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model ?? 'gemini-3.5-transcribe',
          input: [{ type: 'audio', uri, mime_type: input.mimeType }],
          ...(input.languageHint ? { language_codes: [input.languageHint] } : {})
        })
      });
      if (!response.ok) throw this.httpError('GEMINI_TRANSCRIBE', response.status);
      const payload = (await response.json()) as Record<string, unknown>;
      const text =
        typeof payload.output_text === 'string'
          ? payload.output_text
          : typeof payload.outputText === 'string'
            ? payload.outputText
            : '';
      const usage = (payload.usage as Record<string, unknown> | undefined) ?? {};
      const result = validateTranscription({
        text,
        language: typeof payload.language === 'string' ? payload.language : null,
        confidence: typeof payload.confidence === 'number' ? payload.confidence : null,
        model:
          typeof payload.model === 'string'
            ? payload.model
            : (this.config.model ?? 'gemini-3.5-transcribe'),
        usage: {
          inputTokens: Number(usage.input_tokens ?? usage.inputTokens ?? 0),
          outputTokens: Number(usage.output_tokens ?? usage.outputTokens ?? 0),
          audioDurationMs: input.durationMs,
          measurement: Object.keys(usage).length ? 'ACTUAL' : 'ESTIMATED'
        }
      });
      this.failures = 0;
      return result;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= threshold) this.openedAt = Date.now();
      if (error instanceof TranscriptionProviderError) throw error;
      if (controller.signal.aborted) throw new TranscriptionProviderError('GEMINI_TIMEOUT', true);
      if (error instanceof TypeError)
        throw new TranscriptionProviderError('GEMINI_NETWORK_ERROR', true);
      throw new TranscriptionProviderError(
        error instanceof Error ? error.message : 'GEMINI_INVALID_RESPONSE',
        false
      );
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', abort);
      if (fileName)
        await this.fetcher(`${base}/v1beta/${fileName}`, {
          method: 'DELETE',
          headers: { 'x-goog-api-key': this.config.apiKey }
        }).catch(() => undefined);
    }
  }

  private httpError(prefix: string, status: number): TranscriptionProviderError {
    return new TranscriptionProviderError(
      `${prefix}_${status}`,
      status === 408 || status === 429 || status >= 500,
      status
    );
  }
}
