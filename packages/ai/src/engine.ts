import { estimateGenerationCostMicros } from './cost.js';
import { GenerativeProviderError } from './providers.js';
import { GenerationContextSanitizer } from './sanitizer.js';
import type {
  GenerationInput,
  GenerationRunResult,
  GenerativeProvider,
  ProviderPricing
} from './types.js';
import { validateGeneration } from './validation.js';

export interface GenerationEngineOptions {
  maxValidationRetries: number;
  pricing: ProviderPricing;
  isStale?: () => Promise<boolean>;
}

export class GenerationEngine {
  public constructor(
    private readonly provider: GenerativeProvider,
    private readonly sanitizer = new GenerationContextSanitizer()
  ) {}

  public async run(
    rawInput: GenerationInput,
    options: GenerationEngineOptions
  ): Promise<GenerationRunResult> {
    let input = this.sanitizer.sanitize(rawInput);
    let attempts = 0;
    let lastTokens = { input: 0, output: 0 };
    let lastModel = 'unknown';
    const startedAt = performance.now();
    for (let retry = 0; retry <= options.maxValidationRetries; retry += 1) {
      if (await options.isStale?.()) throw new GenerativeProviderError('GENERATION_STALE', false);
      attempts += 1;
      const generated = await this.provider.generate(input);
      lastTokens = { input: generated.inputTokens, output: generated.outputTokens };
      lastModel = generated.model;
      const validation = validateGeneration(generated.output, input);
      if (validation.result === 'VALID') {
        if (await options.isStale?.()) throw new GenerativeProviderError('GENERATION_STALE', false);
        return {
          profile: input.profile,
          provider: this.provider.metadata.provider,
          model: generated.model,
          output: validation.output,
          validation,
          attempts,
          inputTokens: generated.inputTokens,
          outputTokens: generated.outputTokens,
          estimatedCostMicros: estimateGenerationCostMicros(
            generated.inputTokens,
            generated.outputTokens,
            options.pricing
          ),
          generationLatencyMs: Math.round(performance.now() - startedAt)
        };
      }
      if (retry < options.maxValidationRetries) input = { ...input, correction: validation.errors };
      else
        return {
          profile: input.profile,
          provider: this.provider.metadata.provider,
          model: generated.model,
          output: validation.output,
          validation,
          attempts,
          inputTokens: generated.inputTokens,
          outputTokens: generated.outputTokens,
          estimatedCostMicros: estimateGenerationCostMicros(
            generated.inputTokens,
            generated.outputTokens,
            options.pricing
          ),
          generationLatencyMs: Math.round(performance.now() - startedAt)
        };
    }
    throw new GenerativeProviderError(
      `GENERATION_UNREACHABLE:${lastModel}:${lastTokens.input}`,
      false
    );
  }
}
