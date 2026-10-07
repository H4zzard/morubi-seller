import { z } from 'zod';

export const eventClassifications = [
  'NORMAL',
  'QUESTION',
  'OBJECTION',
  'BUYING_SIGNAL',
  'COMMITMENT',
  'REJECTION',
  'INFORMATION',
  'NEXT_STEP',
  'RISK',
  'OTHER'
] as const;
export type EventClassification = (typeof eventClassifications)[number];

export const objectionTypes = [
  'PRICE',
  'TIMING',
  'AUTHORITY',
  'COMPETITOR',
  'TRUST',
  'NEED',
  'IMPLEMENTATION',
  'PRIORITY',
  'OTHER'
] as const;
export type ObjectionType = (typeof objectionTypes)[number];

export const buyingSignalTypes = [
  'pricing_question',
  'implementation_question',
  'timeline_question',
  'contract_question',
  'next_step_question',
  'decision_process',
  'availability',
  'onboarding_question'
] as const;
export type BuyingSignalType = (typeof buyingSignalTypes)[number];

export const riskTypes = [
  'NO_NEXT_STEP',
  'NO_DECISION_MAKER',
  'LOW_VALUE_PERCEPTION',
  'PRICE_PRESSURE',
  'COMPETITOR_PRESSURE',
  'LONG_SILENCE',
  'INTERNAL_APPROVAL',
  'LOW_URGENCY',
  'UNKNOWN'
] as const;
export type RiskType = (typeof riskTypes)[number];

export const strategyTypes = [
  'NONE',
  'INVESTIGATE',
  'CLARIFY',
  'BUILD_VALUE',
  'QUANTIFY_PAIN',
  'VALIDATE_AUTHORITY',
  'HANDLE_PRICE',
  'HANDLE_COMPETITOR',
  'CREATE_URGENCY',
  'SECURE_NEXT_STEP',
  'CLOSE',
  'FOLLOW_UP'
] as const;
export type StrategyType = (typeof strategyTypes)[number];

export const stateFieldKeys = [
  'stage',
  'canonicalStatus',
  'intentLevel',
  'riskLevel',
  'painPoints',
  'objections',
  'decisionMakers',
  'competitors',
  'budget',
  'timeline',
  'nextStep',
  'sentiment',
  'urgency',
  'authorityStatus',
  'needClarity',
  'valuePerception',
  'openQuestions'
] as const;
export type StateFieldKey = (typeof stateFieldKeys)[number];

export interface EvidenceValue<T = unknown> {
  value: T;
  confidence: number;
  sourceEventIds: string[];
  updatedAt: string;
  resolvedValues?: unknown[];
}

export type DealStateSnapshot = Partial<Record<StateFieldKey, EvidenceValue>>;

export interface StateUpdate {
  operation: 'SET' | 'ADD' | 'REMOVE' | 'RESOLVE';
  field: StateFieldKey;
  value: unknown;
  confidence: number;
  sourceEventIds: string[];
}

export interface MemoryUpdate {
  operation: 'UPSERT_FACT';
  scopeType: 'DEAL_FACT' | 'CONTACT_FACT';
  scopeId: string;
  factType: string;
  value: string;
  confidence: number;
  sourceEventIds: string[];
}

export interface DecisionEvent {
  id: string;
  dealId: string;
  contactId: string | null;
  actorType: string;
  type: string;
  text: string | null;
  occurredAt: string;
  contentOrigin?: 'TEXT' | 'AUDIO_TRANSCRIPT' | 'CALL_TRANSCRIPT' | 'MANUAL';
  liveCallSessionId?: string | null;
  liveTranscriptTurnId?: string | null;
}

export interface MemoryFactContext {
  id: string;
  scopeType: string;
  scopeId: string;
  factType: string;
  value: string;
  confidence: number;
  sourceEventIds: string[];
}

export interface PreviousDecisionContext {
  classification: EventClassification;
  strategy: StrategyType;
  confidence: number;
}

