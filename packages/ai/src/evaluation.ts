import type { StrategyType } from '@morubi/intelligence';
import { GenerationEngine } from './engine.js';
import { FixtureGenerativeProvider } from './providers.js';
import type { GenerationInput } from './types.js';

const categories = [
  'PRICE',
  'COMPETITOR',
  'TIMING',
  'AUTHORITY',
  'TRUST',
  'IMPLEMENTATION',
  'NEED',
  'FOLLOW_UP'
] as const;
const strategies: Record<(typeof categories)[number], StrategyType> = {
  PRICE: 'HANDLE_PRICE',
  COMPETITOR: 'HANDLE_COMPETITOR',
  TIMING: 'CREATE_URGENCY',
  AUTHORITY: 'VALIDATE_AUTHORITY',
  TRUST: 'BUILD_VALUE',
  IMPLEMENTATION: 'CLARIFY',
  NEED: 'QUANTIFY_PAIN',
  FOLLOW_UP: 'FOLLOW_UP'
};

export interface GenerativeEvaluationCase {
  id: string;
  category: (typeof categories)[number];
  input: GenerationInput;
  criteria: string[];
}

export const generativeEvaluationCorpus: GenerativeEvaluationCase[] = Array.from(
  { length: 56 },
  (_, index) => {
    const category = categories[index % categories.length]!;
    return {
      id: `generation-${String(index + 1).padStart(3, '0')}`,
      category,
      criteria: [
        'VALID_SCHEMA',
        'RIGHT_STRATEGY',
        'NO_INVENTED_PRICE',
        'QUESTION_REQUIRED',
        'BOUNDED'
      ],
      input: {
        profile:
          category === 'COMPETITOR' || category === 'TRUST' ? 'DEEP_REASONING' : 'FAST_GENERATION',
        generationType: 'INTERVENTION_GUIDANCE',
        strategy: strategies[category],
        interventionType: category,
        currentEvent: {
          text: `Mensagem sintética ${index + 1} da categoria ${category}.`,
          occurredAt: '2026-10-07T12:00:00.000Z'
        },
        dealState: {},
        relevantMemory: [],
        hotContext: [],
        companyRules: ['Não oferecer desconto sem aprovação.'],
        playbookSnippets: ['Faça uma pergunta curta antes de recomendar uma ação.'],
        constraints: {
          maxInputCharacters: 6_000,
          maxOutputCharacters: 700,
          questionRequired: true
        }
      }
    };
  }
);

export async function evaluateGenerativeCorpus() {
  const engine = new GenerationEngine(new FixtureGenerativeProvider());
  const rows = await Promise.all(
    generativeEvaluationCorpus.map(async (item) => {
      const result = await engine.run(item.input, {
        maxValidationRetries: 1,
        pricing: { inputMicrosPerMillionTokens: 0n, outputMicrosPerMillionTokens: 0n }
      });
      return {
        id: item.id,
        category: item.category,
        criteria: item.criteria,
        output: result.output,
        validationResult: result.validation.result,
        errors: result.validation.errors
      };
    })
  );
  return {
    caseCount: rows.length,
    validCount: rows.filter((row) => row.validationResult === 'VALID').length,
    passRate: rows.filter((row) => row.validationResult === 'VALID').length / rows.length,
    cases: rows
  };
}

export function exportGenerativeEvaluationJson(
  report: Awaited<ReturnType<typeof evaluateGenerativeCorpus>>
): string {
  return JSON.stringify(report, null, 2);
}

export function exportGenerativeEvaluationCsv(
  report: Awaited<ReturnType<typeof evaluateGenerativeCorpus>>
): string {
  const quote = (value: unknown) => {
    const serialized =
      value == null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
    return `"${serialized.replaceAll('"', '""')}"`;
  };
  return [
    ['id', 'category', 'criteria', 'validation_result', 'errors', 'output'].join(','),
    ...report.cases.map((item) =>
      [
        item.id,
        item.category,
        item.criteria.join('|'),
        item.validationResult,
        item.errors.join('|'),
        JSON.stringify(item.output)
      ]
        .map(quote)
        .join(',')
    )
  ].join('\n');
}
