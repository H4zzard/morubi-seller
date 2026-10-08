export interface SyntheticPostCallScenario {
  id: string;
  name: string;
  transcript: Array<{ speakerRole: 'SELLER' | 'LEAD' | 'UNKNOWN'; text: string }>;
  expected: { actionItems: number; objections: number; nextSteps: number; sellerDimensions: number };
}

export const syntheticPostCallScenarios: SyntheticPostCallScenario[] = [
  { id: 'good-call', name: 'boa call', transcript: [{ speakerRole: 'SELLER', text: 'Qual impacto do processo manual?' }, { speakerRole: 'LEAD', text: 'Perdemos dez horas por semana. Vamos agendar a proposta.' }], expected: { actionItems: 1, objections: 0, nextSteps: 1, sellerDimensions: 1 } },
  { id: 'weak-discovery', name: 'discovery ruim', transcript: [{ speakerRole: 'SELLER', text: 'Vou mostrar o produto.' }, { speakerRole: 'LEAD', text: 'Ainda não entendi se resolve nosso caso.' }], expected: { actionItems: 0, objections: 0, nextSteps: 0, sellerDimensions: 1 } },
  { id: 'price-objection', name: 'objeção de preço', transcript: [{ speakerRole: 'LEAD', text: 'O preço está acima do orçamento.' }, { speakerRole: 'SELLER', text: 'Vamos revisar o escopo e retorno amanhã.' }], expected: { actionItems: 1, objections: 1, nextSteps: 1, sellerDimensions: 1 } },
  { id: 'no-authority', name: 'sem decisor', transcript: [{ speakerRole: 'LEAD', text: 'Preciso envolver a diretora que aprova.' }], expected: { actionItems: 0, objections: 0, nextSteps: 0, sellerDimensions: 0 } },
  { id: 'high-urgency', name: 'urgência alta', transcript: [{ speakerRole: 'LEAD', text: 'Precisamos começar ainda esta semana.' }, { speakerRole: 'SELLER', text: 'Vou enviar o cronograma hoje.' }], expected: { actionItems: 1, objections: 0, nextSteps: 1, sellerDimensions: 1 } },
  { id: 'no-fit', name: 'cliente sem fit', transcript: [{ speakerRole: 'LEAD', text: 'Nosso processo não possui equipe comercial.' }], expected: { actionItems: 0, objections: 0, nextSteps: 0, sellerDimensions: 0 } },
  { id: 'competitor', name: 'concorrente', transcript: [{ speakerRole: 'LEAD', text: 'Também estamos avaliando a Salesforce.' }], expected: { actionItems: 0, objections: 0, nextSteps: 0, sellerDimensions: 0 } },
  { id: 'follow-up', name: 'follow-up necessário', transcript: [{ speakerRole: 'SELLER', text: 'Vou retornar com a resposta técnica.' }], expected: { actionItems: 1, objections: 0, nextSteps: 1, sellerDimensions: 1 } },
  { id: 'no-next-step', name: 'call sem próximo passo', transcript: [{ speakerRole: 'LEAD', text: 'Obrigado pela conversa.' }], expected: { actionItems: 0, objections: 0, nextSteps: 0, sellerDimensions: 0 } },
  { id: 'almost-closed', name: 'venda praticamente fechada', transcript: [{ speakerRole: 'LEAD', text: 'Faz sentido, queremos contratar.' }, { speakerRole: 'SELLER', text: 'Vou enviar o contrato.' }], expected: { actionItems: 1, objections: 0, nextSteps: 1, sellerDimensions: 1 } },
  { id: 'very-short', name: 'call muito curta', transcript: [{ speakerRole: 'LEAD', text: 'Sem interesse.' }], expected: { actionItems: 0, objections: 0, nextSteps: 0, sellerDimensions: 0 } },
  { id: 'incomplete', name: 'transcript incompleto', transcript: [{ speakerRole: 'UNKNOWN', text: '[áudio incompleto]' }], expected: { actionItems: 0, objections: 0, nextSteps: 0, sellerDimensions: 0 } },
  { id: 'multiple-objections', name: 'múltiplas objeções', transcript: [{ speakerRole: 'LEAD', text: 'Está caro e o contrato parece arriscado.' }], expected: { actionItems: 0, objections: 1, nextSteps: 0, sellerDimensions: 0 } },
  { id: 'seller-promise', name: 'promessa do vendedor', transcript: [{ speakerRole: 'SELLER', text: 'Vou confirmar a integração e enviar a resposta.' }], expected: { actionItems: 1, objections: 0, nextSteps: 1, sellerDimensions: 1 } },
  { id: 'customer-deadline', name: 'cliente pedindo prazo', transcript: [{ speakerRole: 'LEAD', text: 'Pode me dar prazo até sexta-feira?' }], expected: { actionItems: 0, objections: 0, nextSteps: 0, sellerDimensions: 0 } },
  { id: 'negotiation', name: 'negociação', transcript: [{ speakerRole: 'LEAD', text: 'Se ajustar o preço, podemos avançar.' }, { speakerRole: 'SELLER', text: 'Vou validar as condições e retorno.' }], expected: { actionItems: 1, objections: 1, nextSteps: 1, sellerDimensions: 1 } }
];
