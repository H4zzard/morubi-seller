import type { DealStateSnapshot, StrategyType } from '@morubi/intelligence';

export const generativeProfiles = ['FAST_GENERATION', 'DEEP_REASONING'] as const;
export type GenerativeProfile = (typeof generativeProfiles)[number];

export const generationTypes = ['INTERVENTION_GUIDANCE', 'SUGGESTED_QUESTION'] as const;
export type GenerationType = (typeof generationTypes)[number];

export type GenerationValidationResult = 'VALID' | 'INVALID' | 'REVIEW_REQUIRED';

export interface GenerationInput {
  profile: GenerativeProfile;
  generationType: GenerationType;
  strategy: StrategyType;
  interventionType: string;
  currentEvent: { text: string; occurredAt: string };
  dealState: DealStateSnapshot;
  relevantMemory: Array<{ factType: string; value: string }>;
  hotContext: Array<{ actorType: string; text: string; occurredAt: string }>;
  companyRules: string[];
  playbookSnippets: string[];
  constraints: {
    maxInputCharacters: number;
    maxOutputCharacters: number;
    questionRequired: boolean;
  };
  correction?: string[];
}

export interface GenerationOutput {
  title: string;
  guidance: string;
  suggestedQuestion: string | null;
  warning: string | null;
  rationale: string;
  tone: 'DIRECT' | 'CONSULTATIVE' | 'EMPATHETIC';
  strategy: StrategyType;
}

export interface ProviderGenerationResult {
  output: unknown;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface GenerativeProviderMetadata {
  provider: string;
  configVersion: string;
}

export interface GenerativeProvider {
  readonly metadata: GenerativeProviderMetadata;
  generate(input: GenerationInput, signal?: AbortSignal): Promise<ProviderGenerationResult>;
}

export interface GenerationValidation {
  result: GenerationValidationResult;
  errors: string[];
  output: GenerationOutput | null;
}

export interface GenerationRunResult {
  profile: GenerativeProfile;
  provider: string;
  model: string;
  output: GenerationOutput | null;
  validation: GenerationValidation;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostMicros: bigint;
  generationLatencyMs: number;
}

export interface ProviderPricing {
  inputMicrosPerMillionTokens: bigint;
  outputMicrosPerMillionTokens: bigint;
}
