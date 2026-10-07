import { describe, expect, it } from 'vitest';
import { canTransitionDelivery, chooseHighestPriority, evaluateCardFatigue } from './copilot.js';

describe('copilot delivery policy', () => {
  it('prioritizes a critical risk over a buying signal', () => {
    expect(
      chooseHighestPriority([
        { priority: 60, type: 'buying' },
        { priority: 100, type: 'risk' }
      ])?.type
    ).toBe('risk');
  });

  it('suppresses neutral information, repeated categories and window overflow', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    const base = {
      now,
      candidate: { category: 'INFORMATION' as const, priority: 20, dedupeKey: 'neutral' },
      recent: [],
      maxCardsPerWindow: 2,
      cardWindowSeconds: 600,
      cooldownSeconds: 180,
      minimumPriority: 40
    };
    expect(evaluateCardFatigue(base).reason).toBe('NEUTRAL_INFORMATION_SUPPRESSED');
    expect(
      evaluateCardFatigue({
        ...base,
        candidate: { category: 'OBJECTION', priority: 80, dedupeKey: 'price' },
        recent: [{ category: 'OBJECTION', dedupeKey: 'other', createdAt: now }]
      }).reason
    ).toBe('CATEGORY_COOLDOWN');
    expect(
      evaluateCardFatigue({
        ...base,
        candidate: { category: 'DISCOVERY_GAP', priority: 50, dedupeKey: 'discovery' },
        recent: [
          { category: 'OBJECTION', dedupeKey: 'price', createdAt: now, priority: 80 },
          { category: 'BUYING_SIGNAL', dedupeKey: 'buying', createdAt: now, priority: 60 }
        ]
      }).reason
    ).toBe('MAX_CARDS_PER_WINDOW');
    expect(
      evaluateCardFatigue({
        ...base,
        candidate: { category: 'RISK', priority: 100, dedupeKey: 'risk' },
        recent: [
          { category: 'OBJECTION', dedupeKey: 'price', createdAt: now, priority: 80 },
          { category: 'BUYING_SIGNAL', dedupeKey: 'buying', createdAt: now, priority: 60 }
        ]
      }).reason
    ).toBe('PRIORITY_PREEMPTION');
  });

  it('enforces terminal lifecycle states', () => {
    expect(canTransitionDelivery('CREATED', 'DELIVERED')).toBe(true);
    expect(canTransitionDelivery('DELIVERED', 'VIEWED')).toBe(true);
    expect(canTransitionDelivery('VIEWED', 'APPLIED')).toBe(true);
    expect(canTransitionDelivery('DISMISSED', 'VIEWED')).toBe(false);
    expect(canTransitionDelivery('EXPIRED', 'APPLIED')).toBe(false);
  });
});
