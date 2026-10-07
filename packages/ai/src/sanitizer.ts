import type { DealStateSnapshot } from '@morubi/intelligence';
import type { GenerationInput } from './types.js';

const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const phonePattern = /(?:\+?\d[\d\s().-]{7,}\d)/g;
const opaqueIdPattern = /\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi;

export function redactObviousPii(value: string): string {
  return value
    .replace(emailPattern, '[EMAIL_REMOVIDO]')
    .replace(phonePattern, '[TELEFONE_REMOVIDO]')
    .replace(opaqueIdPattern, '[ID_REMOVIDO]');
}

function bounded(value: string, maximum: number): string {
  return redactObviousPii(value).slice(0, maximum);
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') return redactObviousPii(value);
  if (Array.isArray(value)) return (value as unknown[]).map((item) => sanitizeValue(item));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeValue(item)
      ])
    );
  return value;
}

function sanitizeState(snapshot: DealStateSnapshot): DealStateSnapshot {
  const allowed = [
    'stage',
    'canonicalStatus',
    'intentLevel',
    'riskLevel',
    'painPoints',
    'objections',
    'decisionMakers',
    'competitors',
    'timeline',
    'nextStep',
    'urgency',
    'authorityStatus',
    'needClarity',
    'valuePerception',
    'openQuestions'
  ] as const;
  return Object.fromEntries(
    allowed.flatMap((key) => {
      const found = snapshot[key];
      if (!found) return [];
      return [[key, { ...found, value: sanitizeValue(found.value), sourceEventIds: [] }]];
    })
  );
}

export class GenerationContextSanitizer {
  public sanitize(input: GenerationInput): GenerationInput {
    let remaining = Math.max(500, input.constraints.maxInputCharacters);
    const take = (value: string): string => {
      const result = bounded(value, remaining);
      remaining -= result.length;
      return result;
    };
    return {
      ...input,
      currentEvent: { ...input.currentEvent, text: take(input.currentEvent.text) },
      dealState: sanitizeState(input.dealState),
      relevantMemory: input.relevantMemory.slice(0, 8).map((fact) => ({
        factType: bounded(fact.factType, 80),
        value: take(fact.value)
      })),
      hotContext: input.hotContext.slice(0, 6).map((event) => ({
        actorType: bounded(event.actorType, 20),
        text: take(event.text),
        occurredAt: event.occurredAt
      })),
      companyRules: input.companyRules.slice(0, 12).map(take),
      playbookSnippets: input.playbookSnippets.slice(0, 6).map(take),
      ...(input.correction
        ? { correction: input.correction.slice(0, 8).map((item) => bounded(item, 160)) }
        : {})
    };
  }
}
