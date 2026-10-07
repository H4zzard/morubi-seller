import type { DecisionOutput } from './types.js';

export const copilotCategories = [
  'OBJECTION',
  'BUYING_SIGNAL',
  'RISK',
  'DISCOVERY_GAP',
  'NEXT_STEP',
  'INFORMATION'
] as const;

export type CopilotCategory = (typeof copilotCategories)[number];
export type DeliveryStatus =
  'CREATED' | 'DELIVERED' | 'VIEWED' | 'DISMISSED' | 'APPLIED' | 'EXPIRED';

export const defaultPriorityByCategory: Record<CopilotCategory, number> = {
  RISK: 100,
  OBJECTION: 80,
  BUYING_SIGNAL: 60,
  DISCOVERY_GAP: 50,
  NEXT_STEP: 40,
  INFORMATION: 20
};

export function categoryForDecision(output: DecisionOutput): CopilotCategory {
  if (output.risk) return 'RISK';
  if (output.objection) return 'OBJECTION';
  if (output.buyingSignal) return 'BUYING_SIGNAL';
  if (output.eventClassification === 'NEXT_STEP') return 'NEXT_STEP';
  if (output.strategy === 'INVESTIGATE' || output.strategy === 'QUANTIFY_PAIN') {
    return 'DISCOVERY_GAP';
  }
  return 'INFORMATION';
}

export function chooseHighestPriority<T extends { priority: number; createdAt?: Date }>(
  candidates: readonly T[]
): T | null {
  return (
    [...candidates].sort(
      (left, right) =>
        right.priority - left.priority ||
        (right.createdAt?.getTime() ?? 0) - (left.createdAt?.getTime() ?? 0)
    )[0] ?? null
  );
}

export interface FatiguePolicyInput {
  now: Date;
  candidate: { category: CopilotCategory; priority: number; dedupeKey: string };
  recent: Array<{
    category: CopilotCategory;
    dedupeKey: string;
    createdAt: Date;
    priority?: number;
  }>;
  maxCardsPerWindow: number;
  cardWindowSeconds: number;
  cooldownSeconds: number;
  minimumPriority: number;
}

export function evaluateCardFatigue(input: FatiguePolicyInput): {
  allowed: boolean;
  reason: string;
} {
  if (input.candidate.category === 'INFORMATION') {
    return { allowed: false, reason: 'NEUTRAL_INFORMATION_SUPPRESSED' };
  }
  if (input.candidate.priority < input.minimumPriority) {
    return { allowed: false, reason: 'BELOW_MINIMUM_PRIORITY' };
  }
  const windowStart = input.now.getTime() - input.cardWindowSeconds * 1_000;
  const inWindow = input.recent.filter((item) => item.createdAt.getTime() >= windowStart);
  if (inWindow.length >= input.maxCardsPerWindow) {
    const highestRecentPriority = Math.max(...inWindow.map((item) => item.priority ?? 100));
    if (input.candidate.priority <= highestRecentPriority) {
      return { allowed: false, reason: 'MAX_CARDS_PER_WINDOW' };
    }
  }
  const cooldownStart = input.now.getTime() - input.cooldownSeconds * 1_000;
  if (
    inWindow.some(
      (item) =>
        item.createdAt.getTime() >= cooldownStart &&
        (item.dedupeKey === input.candidate.dedupeKey || item.category === input.candidate.category)
    )
  ) {
    return { allowed: false, reason: 'CATEGORY_COOLDOWN' };
  }
  return {
    allowed: true,
    reason: inWindow.length >= input.maxCardsPerWindow ? 'PRIORITY_PREEMPTION' : 'ELIGIBLE'
  };
}

const allowedTransitions: Record<DeliveryStatus, readonly DeliveryStatus[]> = {
  CREATED: ['DELIVERED', 'EXPIRED'],
  DELIVERED: ['VIEWED', 'DISMISSED', 'APPLIED', 'EXPIRED'],
  VIEWED: ['DISMISSED', 'APPLIED', 'EXPIRED'],
  DISMISSED: [],
  APPLIED: [],
  EXPIRED: []
};

export function canTransitionDelivery(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return allowedTransitions[from].includes(to);
}