export interface DecisionContext {
  currentEvent: DecisionEvent;
  dealState: DealStateSnapshot;
  hotContext: DecisionEvent[];
  relevantMemory: MemoryFactContext[];
  historicalMessages: Array<{ id: string; text: string; occurredAt: string }>;
  previousDecision: PreviousDecisionContext | null;
  sellerContext: { membershipId: string | null };
  playbookContext: string[];
  budget: ContextBudget;
}

export interface ContextBudget {
  recentEvents: number;
  memoryFacts: number;
  historicalMessages: number;
  playbookSnippets: number;
  maxTextCharacters: number;
}

export interface DecisionInput {
  context: DecisionContext;
  decisionVersion: string;
  contextVersion: string;
}

const stateUpdateSchema = z.object({
  operation: z.enum(['SET', 'ADD', 'REMOVE', 'RESOLVE']),
  field: z.enum(stateFieldKeys),
  value: z.unknown(),
  confidence: z.number().min(0).max(1),
  sourceEventIds: z.array(z.string().min(1)).min(1)
});

const memoryUpdateSchema = z.object({
  operation: z.literal('UPSERT_FACT'),
  scopeType: z.enum(['DEAL_FACT', 'CONTACT_FACT']),
  scopeId: z.string().min(1),
  factType: z.string().min(1).max(80),
  value: z.string().min(1).max(500),
  confidence: z.number().min(0).max(1),
  sourceEventIds: z.array(z.string().min(1)).min(1)
});

export const decisionOutputSchema = z.object({
  significance: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  eventClassification: z.enum(eventClassifications),
  objection: z.enum(objectionTypes).nullable(),
  buyingSignal: z.enum(buyingSignalTypes).nullable(),
  risk: z.enum(riskTypes).nullable(),
  sentimentShift: z.enum(['NEGATIVE', 'NEUTRAL', 'POSITIVE']).nullable(),
  interventionNeeded: z.boolean(),
  strategy: z.enum(strategyTypes),
  historicalRetrievalNeeded: z.boolean(),
  stateUpdates: z.array(stateUpdateSchema).max(20),
  memoryUpdates: z.array(memoryUpdateSchema).max(20),
  confidence: z.number().min(0).max(1)
});

export type DecisionOutput = z.infer<typeof decisionOutputSchema>;

export interface DecisionProviderMetadata {
  provider: string;
  model: string;
  modelVersion: string | null;
  configVersion: string;
}

export interface DecisionProvider {
  readonly metadata: DecisionProviderMetadata;
  decide(input: DecisionInput): Promise<DecisionOutput>;
}

export type PolicyResult = 'ALLOW' | 'SUPPRESS' | 'ESCALATE' | 'SHADOW' | 'REQUIRE_MORE_CONTEXT';

export interface PolicyThresholds {
  objection: number;
  risk: number;
  buyingSignal: number;
  intervention: number;
  stateUpdate: number;
  memoryUpdate: number;
}

export interface PolicyConfig {
  shadowMode: boolean;
  interventionsVisible: boolean;
  thresholds: PolicyThresholds;
}

export interface PolicyDecision {
  result: PolicyResult;
  reason: string;
  persistStateUpdates: StateUpdate[];
  persistMemoryUpdates: MemoryUpdate[];
  prepareIntervention: boolean;
  whatWouldHaveBeenShown: boolean;
}

export interface InterventionTemplate {
  id: string;
  organizationId: string | null;
  category: string;
  subtype: string | null;
  strategy: StrategyType;
  title: string;
  guidance: string;
  suggestedQuestions: string[];
  warnings: string[];
  conditions: Record<string, unknown>;
  version: number;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface InterventionMatch {
  outcome: 'MATCHED' | 'GENERATION_REQUIRED' | 'SUPPRESSED';
  template: InterventionTemplate | null;
  question: string | null;
  source: 'ORGANIZATION' | 'GLOBAL' | 'NONE';
}
