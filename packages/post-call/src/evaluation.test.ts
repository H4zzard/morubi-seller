import { describe, expect, it } from 'vitest';
import { evaluatePostCallOutputs } from './index.js';

describe('30-call synthetic post-call evaluation corpus', () => {
  it('tracks schema and unsupported evidence rates for thirty deterministic calls', () => {
    const cases = Array.from({ length: 30 }, (_, index) => {
      const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      const ev = { value: `Resumo ${index}`, confidence: 0.9, evidenceTurnIds: [id] };
      return {
        turnIds: [id],
        output: {
          executiveSummary: ev,
          context: [],
          pains: [],
          needs: [],
          objections: [],
          buyingSignals: [],
          decisionMakers: [],
          competitors: [],
          budget: [],
          timeline: [],
          commitments: [],
          explicitNextSteps: [],
          suggestedNextSteps: [],
          unansweredQuestions: [],
          risks: [],
          gaps: [],
          playbookObservations: [],
          assessment: {
            outcome: 'NEUTRAL',
            confidence: 0.8,
            rationale: 'Fixture',
            evidenceTurnIds: [id],
            experimentalScore: null
          }
        }
      };
    });
    expect(evaluatePostCallOutputs(cases)).toMatchObject({
      cases: 30,
      schemaPassRate: 1,
      evidencePrecision: 1,
      falseFactRate: 0
    });
  });
});
