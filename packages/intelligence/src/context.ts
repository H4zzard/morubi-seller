import type {
  ContextBudget,
  DecisionContext,
  DecisionEvent,
  DealStateSnapshot,
  MemoryFactContext,
  PreviousDecisionContext
} from './types.js';

export interface ContextRetriever {
  getDealState(dealId: string): Promise<DealStateSnapshot>;
  getRecentEvents(dealId: string, limit: number): Promise<DecisionEvent[]>;
  getRelevantMemory(
    dealId: string,
    contactId: string | null,
    limit: number
  ): Promise<MemoryFactContext[]>;
  getHistoricalMessages(
    dealId: string,
    limit: number
  ): Promise<Array<{ id: string; text: string; occurredAt: string }>>;
  getLastDecision(dealId: string): Promise<PreviousDecisionContext | null>;
  getPlaybookSnippets(dealId: string, limit: number): Promise<string[]>;
}

export const defaultContextBudget: ContextBudget = {
  recentEvents: 8,
  memoryFacts: 12,
  historicalMessages: 12,
  playbookSnippets: 4,
  maxTextCharacters: 12_000
};

function truncateText(value: string | null, remaining: { value: number }): string | null {
  if (!value || remaining.value <= 0) return null;
  const result = value.slice(0, remaining.value);
  remaining.value -= result.length;
  return result;
}

export class ContextBuilder {
  public constructor(
    private readonly retriever: ContextRetriever,
    private readonly budget: ContextBudget = defaultContextBudget
  ) {}

  public async build(
    currentEvent: DecisionEvent,
    options: { includeHistory?: boolean; sellerMembershipId?: string | null } = {}
  ): Promise<DecisionContext> {
    const [dealState, events, memory, previousDecision, playbook, messages] = await Promise.all([
      this.retriever.getDealState(currentEvent.dealId),
      this.retriever.getRecentEvents(currentEvent.dealId, this.budget.recentEvents),
      this.retriever.getRelevantMemory(
        currentEvent.dealId,
        currentEvent.contactId,
        this.budget.memoryFacts
      ),
      this.retriever.getLastDecision(currentEvent.dealId),
      this.retriever.getPlaybookSnippets(currentEvent.dealId, this.budget.playbookSnippets),
      options.includeHistory
        ? this.retriever.getHistoricalMessages(currentEvent.dealId, this.budget.historicalMessages)
        : Promise.resolve([])
    ]);
    const remaining = { value: this.budget.maxTextCharacters };
    const boundedCurrent = { ...currentEvent, text: truncateText(currentEvent.text, remaining) };
    const hotContext = events
      .filter((event) => event.id !== currentEvent.id)
      .slice(0, this.budget.recentEvents)
      .map((event) => ({
        ...event,
        text: truncateText(event.text, remaining)
      }));
    const historicalMessages = messages.slice(0, this.budget.historicalMessages).map((message) => ({
      ...message,
      text: truncateText(message.text, remaining) ?? ''
    }));
    const playbookContext = playbook
      .slice(0, this.budget.playbookSnippets)
      .map((snippet) => truncateText(snippet, remaining) ?? '');
    return {
      currentEvent: boundedCurrent,
      dealState,
      hotContext,
      relevantMemory: memory.slice(0, this.budget.memoryFacts),
      historicalMessages,
      previousDecision,
      sellerContext: { membershipId: options.sellerMembershipId ?? null },
      playbookContext,
      budget: this.budget
    };
  }
}
