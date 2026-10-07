import { FixtureDecisionProvider } from './fixture-provider.js';
import type { DecisionContext, EventClassification, ObjectionType, StrategyType } from './types.js';

export interface GoldenScenario {
  id: string;
  title: string;
  turns: Array<{ actor: 'SELLER' | 'LEAD'; text: string }>;
  expected: {
    eventClassification: EventClassification;
    objection: ObjectionType | null;
    strategy: StrategyType;
    interventionExpected?: boolean;
  };
}

const groups: Array<{
  key: string;
  texts: string[];
  expected: GoldenScenario['expected'] | GoldenScenario['expected'][];
}> = [
  {
    key: 'price',
    texts: [
      'O preço ficou caro.',
      'O valor está acima do esperado.',
      'Precisamos de desconto.',
      'Nosso orçamento é menor.',
      'O preço inviabiliza agora.'
    ],
    expected: { eventClassification: 'OBJECTION', objection: 'PRICE', strategy: 'HANDLE_PRICE' }
  },
  {
    key: 'timing',
    texts: [
      'Agora não é o momento.',
      'Vamos deixar para o próximo trimestre.',
      'Estamos sem urgência.',
      'Podemos conversar mais tarde.',
      'Este projeto fica para depois, sem urgência.'
    ],
    expected: { eventClassification: 'OBJECTION', objection: 'TIMING', strategy: 'CREATE_URGENCY' }
  },
  {
    key: 'competitor',
    texts: [
      'Estamos avaliando um concorrente.',
      'Já usamos HubSpot.',
      'A outra solução parece completa.',
      'Também cotamos Salesforce.',
      'Hoje operamos com Pipedrive.'
    ],
    expected: {
      eventClassification: 'OBJECTION',
      objection: 'COMPETITOR',
      strategy: 'HANDLE_COMPETITOR'
    }
  },
  {
    key: 'authority',
    texts: [
      'Preciso da aprovação da diretoria.',
      'O decisor ainda não participou.',
      'Meu sócio precisa aprovar.',
      'Isso depende da aprovação interna.',
      'Vou levar para o decisor.'
    ],
    expected: {
      eventClassification: 'OBJECTION',
      objection: 'AUTHORITY',
      strategy: 'VALIDATE_AUTHORITY'
    }
  },
  {
    key: 'need',
    texts: [
      'Não precisamos disso.',
      'Hoje estamos sem necessidade.',
      'Já resolvemos esse problema.',
      'Não precisamos de outra ferramenta.',
      'A equipe diz que não há necessidade.'
    ],
    expected: { eventClassification: 'OBJECTION', objection: 'NEED', strategy: 'QUANTIFY_PAIN' }
  },
  {
    key: 'trust',
    texts: [
      'Ainda não confio nessa abordagem.',
      'Vocês têm referência?',
      'Quero ver um case.',
      'Tenho dúvidas de segurança.',
      'Sem um case não confio.'
    ],
    expected: { eventClassification: 'OBJECTION', objection: 'TRUST', strategy: 'BUILD_VALUE' }
  },
  {
    key: 'implementation',
    texts: [
      'A integração parece difícil.',
      'Temo que implementar seja demorado.',
      'A migração preocupa a equipe.',
      'A implantação parece complexa.',
      'Nossa integração é difícil.'
    ],
    expected: { eventClassification: 'OBJECTION', objection: 'IMPLEMENTATION', strategy: 'CLARIFY' }
  },
  {
    key: 'buying',
    texts: [
      'Quanto custa o plano anual?',
      'Como funciona o onboarding?',
      'Quando podemos começar?',
      'Pode explicar o contrato?',
      'Como avançamos para o próximo passo?'
    ],
    expected: [
      { eventClassification: 'BUYING_SIGNAL', objection: null, strategy: 'BUILD_VALUE' },
      { eventClassification: 'BUYING_SIGNAL', objection: null, strategy: 'CLOSE' },
      { eventClassification: 'BUYING_SIGNAL', objection: null, strategy: 'SECURE_NEXT_STEP' },
      { eventClassification: 'BUYING_SIGNAL', objection: null, strategy: 'CLOSE' },
      { eventClassification: 'BUYING_SIGNAL', objection: null, strategy: 'SECURE_NEXT_STEP' }
    ]
  },
  {
    key: 'rejection',
    texts: [
      'Não tenho interesse.',
      'Não vamos seguir.',
      'Encerre o contato.',
      'Não tenho interesse neste semestre.',
      'Decidimos que não vamos seguir.'
    ],
    expected: {
      eventClassification: 'REJECTION',
      objection: null,
      strategy: 'FOLLOW_UP',
      interventionExpected: false
    }
  },
  {
    key: 'next_step',
    texts: [
      'Envie a proposta.',
      'Podemos agendar uma reunião.',
      'Falamos amanhã.',
      'Vamos agendar com o time.',
      'Envie a proposta revisada.'
    ],
    expected: { eventClassification: 'NEXT_STEP', objection: null, strategy: 'SECURE_NEXT_STEP' }
  },
  {
    key: 'neutral',
    texts: [
      'Recebi o material.',
      'Obrigado pelo retorno.',
      'Vou compartilhar internamente.',
      'A empresa tem cinquenta pessoas.',
      'Anotei os pontos apresentados.'
    ],
    expected: { eventClassification: 'INFORMATION', objection: null, strategy: 'NONE' }
  }
];

