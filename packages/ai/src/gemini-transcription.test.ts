import { describe, expect, it, vi } from 'vitest';
import { GeminiTranscriptionProvider } from './gemini-transcription.js';
import type { TranscriptionProviderError } from './transcription.js';

const input = {
  audio: new Uint8Array([1, 2, 3]),
  mimeType: 'audio/wav' as const,
  durationMs: 18_000
};

describe('GeminiTranscriptionProvider', () => {
  it('uses Files + Interactions and removes the temporary remote file', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'x-goog-upload-url': 'https://upload.example/session' }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ file: { name: 'files/audio-1', uri: 'https://files.example/audio-1' } }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            output_text: 'Quero comparar o prazo.',
            model: 'gemini-3.5-transcribe',
            usage: { input_tokens: 12, output_tokens: 6 }
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const provider = new GeminiTranscriptionProvider(
      { apiKey: 'secret', timeoutMs: 5_000, configVersion: 'test' },
      fetcher
    );
    const result = await provider.transcribe(input);
    expect(result.text).toContain('prazo');
    expect(result.usage.measurement).toBe('ACTUAL');
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[2]?.[0]).toBe(
      'https://generativelanguage.googleapis.com/v1beta/interactions'
    );
    expect(fetcher.mock.calls[3]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it('classifies rate limits as retryable', async () => {
    const provider = new GeminiTranscriptionProvider(
      { apiKey: 'secret', timeoutMs: 5_000, configVersion: 'test' },
      () => Promise.resolve(new Response(null, { status: 429 }))
    );
    await expect(provider.transcribe(input)).rejects.toMatchObject<
      Partial<TranscriptionProviderError>
    >({ retryable: true, statusCode: 429 });
  });
});
