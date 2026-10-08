import { describe, expect, it } from 'vitest';
import { evaluatePostCallOutputs, syntheticPostCallScenarios } from './index.js';

describe('16-scenario synthetic post-call evaluation corpus', () => {
  it('measures factual consistency, hallucination, evidence, extraction, and seller consistency', () => {
    const cases = syntheticPostCallScenarios.map((scenario, scenarioIndex) => {
      const ids = scenario.transcript.map(
        (_, turnIndex) =>
          `00000000-0000-4000-8000-${String(scenarioIndex * 10 + turnIndex + 1).padStart(12, '0')}`
      );
      const evidence = (value: string, turnIndex = 0) => ({
        value,
        confidence: 0.85,
        evidenceTurnIds: [ids[turnIndex] ?? ids[0]!]
      });
      const actionItems = Array.from({ length: scenario.expected.actionItems }, () => ({
        description: 'Executar o próximo passo explicitamente combinado.',
        ownerRole: null,
        ownerName: null,
        dueAt: null,
        source: 'EXPLICIT' as const,
        confidence: 0.85,
        status: 'OPEN' as const,
        evidenceTurnIds: [ids.at(-1)!]
      }));
      const objections = Array.from({ length: scenario.expected.objections }, () =>
        evidence('Objeção comercial explicitamente registrada.')
      );
      const nextSteps = Array.from({ length: scenario.expected.nextSteps }, () =>
        evidence('Próximo passo explicitamente combinado.', ids.length - 1)
      );
      const sellerPerformance = Array.from(
        { length: scenario.expected.sellerDimensions },
        () => ({
          dimension: 'CLARITY' as const,
          rating: 'ADEQUATE' as const,
          score: null,
          confidence: 0.7,
          rationale: 'Avaliação qualitativa apoiada pela fala do vendedor.',
          evidenceTurnIds: [ids.at(-1)!]
        })
      );
      return {
        turnIds: ids,
        expected: scenario.expected,
        output: {
          executiveSummary: evidence(`Cenário sintético: ${scenario.name}.`),
          context: [evidence(scenario.transcript[0]!.text)],
          participants: [],
          durationSeconds: scenario.transcript.length * 30,
          topics: [evidence('Conversa comercial')],
          pains: [],
          needs: [],
          objections,
          sellerResponses: [],
          buyingSignals: [],
          decisionMakers: [],
          competitors: [],
          budget: [],
          timeline: [],
          commitments: [],
          explicitNextSteps: nextSteps,
          suggestedNextSteps: [],
          followUps: nextSteps,
          actionItems,
          unansweredQuestions: [],
          risks: objections,
          gaps: [],
          playbookObservations: [],
          sellerPerformance,
          dealAssessment: {
            currentStage: null,
            stageConfidence: 0.5,
            purchaseIntent: 'UNKNOWN' as const,
            closeProbabilityBucket: 'UNKNOWN' as const,
            blockers: objections,
            positiveSignals: [],
            recommendedNextAction: nextSteps[0] ?? null,
            evidenceTurnIds: [ids[0]!]
          },
          assessment: {
            outcome: 'INCONCLUSIVE' as const,
            confidence: 0.7,
            rationale: 'Resultado limitado ao que foi dito no transcript sintético.',
            evidenceTurnIds: [ids[0]!],
            experimentalScore: null
          },
          evidence: []
        }
      };
    });

    expect(syntheticPostCallScenarios.map((item) => item.name)).toEqual(
      expect.arrayContaining([
        'boa call',
        'discovery ruim',
        'objeção de preço',
        'sem decisor',
        'urgência alta',
        'cliente sem fit',
        'concorrente',
        'follow-up necessário',
        'call sem próximo passo',
        'venda praticamente fechada',
        'call muito curta',
        'transcript incompleto',
        'múltiplas objeções',
        'promessa do vendedor',
        'cliente pedindo prazo',
        'negociação'
      ])
    );
    expect(evaluatePostCallOutputs(cases)).toEqual({
      cases: 16,
      schemaPassRate: 1,
      factualConsistency: 1,
      hallucinationRate: 0,
      evidenceCoverage: 1,
      actionItemPrecision: 1,
      objectionExtraction: 1,
      nextStepExtraction: 1,
      sellerAssessmentConsistency: 1
    });
  });
});