export const goldenScenarios: GoldenScenario[] = groups.flatMap((group) =>
  group.texts.map((text, index) => ({
    id: `${group.key}-${index + 1}`,
    title: `${group.key} scenario ${index + 1}`,
    turns: [
      { actor: 'SELLER' as const, text: 'Qual é o principal ponto para avançarmos?' },
      { actor: 'LEAD' as const, text }
    ],
    expected: Array.isArray(group.expected) ? group.expected[index]! : group.expected
  }))
);

export interface CategoryMetrics {
  category: EventClassification;
  precision: number;
  recall: number;
  falsePositiveRate: number;
  support: number;
}

export interface EvaluationReport {
  scenarioCount: number;
  eventCount: number;
  classificationAccuracy: number;
  categories: CategoryMetrics[];
  objectionAccuracy: number;
  strategyAccuracy: number;
  interventionAccuracy: number;
  falseCardRate: number;
  cases: Array<{
    id: string;
    expectedIntervention: boolean;
    actualIntervention: boolean;
    deliveredInVisibleMode: boolean;
    classification: EventClassification;
  }>;
  calibration: Array<{
    from: number;
    to: number;
    count: number;
    averageConfidence: number;
    accuracy: number;
  }>;
}

function contextFor(scenario: GoldenScenario): DecisionContext {
  const current = scenario.turns.at(-1)!;
  return {
    currentEvent: {
      id: `event-${scenario.id}`,
      dealId: `deal-${scenario.id}`,
      contactId: `contact-${scenario.id}`,
      actorType: current.actor,
      type: 'MESSAGE',
      text: current.text,
      occurredAt: '2026-10-06T12:00:00.000Z'
    },
    dealState: {},
    hotContext: scenario.turns.slice(0, -1).map((turn, index) => ({
      id: `event-${scenario.id}-${index}`,
      dealId: `deal-${scenario.id}`,
      contactId: `contact-${scenario.id}`,
      actorType: turn.actor,
      type: 'MESSAGE',
      text: turn.text,
      occurredAt: '2026-10-06T11:59:00.000Z'
    })),
    relevantMemory: [],
    historicalMessages: [],
    previousDecision: null,
    sellerContext: { membershipId: null },
    playbookContext: [],
    budget: {
      recentEvents: 8,
      memoryFacts: 12,
      historicalMessages: 12,
      playbookSnippets: 4,
      maxTextCharacters: 12_000
    }
  };
}

