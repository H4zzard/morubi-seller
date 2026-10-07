import {
  decisionOutputSchema,
  type BuyingSignalType,
  type DecisionInput,
  type DecisionOutput,
  type DecisionProvider,
  type ObjectionType,
  type RiskType,
  type StrategyType
} from './types.js';

type Match = {
  objection: ObjectionType | null;
  risk: RiskType | null;
  strategy: StrategyType;
  confidence: number;
};

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function objection(text: string): Match | null {
  const patterns: Array<[RegExp, ObjectionType, RiskType, StrategyType]> = [
    [/preco|caro|desconto|orcamento|valor acima/, 'PRICE', 'PRICE_PRESSURE', 'HANDLE_PRICE'],
    [
      /concorrente|outra solucao|salesforce|hubspot|pipedrive/,
      'COMPETITOR',
      'COMPETITOR_PRESSURE',
      'HANDLE_COMPETITOR'
    ],
    [/decisor|diretoria|aprovacao|socio/, 'AUTHORITY', 'INTERNAL_APPROVAL', 'VALIDATE_AUTHORITY'],
    [
      /agora nao|proximo trimestre|sem urgencia|mais tarde/,
      'TIMING',
      'LOW_URGENCY',
      'CREATE_URGENCY'
    ],
    [/nao confio|referencia|case|seguranca/, 'TRUST', 'LOW_VALUE_PERCEPTION', 'BUILD_VALUE'],
    [
      /nao precisamos|sem necessidade|ja resolvemos/,
      'NEED',
      'LOW_VALUE_PERCEPTION',
      'QUANTIFY_PAIN'
    ],
    [
      /implementar|integracao.*dificil|migracao|implantacao/,
      'IMPLEMENTATION',
      'UNKNOWN',
      'CLARIFY'
    ],
    [
      /nao e prioridade|outras prioridades|sem prioridade/,
      'PRIORITY',
      'LOW_URGENCY',
      'CREATE_URGENCY'
    ]
  ];
  for (const [pattern, objectionType, risk, strategy] of patterns) {
    if (pattern.test(text)) return { objection: objectionType, risk, strategy, confidence: 0.91 };
  }
  return null;
}

function buyingSignal(text: string): { type: BuyingSignalType; strategy: StrategyType } | null {
  const patterns: Array<[RegExp, BuyingSignalType, StrategyType]> = [
    [/quanto custa|qual o valor|planos?/, 'pricing_question', 'BUILD_VALUE'],
    [/como implementar|como funciona a implantacao/, 'implementation_question', 'CLARIFY'],
    [/quando (podemos|conseguimos)|qual o prazo/, 'timeline_question', 'SECURE_NEXT_STEP'],
    [/contrato|termos comerciais/, 'contract_question', 'CLOSE'],
    [/proximo passo|como avancamos|agendar/, 'next_step_question', 'SECURE_NEXT_STEP'],
    [/quem precisa aprovar|processo de decisao/, 'decision_process', 'VALIDATE_AUTHORITY'],
    [/tem disponibilidade|quando comeca/, 'availability', 'SECURE_NEXT_STEP'],
    [/onboarding|treinamento inicial/, 'onboarding_question', 'CLOSE']
  ];
  for (const [pattern, type, strategy] of patterns)
    if (pattern.test(text)) return { type, strategy };
  return null;
}

export class FixtureDecisionProvider implements DecisionProvider {
  public readonly metadata = {
    provider: 'fixture',
    model: 'deterministic-commercial-rules',
    modelVersion: '1.0.0',
    configVersion: 'fixture-v1'
  } as const;

  public decide(input: DecisionInput): Promise<DecisionOutput> {
    const event = input.context.currentEvent;
    const text = normalize(event.text ?? '');
    const foundObjection = objection(text);
    const foundSignal = buyingSignal(text);
    const rejection = /nao tenho interesse|nao vamos seguir|encerre o contato/.test(text);
    const commitment = /vamos fechar|pode enviar o contrato|aprovado/.test(text);
    const nextStep = /reuniao|agendar|falamos (amanha|segunda)|envie a proposta/.test(text);
    const question = /\?|como |qual |quando |quanto /.test(text);
    const classification = foundObjection
      ? 'OBJECTION'
      : rejection
        ? 'REJECTION'
        : commitment
          ? 'COMMITMENT'
          : foundSignal
            ? 'BUYING_SIGNAL'
            : nextStep
              ? 'NEXT_STEP'
              : question
                ? 'QUESTION'
                : text.length < 4
                  ? 'OTHER'
                  : 'INFORMATION';
    const confidence =
      foundObjection?.confidence ??
      (foundSignal || rejection || commitment || nextStep ? 0.88 : 0.72);
    const strategy: StrategyType =
      foundObjection?.strategy ??
      foundSignal?.strategy ??
      (rejection ? 'FOLLOW_UP' : commitment ? 'CLOSE' : nextStep ? 'SECURE_NEXT_STEP' : 'NONE');
    const stateUpdates = [];
    if (foundObjection) {
      stateUpdates.push({
        operation: 'ADD' as const,
        field: 'objections' as const,
        value: foundObjection.objection,
        confidence,
        sourceEventIds: [event.id]
      });
      stateUpdates.push({
        operation: 'SET' as const,
        field: 'riskLevel' as const,
        value: foundObjection.risk === 'PRICE_PRESSURE' ? 'MEDIUM' : 'HIGH',
        confidence,
        sourceEventIds: [event.id]
      });
    }
    if (foundSignal || commitment) {
      stateUpdates.push({
        operation: 'SET' as const,
        field: 'intentLevel' as const,
        value: commitment ? 'HIGH' : 'MEDIUM',
        confidence,
        sourceEventIds: [event.id]
      });
    }
    if (nextStep) {
      stateUpdates.push({
        operation: 'SET' as const,
        field: 'nextStep' as const,
        value: event.text,
        confidence,
        sourceEventIds: [event.id]
      });
    }
    const budgetMatch = text.match(/r\$\s?([\d.,]*\d)/);
    const memoryUpdates = budgetMatch
      ? [
          {
            operation: 'UPSERT_FACT' as const,
            scopeType: 'DEAL_FACT' as const,
            scopeId: event.dealId,
            factType: 'BUDGET',
            value: budgetMatch[1] ?? '',
            confidence: 0.9,
            sourceEventIds: [event.id]
          }
        ]
      : [];
    return Promise.resolve(
      decisionOutputSchema.parse({
        significance:
          foundObjection || commitment || rejection
            ? 'HIGH'
            : foundSignal || nextStep
              ? 'MEDIUM'
              : 'LOW',
        eventClassification: classification,
        objection: foundObjection?.objection ?? null,
        buyingSignal: foundSignal?.type ?? null,
        risk: foundObjection?.risk ?? null,
        sentimentShift:
          rejection || foundObjection
            ? 'NEGATIVE'
            : commitment || foundSignal
              ? 'POSITIVE'
              : 'NEUTRAL',
        interventionNeeded: Boolean(foundObjection || foundSignal || commitment || nextStep),
        strategy,
        historicalRetrievalNeeded: /como falamos antes|conforme conversamos|historico/.test(text),
        stateUpdates,
        memoryUpdates,
        confidence
      })
    );
  }
}
