import type { GenerationInput, GenerationValidation } from './types.js';
import { generationOutputSchema } from './schema.js';
import type { GenerationOutput } from './types.js';

export interface PlaybookValidation {
  result: 'VALID' | 'INVALID' | 'REVIEW_REQUIRED';
  errors: string[];
}

export interface PlaybookValidator {
  validate(output: GenerationOutput, input: GenerationInput): PlaybookValidation;
}

export class DeterministicPlaybookValidator implements PlaybookValidator {
  public validate(output: GenerationOutput, input: GenerationInput): PlaybookValidation {
    const playbook = normalized(input.playbookSnippets.join(' '));
    if (/faca uma pergunta|pergunta antes/.test(playbook) && !output.suggestedQuestion)
      return { result: 'INVALID', errors: ['PLAYBOOK_QUESTION_REQUIRED'] };
    if (
      /revisao humana|aprovacao do manager/.test(playbook) &&
      /contrato|condicao comercial/i.test(output.guidance)
    )
      return { result: 'REVIEW_REQUIRED', errors: ['PLAYBOOK_REVIEW_REQUIRED'] };
    return { result: 'VALID', errors: [] };
  }
}

const unsafeRules: Array<[RegExp, string]> = [
  [/\b(?:garanto|garantimos|prometo|prometemos)\b/i, 'UNAUTHORIZED_PROMISE'],
  [/\b(?:assine|feche)\s+(?:hoje|agora).*(?:perder|expira|última chance)/i, 'FALSE_URGENCY'],
  [/\b(?:juridicamente|legalmente|retorno garantido|lucro garantido)\b/i, 'LEGAL_FINANCIAL_CLAIM'],
  [/\bR\$\s*\d|\b\d+[,.]?\d*%\s*(?:de\s*)?desconto/i, 'INVENTED_PRICE_OR_DISCOUNT'],
  [/\b(?:o contrato foi|contrato está)\s+(?:alterado|aprovado)/i, 'CONTRACT_CHANGE']
];

function normalized(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function companyRuleViolations(rules: string[], text: string): string[] {
  const value = normalized(text);
  const violations: string[] = [];
  for (const rule of rules) {
    const item = normalized(rule);
    if (
      item.includes('nao oferecer desconto') &&
      /\b(?:oferec|conced|aplic).{0,30}desconto/.test(value)
    )
      violations.push('COMPANY_RULE_DISCOUNT');
    const days = item.match(/nao afirmar implantacao em menos de (\d+) dias/);
    const offeredDays = value.match(/implantacao.{0,30}(\d+) dias/);
    if (days && offeredDays && Number(offeredDays[1]) < Number(days[1]))
      violations.push('COMPANY_RULE_IMPLEMENTATION_DEADLINE');
    const competitor = item.match(/nao mencionar concorrente\s+(.+)/);
    if (competitor?.[1] && value.includes(competitor[1].trim()))
      violations.push('COMPANY_RULE_COMPETITOR');
  }
  return violations;
}

export function validateGeneration(
  value: unknown,
  input: GenerationInput,
  playbookValidator: PlaybookValidator = new DeterministicPlaybookValidator()
): GenerationValidation {
  const parsed = generationOutputSchema.safeParse(value);
  if (!parsed.success) {
    return {
      result: 'INVALID',
      errors: parsed.error.issues.map((issue) => `SCHEMA:${issue.path.join('.')}:${issue.code}`),
      output: null
    };
  }
  const output = parsed.data;
  const visible = [output.title, output.guidance, output.suggestedQuestion, output.warning]
    .filter(Boolean)
    .join(' ');
  const errors = unsafeRules.filter(([pattern]) => pattern.test(visible)).map(([, code]) => code);
  errors.push(...companyRuleViolations(input.companyRules, visible));
  if (output.strategy !== input.strategy) errors.push('WRONG_STRATEGY');
  if (input.constraints.questionRequired && !output.suggestedQuestion)
    errors.push('QUESTION_REQUIRED');
  if (visible.length > input.constraints.maxOutputCharacters) errors.push('OUTPUT_TOO_LONG');
  if (errors.length > 0) return { result: 'INVALID', errors: [...new Set(errors)], output };
  const playbook = playbookValidator.validate(output, input);
  if (playbook.result === 'INVALID') return { result: 'INVALID', errors: playbook.errors, output };
  const review =
    playbook.result === 'REVIEW_REQUIRED' ||
    /\b(?:contrato|jurídic|financeir|compliance)\b/i.test(visible);
  return {
    result: review ? 'REVIEW_REQUIRED' : 'VALID',
    errors: review
      ? [
          ...playbook.errors,
          ...(/\b(?:contrato|jurídic|financeir|compliance)\b/i.test(visible)
            ? ['SENSITIVE_TOPIC_REQUIRES_REVIEW']
            : [])
        ]
      : [],
    output
  };
}
