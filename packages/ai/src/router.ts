import type { GenerativeProfile, GenerationInput } from './types.js';

export interface GenerativeRoutingPolicy {
  deepReasoningStrategies: string[];
  deepReasoningContextCharacters: number;
}

export const defaultGenerativeRoutingPolicy: GenerativeRoutingPolicy = {
  deepReasoningStrategies: ['HANDLE_COMPETITOR', 'BUILD_VALUE', 'QUANTIFY_PAIN'],
  deepReasoningContextCharacters: 4_000
};

export class GenerativeRouter {
  public constructor(
    private readonly policy: GenerativeRoutingPolicy = defaultGenerativeRoutingPolicy
  ) {}

  public route(input: Omit<GenerationInput, 'profile'>): GenerativeProfile {
    const contextSize =
      input.currentEvent.text.length +
      input.hotContext.reduce((sum, item) => sum + item.text.length, 0) +
      input.playbookSnippets.reduce((sum, item) => sum + item.length, 0);
    return this.policy.deepReasoningStrategies.includes(input.strategy) ||
      contextSize >= this.policy.deepReasoningContextCharacters
      ? 'DEEP_REASONING'
      : 'FAST_GENERATION';
  }
}
