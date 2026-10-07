import { describe, expect, it } from 'vitest';
import { ContextBuilder, type ContextRetriever } from './context.js';

describe('ContextBuilder', () => {
  it('enforces item and text budgets without loading history by default', async () => {
    let historyCalls = 0;
    const retriever: ContextRetriever = {
      getDealState: () => Promise.resolve({}),
      getRecentEvents: (_id, limit) =>
        Promise.resolve(
          Array.from({ length: limit + 3 }, (_, i) => ({
            id: `e${i}`,
            dealId: 'd1',
            contactId: null,
            actorType: 'LEAD',
            type: 'MESSAGE',
            text: 'x'.repeat(20),
            occurredAt: new Date(i).toISOString()
          }))
        ),
      getRelevantMemory: () => Promise.resolve([]),
      getHistoricalMessages: () => {
        historyCalls += 1;
        return Promise.resolve([]);
      },
      getLastDecision: () => Promise.resolve(null),
      getPlaybookSnippets: () => Promise.resolve(['playbook'])
    };
    const context = await new ContextBuilder(retriever, {
      recentEvents: 2,
      memoryFacts: 1,
      historicalMessages: 1,
      playbookSnippets: 1,
      maxTextCharacters: 30
    }).build({
      id: 'current',
      dealId: 'd1',
      contactId: null,
      actorType: 'LEAD',
      type: 'MESSAGE',
      text: '1234567890',
      occurredAt: new Date().toISOString()
    });
    expect(context.hotContext).toHaveLength(2);
    expect(context.hotContext[1]?.text).toBeNull();
    expect(historyCalls).toBe(0);
  });
});
