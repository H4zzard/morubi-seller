import type { DealStateSnapshot, StrategyType } from '@morubi/intelligence';
import type { PostCallAnalysisInput, PostCallAnalysisResult } from '@morubi/post-call';

export const generativeProfiles = [
  'FAST_GENERATION',
  'DEEP_REASONING',
  'POST_CALL_ANALYSIS'
] as const;
export type GenerativeProfile = (typeof generativeProfiles)[number];
export type InterventionGenerativeProfile = Exclude<GenerativeProfile, 'POST_CALL_ANALYSIS'>;

export const generationTypes = ['INTERVENTION_GUIDANCE', 'SUGGESTED_QUESTION'] as const;
export type GenerationType = (typeof generationTypes)[number];

export type GenerationValidationResult = 'VALID' | 'INVALID' | 'REVIEW_REQUIRED';

export interface GenerationInput {
  profile: InterventionGenerativeProfile;
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
  analyzePostCall(
    input: PostCallAnalysisInput,
    signal?: AbortSignal
  ): Promise<PostCallAnalysisResult>;
}

export interface GenerationValidation {
  result: GenerationValidationResult;
  errors: string[];
  output: GenerationOutput | null;
}

export interface GenerationRunResult {
  profile: InterventionGenerativeProfile;
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
