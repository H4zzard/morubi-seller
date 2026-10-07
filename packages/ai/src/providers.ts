import { deepSeekChatResponseSchema } from './schema.js';
import { buildGenerationPrompt } from './prompt.js';
import type {
  GenerationInput,
  GenerationOutput,
  GenerativeProvider,
  ProviderGenerationResult
} from './types.js';

export type FixtureGenerationMode =
  | 'VALID'
  | 'INVALID_SCHEMA'
  | 'TIMEOUT'
  | 'FAILURE'
  | 'UNSAFE'
  | 'LONG_RESPONSE'
  | 'WRONG_STRATEGY';

function fixtureOutput(input: GenerationInput): GenerationOutput {
  const questions: Record<string, string> = {
    PRICE: 'Quando você compara os valores, quais resultados e escopos está considerando?',
    COMPETITOR: 'Quais critérios terão mais peso na comparação entre as soluções?',
    TIMING: 'O que precisaria mudar para este tema se tornar prioridade?',
    AUTHORITY: 'Quem mais precisa participar para validarmos o próximo passo?',
    TRUST: 'Que evidência reduziria o risco percebido nesta decisão?',
    IMPLEMENTATION: 'Qual é a principal preocupação com a implantação?',
    NEED: 'Qual impacto permanece sem solução no processo atual?',
    FOLLOW_UP: 'Qual seria um momento adequado para retomarmos este tema?'
  };
  return {
    title: `${input.interventionType} · orientação`,
    guidance: 'Explore o critério do lead antes de propor qualquer condição comercial.',
    suggestedQuestion:
      questions[input.interventionType] ??
      'Qual aspecto desta decisão merece ser esclarecido primeiro?',
    warning: 'Não faça promessas ou condições não autorizadas.',
    rationale: 'A orientação segue a estratégia estruturada e o contexto comercial disponível.',
    tone: 'CONSULTATIVE',
    strategy: input.strategy
  };
}

export class FixtureGenerativeProvider implements GenerativeProvider {
  public readonly metadata = { provider: 'fixture-generative', configVersion: 'fixture-v1' };
  public calls = 0;

  public constructor(private readonly mode: FixtureGenerationMode = 'VALID') {}

  public generate(input: GenerationInput): Promise<ProviderGenerationResult> {
    this.calls += 1;
    if (this.mode === 'TIMEOUT') throw new DOMException('Timed out', 'TimeoutError');
    if (this.mode === 'FAILURE') throw new GenerativeProviderError('FIXTURE_500', true, 500);
    if (this.mode === 'INVALID_SCHEMA')
      return Promise.resolve({
        output: { guidance: 42 },
        model: 'fixture-v1',
        inputTokens: 100,
        outputTokens: 10
      });
    const output = fixtureOutput(input);
    if (this.mode === 'UNSAFE') output.guidance = 'Posso oferecer 30% de desconto hoje.';
    if (this.mode === 'LONG_RESPONSE') output.guidance = 'x'.repeat(500);
    if (this.mode === 'WRONG_STRATEGY') output.strategy = 'CLOSE';
    return Promise.resolve({ output, model: 'fixture-v1', inputTokens: 120, outputTokens: 55 });
  }
}

export class GenerativeProviderError extends Error {
  public constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'GenerativeProviderError';
  }
}

export interface DeepSeekProviderConfig {
  apiKey: string;
  baseUrl: string;
  fastModel: string;
  reasoningModel: string;
  fastTimeoutMs: number;
  reasoningTimeoutMs: number;
  maxOutputTokens: number;
  configVersion: string;
  circuitFailureThreshold?: number;
  circuitResetMs?: number;
}

type Fetcher = typeof fetch;

export class DeepSeekGenerativeProvider implements GenerativeProvider {
  public readonly metadata;
  private consecutiveFailures = 0;
  private circuitOpenedAt: number | null = null;

  public constructor(
    private readonly config: DeepSeekProviderConfig,
    private readonly fetcher: Fetcher = fetch
  ) {
    this.metadata = { provider: 'deepseek', configVersion: config.configVersion };
  }

  public async generate(
    input: GenerationInput,
    outerSignal?: AbortSignal
  ): Promise<ProviderGenerationResult> {
    const threshold = this.config.circuitFailureThreshold ?? 4;
    const resetMs = this.config.circuitResetMs ?? 30_000;
    if (this.circuitOpenedAt !== null && Date.now() - this.circuitOpenedAt < resetMs)
      throw new GenerativeProviderError('PROVIDER_CIRCUIT_OPEN', true);
    if (this.circuitOpenedAt !== null) {
      this.circuitOpenedAt = null;
      this.consecutiveFailures = 0;
    }
    const timeout =
      input.profile === 'FAST_GENERATION'
        ? this.config.fastTimeoutMs
        : this.config.reasoningTimeoutMs;
    const controller = new AbortController();
    const abort = () => controller.abort(outerSignal?.reason);
    outerSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(
      () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
      timeout
    );
    try {
      const prompt = buildGenerationPrompt(input);
      const response = await this.fetcher(
        `${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            'content-type': 'application/json'
          },
          body: JSON.stringify({
            model:
              input.profile === 'FAST_GENERATION'
                ? this.config.fastModel
                : this.config.reasoningModel,
            messages: [
              { role: 'system', content: prompt.system },
              { role: 'user', content: prompt.user }
            ],
            response_format: { type: 'json_object' },
            max_tokens: this.config.maxOutputTokens,
            stream: false
          }),
          signal: controller.signal
        }
      );
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        throw new GenerativeProviderError(
          `DEEPSEEK_HTTP_${response.status}`,
          retryable,
          response.status
        );
      }
      const payload = deepSeekChatResponseSchema.parse(await response.json());
      const choice = payload.choices[0]!;
      if (choice.finish_reason === 'length')
        throw new GenerativeProviderError('DEEPSEEK_OUTPUT_TRUNCATED', true);
      if (!choice.message.content) throw new GenerativeProviderError('DEEPSEEK_EMPTY_OUTPUT', true);
      const output: unknown = JSON.parse(choice.message.content);
      this.consecutiveFailures = 0;
      return {
        output,
        model: payload.model,
        inputTokens: payload.usage?.prompt_tokens ?? 0,
        outputTokens: payload.usage?.completion_tokens ?? 0
      };
    } catch (error) {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= threshold) this.circuitOpenedAt = Date.now();
      if (error instanceof GenerativeProviderError) throw error;
      if (controller.signal.aborted) throw new GenerativeProviderError('DEEPSEEK_TIMEOUT', true);
      throw new GenerativeProviderError(
        error instanceof Error ? error.name : 'DEEPSEEK_INVALID_RESPONSE',
        false
      );
    } finally {
      clearTimeout(timer);
      outerSignal?.removeEventListener('abort', abort);
    }
  }
}
