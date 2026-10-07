import { describe, expect, it } from 'vitest';
import type { CRMConnectorContext } from './core.js';
import { FixtureCRMConnector, createFixtureCRMData } from './providers/fixture/connector.js';
import { withConnectorRetry } from './retry.js';

const context: CRMConnectorContext = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  connectionId: '00000000-0000-4000-8000-000000000002',
  externalAccountId: 'account-123',
  secretReference: null,
  credentials: () => Promise.resolve(null)
};

describe('FixtureCRMConnector scenarios', () => {
  it('simulates 500 and 429 without changing the page cursor', async () => {
    const connector = new FixtureCRMConnector({
      failures: [
        { resource: 'contacts', statusCode: 500, times: 1 },
        { resource: 'contacts', statusCode: 429, times: 1, retryAfterMs: 50 }
      ]
    });
    const delays: number[] = [];
    const result = await withConnectorRetry(
      () => connector.listContacts(context, { cursor: null, limit: 5 }),
      { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 100 },
      { random: () => 0, sleep: (delay) => (delays.push(delay), Promise.resolve()) }
    );
    expect(result.items.map((item) => item.source.externalId)).toEqual([
      'contact-1',
      'contact-2',
      'contact-3',
      'contact-4',
      'contact-5'
    ]);
    expect(delays).toEqual([1, 50]);
  });

  it('models duplicates, out-of-order updates and archive explicitly', async () => {
    const data = createFixtureCRMData(3);
    data.contacts = [
      data.contacts[1]!,
      data.contacts[0]!,
      { ...data.contacts[1]!, name: 'Duplicado' },
      { ...data.contacts[2]!, archived: true }
    ];
    const connector = new FixtureCRMConnector({ data, pageSize: 10 });
    const result = await connector.listContacts(context, {});
    expect(result.items.map((item) => item.source.externalId)).toEqual([
      'contact-2',
      'contact-1',
      'contact-2',
      'contact-3'
    ]);
    expect(result.items.at(-1)?.input.archived).toBe(true);
  });
});
