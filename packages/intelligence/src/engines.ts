import type {
  DealStateSnapshot,
  InterventionMatch,
  InterventionTemplate,
  MemoryUpdate,
  PolicyConfig,
  PolicyDecision,
  StateFieldKey,
  StateUpdate
} from './types.js';
import { decisionOutputSchema, stateFieldKeys, type DecisionOutput } from './types.js';

export function buildProcessingKey(input: {
  eventId: string;
  decisionVersion: string;
  contextVersion: string;
  policyVersion: string;
  provider: string;
  model: string;
  modelVersion: string | null;
  configVersion: string;
}): string {
  return [
    input.eventId,
    input.decisionVersion,
    input.contextVersion,
    input.policyVersion,
    input.provider,
    input.model,
    input.modelVersion ?? 'unversioned',
    input.configVersion
  ].join(':');
}

const arrayFields = new Set<StateFieldKey>([
  'painPoints',
  'objections',
  'decisionMakers',
  'competitors',
  'openQuestions'
]);

function stableKey(value: unknown): string {
  return JSON.stringify(value, Object.keys((value as object | null) ?? {}).sort());
}

export function parseDecisionOutput(value: unknown): DecisionOutput {
  return decisionOutputSchema.parse(value);
}

export function applyStateUpdates(
  current: DealStateSnapshot,
  updates: StateUpdate[],
  updatedAt = new Date().toISOString()
): DealStateSnapshot {
  const next: DealStateSnapshot = structuredClone(current);
  for (const update of updates) {
    if (!(stateFieldKeys as readonly string[]).includes(update.field)) {
      throw new Error(`STATE_FIELD_NOT_ALLOWED:${String(update.field)}`);
    }
    const existing = next[update.field];
    if (arrayFields.has(update.field)) {
      if (update.operation === 'SET') {
        if (!Array.isArray(update.value)) throw new Error(`STATE_ARRAY_REQUIRED:${update.field}`);
        next[update.field] = {
          value: [...(update.value as unknown[])],
          confidence: update.confidence,
          sourceEventIds: [...new Set(update.sourceEventIds)],
          updatedAt
        };
        continue;
      }
      const values: unknown[] = Array.isArray(existing?.value)
        ? [...(existing.value as unknown[])]
        : [];
      const key = stableKey(update.value);
      const filtered = values.filter((value) => stableKey(value) !== key);
      if (update.operation === 'ADD') filtered.push(update.value);
      next[update.field] = {
        value: filtered,
        confidence: update.confidence,
        sourceEventIds: [
          ...new Set([...(existing?.sourceEventIds ?? []), ...update.sourceEventIds])
        ],
        updatedAt,
        ...(update.operation === 'RESOLVE'
          ? { resolvedValues: [...(existing?.resolvedValues ?? []), update.value] }
          : {})
      };
      continue;
    }
    if (update.operation !== 'SET') throw new Error(`STATE_OPERATION_NOT_ALLOWED:${update.field}`);
    next[update.field] = {
      value: update.value,
      confidence: update.confidence,
      sourceEventIds: [...new Set(update.sourceEventIds)],
      updatedAt
    };
  }
  return next;
}

export interface MemoryEvaluation {
  accepted: MemoryUpdate[];
  rejected: Array<{ update: MemoryUpdate; reason: string }>;
}

export function evaluateMemoryUpdates(
  updates: MemoryUpdate[],
  threshold: number
): MemoryEvaluation {
  const accepted: MemoryUpdate[] = [];
  const rejected: Array<{ update: MemoryUpdate; reason: string }> = [];
  const seen = new Set<string>();
  for (const update of updates) {
    const key = `${update.scopeType}:${update.scopeId}:${update.factType}:${update.value.trim().toLowerCase()}`;
    if (update.confidence < threshold) {
      rejected.push({ update, reason: 'BELOW_MEMORY_THRESHOLD' });
    } else if (seen.has(key)) {
      rejected.push({ update, reason: 'DUPLICATE_IN_DECISION' });
    } else {
      seen.add(key);
      accepted.push({ ...update, value: update.value.trim() });
    }
  }
  return { accepted, rejected };
}