export async function evaluateFixtureCorpus(): Promise<EvaluationReport> {
  const provider = new FixtureDecisionProvider();
  const rows = await Promise.all(
    goldenScenarios.map(async (scenario) => ({
      scenario,
      output: await provider.decide({
        context: contextFor(scenario),
        decisionVersion: 'fixture-v1',
        contextVersion: 'context-v1'
      })
    }))
  );
  const labels = [
    ...new Set(goldenScenarios.map((scenario) => scenario.expected.eventClassification))
  ];
  const categories = labels.map((category) => {
    const tp = rows.filter(
      (row) =>
        row.scenario.expected.eventClassification === category &&
        row.output.eventClassification === category
    ).length;
    const fp = rows.filter(
      (row) =>
        row.scenario.expected.eventClassification !== category &&
        row.output.eventClassification === category
    ).length;
    const fn = rows.filter(
      (row) =>
        row.scenario.expected.eventClassification === category &&
        row.output.eventClassification !== category
    ).length;
    const tn = rows.length - tp - fp - fn;
    return {
      category,
      precision: tp / Math.max(1, tp + fp),
      recall: tp / Math.max(1, tp + fn),
      falsePositiveRate: fp / Math.max(1, fp + tn),
      support: tp + fn
    };
  });
  const bins = [
    [0.6, 0.75],
    [0.75, 0.85],
    [0.85, 0.95],
    [0.95, 1.01]
  ] as const;
  return {
    scenarioCount: rows.length,
    eventCount: rows.reduce((count, row) => count + row.scenario.turns.length, 0),
    classificationAccuracy:
      rows.filter(
        (row) => row.output.eventClassification === row.scenario.expected.eventClassification
      ).length / rows.length,
    objectionAccuracy:
      rows.filter((row) => row.output.objection === row.scenario.expected.objection).length /
      rows.length,
    strategyAccuracy:
      rows.filter((row) => row.output.strategy === row.scenario.expected.strategy).length /
      rows.length,
    interventionAccuracy:
      rows.filter((row) => {
        const expected =
          row.scenario.expected.interventionExpected ?? row.scenario.expected.strategy !== 'NONE';
        return row.output.interventionNeeded === expected;
      }).length / rows.length,
    falseCardRate:
      rows.filter((row) => {
        const expected =
          row.scenario.expected.interventionExpected ?? row.scenario.expected.strategy !== 'NONE';
        return row.output.interventionNeeded && !expected;
      }).length / Math.max(1, rows.filter((row) => row.output.interventionNeeded).length),
    cases: rows.map((row) => {
      const expectedIntervention =
        row.scenario.expected.interventionExpected ?? row.scenario.expected.strategy !== 'NONE';
      const actualIntervention = row.output.interventionNeeded;
      return {
        id: row.scenario.id,
        expectedIntervention,
        actualIntervention,
        deliveredInVisibleMode:
          actualIntervention && row.output.strategy !== 'NONE' && row.output.confidence >= 0.65,
        classification: row.output.eventClassification
      };
    }),
    categories,
    calibration: bins.map(([from, to]) => {
      const matches = rows.filter(
        (row) => row.output.confidence >= from && row.output.confidence < to
      );
      return {
        from,
        to: Math.min(to, 1),
        count: matches.length,
        averageConfidence:
          matches.reduce((sum, row) => sum + row.output.confidence, 0) /
          Math.max(1, matches.length),
        accuracy:
          matches.filter(
            (row) => row.output.eventClassification === row.scenario.expected.eventClassification
          ).length / Math.max(1, matches.length)
      };
    })
  };
}

export function exportEvaluationJson(report: EvaluationReport): string {
  return JSON.stringify(report, null, 2);
}

export function exportEvaluationCsv(report: EvaluationReport): string {
  const rows = [
    'id,classification,expected_intervention,actual_intervention,delivered_in_visible_mode',
    ...report.cases.map((item) =>
      [
        item.id,
        item.classification,
        item.expectedIntervention,
        item.actualIntervention,
        item.deliveredInVisibleMode
      ].join(',')
    )
  ];
  return rows.join('\n');
}
