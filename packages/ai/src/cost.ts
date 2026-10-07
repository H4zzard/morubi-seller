import type { ProviderPricing } from './types.js';

export function estimateGenerationCostMicros(
  inputTokens: number,
  outputTokens: number,
  pricing: ProviderPricing
): bigint {
  const input =
    (BigInt(Math.max(0, inputTokens)) * pricing.inputMicrosPerMillionTokens) / 1_000_000n;
  const output =
    (BigInt(Math.max(0, outputTokens)) * pricing.outputMicrosPerMillionTokens) / 1_000_000n;
  return input + output;
}