export const defaultPolicyConfig: PolicyConfig = {
  shadowMode: true,
  interventionsVisible: false,
  thresholds: {
    objection: 0.7,
    risk: 0.75,
    buyingSignal: 0.7,
    intervention: 0.65,
    stateUpdate: 0.65,
    memoryUpdate: 0.8
  }
};

export function evaluatePolicy(output: DecisionOutput, config: PolicyConfig): PolicyDecision {
  const persistStateUpdates = output.stateUpdates.filter(
    (update) => update.confidence >= config.thresholds.stateUpdate
  );
  const persistMemoryUpdates = evaluateMemoryUpdates(
    output.memoryUpdates,
    config.thresholds.memoryUpdate
  ).accepted;
  const relevantThreshold = output.objection
    ? config.thresholds.objection
    : output.risk
      ? config.thresholds.risk
      : output.buyingSignal
        ? config.thresholds.buyingSignal
        : config.thresholds.intervention;
  const eligible = output.interventionNeeded && output.confidence >= relevantThreshold;

  if (output.historicalRetrievalNeeded) {
    return {
      result: 'REQUIRE_MORE_CONTEXT',
      reason: 'PROVIDER_REQUESTED_HISTORY',
      persistStateUpdates: [],
      persistMemoryUpdates: [],
      prepareIntervention: false,
      whatWouldHaveBeenShown: false
    };
  }
  if (
    output.risk &&
    output.significance === 'HIGH' &&
    output.confidence < config.thresholds.risk &&
    output.confidence >= 0.5
  ) {
    return {
      result: 'ESCALATE',
      reason: 'HIGH_SIGNIFICANCE_RISK_REQUIRES_REVIEW',
      persistStateUpdates,
      persistMemoryUpdates,
      prepareIntervention: false,
      whatWouldHaveBeenShown: false
    };
  }
  if (!eligible) {
    return {
      result: 'SUPPRESS',
      reason: output.interventionNeeded ? 'BELOW_INTERVENTION_THRESHOLD' : 'NO_INTERVENTION_NEEDED',
      persistStateUpdates,
      persistMemoryUpdates,
      prepareIntervention: false,
      whatWouldHaveBeenShown: false
    };
  }
  if (config.shadowMode || !config.interventionsVisible) {
    return {
      result: 'SHADOW',
      reason: config.shadowMode ? 'SHADOW_MODE_ENABLED' : 'INTERVENTIONS_NOT_VISIBLE',
      persistStateUpdates,
      persistMemoryUpdates,
      prepareIntervention: true,
      whatWouldHaveBeenShown: true
    };
  }
  return {
    result: 'ALLOW',
    reason: 'POLICY_THRESHOLDS_MET',
    persistStateUpdates,
    persistMemoryUpdates,
    prepareIntervention: true,
    whatWouldHaveBeenShown: true
  };
}

export function matchIntervention(
  templates: InterventionTemplate[],
  organizationId: string,
  output: DecisionOutput,
  prepare: boolean
): InterventionMatch {
  if (!prepare || output.strategy === 'NONE') {
    return { outcome: 'SUPPRESSED', template: null, question: null, source: 'NONE' };
  }
  const candidates = templates
    .filter(
      (template) =>
        template.status === 'ACTIVE' &&
        template.strategy === output.strategy &&
        (template.organizationId === organizationId || template.organizationId === null)
    )
    .sort((left, right) => {
      const scope =
        Number(right.organizationId === organizationId) -
        Number(left.organizationId === organizationId);
      return scope || right.version - left.version;
    });
  const template = candidates[0];
  if (!template) {
    return { outcome: 'GENERATION_REQUIRED', template: null, question: null, source: 'NONE' };
  }
  return {
    outcome: 'MATCHED',
    template,
    question: template.suggestedQuestions[0] ?? null,
    source: template.organizationId ? 'ORGANIZATION' : 'GLOBAL'
  };
}
