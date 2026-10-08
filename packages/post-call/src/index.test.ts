import { describe, expect, it } from 'vitest';
import {
  buildSafeProposals,
  mergePostCallReports,
  reconcilePostCallReport,
  segmentTranscript
} from './index.js';

const id1 = '00000000-0000-4000-8000-000000000001';
const id2 = '00000000-0000-4000-8000-000000000002';

function evidence(value: string, evidenceTurnIds = [id1]) {
  return { value, confidence: 0.9, evidenceTurnIds };
}

function report() {
  return {
    executiveSummary: evidence('Resumo'),
    context: [],
    pains: [evidence('Retrabalho')],
    needs: [],
    objections: [],
    buyingSignals: [],
    decisionMakers: [],
    competitors: [],
    budget: [],
    timeline: [],
    commitments: [],
    explicitNextSteps: [evidence('Enviar proposta')],
    suggestedNextSteps: [],
    unansweredQuestions: [],
    risks: [],
    gaps: [],
    playbookObservations: [],
    assessment: {
      outcome: 'POSITIVE',
      confidence: 0.8,
      rationale: 'Avanço',
      evidenceTurnIds: [id1],
      experimentalScore: 80
    }
  };
}

describe('post-call intelligence core', () => {
  it('segments long transcripts without changing turn order', () => {
    const segments = segmentTranscript(
      [
        {
          id: id1,
          sequence: 1,
          speakerRole: 'LEAD',
          text: 'a'.repeat(80),
          startedAt: new Date().toISOString()
        },
        {
          id: id2,
          sequence: 2,
          speakerRole: 'SELLER',
          text: 'b'.repeat(80),
          startedAt: new Date().toISOString()
        }
      ],
      120
    );
    expect(segments).toHaveLength(2);
    expect(segments.flatMap((segment) => segment.turns.map((turn) => turn.id))).toEqual([id1, id2]);
  });

  it('drops unsupported evidence and never infers a missing budget', () => {
    const candidate = report();
    candidate.pains.push(evidence('Inventado', [id2]));
    const reconciled = reconcilePostCallReport(candidate, new Set([id1]));
    expect(reconciled.pains.map((item) => item.value)).toEqual(['Retrabalho']);
    expect(reconciled.budget).toEqual([]);
  });

  it('creates proposals but leaves writes to the deterministic intelligence engine', () => {
    const proposals = buildSafeProposals(
      reconcilePostCallReport(report(), new Set([id1])),
      new Set(['pain:retrabalho'])
    );
    expect(proposals.find((item) => item.field === 'pain')?.action).toBe('NOOP_DUPLICATE');
    expect(proposals.find((item) => item.field === 'next_step')?.action).toBe('PROPOSE');
  });

  it('merges evidence from long-call segments without losing later facts', () => {
    const first = reconcilePostCallReport(report(), new Set([id1]));
    const secondCandidate = report();
    secondCandidate.executiveSummary = evidence('Segundo bloco', [id2]);
    secondCandidate.pains = [evidence('Atraso', [id2])];
    secondCandidate.assessment.evidenceTurnIds = [id2];
    const second = reconcilePostCallReport(secondCandidate, new Set([id2]));
    const merged = reconcilePostCallReport(
      mergePostCallReports([first, second]),
      new Set([id1, id2])
    );
    expect(merged.pains.map((item) => item.value)).toEqual(['Retrabalho', 'Atraso']);
    expect(merged.executiveSummary.evidenceTurnIds).toEqual([id1, id2]);
  });
});
