import { describe, expect, it } from 'vitest';
import {
  applyStateUpdates,
  buildProcessingKey,
  evaluateMemoryUpdates,
  evaluatePolicy,
  matchIntervention,
  parseDecisionOutput
} from './engines.js';
import type { DecisionOutput, InterventionTemplate } from './types.js';

const output: DecisionOutput = {
  significance: 'HIGH',
  eventClassification: 'OBJECTION',
  objection: 'PRICE',
  buyingSignal: null,
  risk: 'PRICE_PRESSURE',
  sentimentShift: 'NEGATIVE',
  interventionNeeded: true,
  strategy: 'HANDLE_PRICE',
  historicalRetrievalNeeded: false,
  stateUpdates: [
    {
      operation: 'ADD',
      field: 'objections',
      value: 'PRICE',
      confidence: 0.9,
      sourceEventIds: ['e1']
    }
  ],
  memoryUpdates: [
    {
      operation: 'UPSERT_FACT',
      scopeType: 'DEAL_FACT',
      scopeId: 'd1',
      factType: 'BUDGET',
      value: '5000',
      confidence: 0.9,
      sourceEventIds: ['e1']
    }
  ],
  confidence: 0.9
};

describe('intelligence engines', () => {
  it('validates structured decisions', () => expect(parseDecisionOutput(output)).toEqual(output));
  it('rejects malformed provider output at runtime', () => {
    expect(() => parseDecisionOutput({ ...output, confidence: 2 })).toThrow();
  });
  it('versions the idempotency key across provider and workflow changes', () => {
    const base = {
      eventId: 'e1',
      decisionVersion: 'd1',
      contextVersion: 'c1',
      policyVersion: 'p1',
      provider: 'fixture',
      model: 'rules',
      modelVersion: '1',
      configVersion: 'cfg1'
    };
    expect(buildProcessingKey(base)).toBe(buildProcessingKey(base));
    expect(buildProcessingKey(base)).not.toBe(buildProcessingKey({ ...base, policyVersion: 'p2' }));
  });
  it('applies state deltas and preserves evidence', () => {
    const state = applyStateUpdates({}, output.stateUpdates, '2026-10-06T00:00:00.000Z');
    expect(state.objections).toMatchObject({
      value: ['PRICE'],
      confidence: 0.9,
      sourceEventIds: ['e1']
    });
    expect(() =>
      applyStateUpdates(state, [{ ...output.stateUpdates[0]!, operation: 'SET', value: 'PRICE' }])
    ).toThrow('STATE_ARRAY_REQUIRED');
  });
  it('filters durable memory independently', () => {
    const result = evaluateMemoryUpdates(
      [...output.memoryUpdates, { ...output.memoryUpdates[0]!, confidence: 0.3 }],
      0.8
    );
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toHaveLength(1);
  });
  it('deduplicates repeated facts within one decision', () => {
    const fact = output.memoryUpdates[0]!;
    const result = evaluateMemoryUpdates([fact, { ...fact }], 0.8);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected[0]?.reason).toBe('DUPLICATE_IN_DECISION');
  });
  it('keeps eligible interventions in shadow', () => {
    expect(
      evaluatePolicy(output, {
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
      })
    ).toMatchObject({ result: 'SHADOW', prepareIntervention: true });
  });
  it('suppresses low confidence but retains the decision', () => {
    expect(
      evaluatePolicy(
        { ...output, confidence: 0.3 },
        {
          shadowMode: false,
          interventionsVisible: true,
          thresholds: {
            objection: 0.7,
            risk: 0.75,
            buyingSignal: 0.7,
            intervention: 0.65,
            stateUpdate: 0.65,
            memoryUpdate: 0.8
          }
        }
      ).result
    ).toBe('SUPPRESS');
  });
  it('prefers the organization template over global', () => {
    const base: InterventionTemplate = {
      id: 'global',
      organizationId: null,
      category: 'OBJECTION',
      subtype: 'PRICE',
      strategy: 'HANDLE_PRICE',
      title: 'Global',
      guidance: 'Investigate.',
      suggestedQuestions: ['Why?'],
      warnings: [],
      conditions: {},
      version: 1,
      status: 'ACTIVE'
    };
    const match = matchIntervention(
      [base, { ...base, id: 'org', organizationId: 'org-1', title: 'Organization' }],
      'org-1',
      output,
      true
    );
    expect(match.template?.id).toBe('org');
    expect(match.source).toBe('ORGANIZATION');
  });
  it('marks generation required without invoking a generator', () => {
    const match = matchIntervention([], 'org-1', output, true);
    expect(match).toMatchObject({ outcome: 'GENERATION_REQUIRED', template: null });
  });
});
