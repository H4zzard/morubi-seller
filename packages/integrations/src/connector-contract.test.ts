import { describe, expect, it } from 'vitest';
import type { CRMConnector, CRMConnectorContext } from './core.js';
import { FixtureCRMConnector, createFixtureCRMData } from './providers/fixture/connector.js';

const context: CRMConnectorContext = {
  organizationId: '00000000-0000-4000-8000-000000000001',
  connectionId: '00000000-0000-4000-8000-000000000002',
  externalAccountId: 'account-123',
  secretReference: null,
  credentials: () => Promise.resolve(null)
};

function connectorContractTests(factory: () => CRMConnector): void {
  it('declares truthful, read-only capabilities and account health', async () => {
    const connector = factory();
    expect(connector.provider).toBeTruthy();
    expect(connector.capabilities.contacts).toBe(true);
    expect(connector.capabilities.deals).toBe(true);
    expect('createContact' in connector).toBe(false);
    await expect(connector.testConnection(context)).resolves.toMatchObject({ ok: true });
    await expect(connector.getAccount(context)).resolves.toMatchObject({
      externalAccountId: 'account-123'
    });
  });

  it('keeps provider pagination behind an opaque cursor without losing IDs', async () => {
    const connector = factory();
    const seen = new Set<string>();
    let cursor: string | null = null;
    do {
      const result = await connector.listContacts(context, { cursor, limit: 7 });
      result.items.forEach((item) => seen.add(item.source.externalId));
      cursor = result.nextCursor;
    } while (cursor);
    expect(seen.size).toBe(100);
  });

  it('normalizes timestamps, status and relationships without leaking provider DTO types', async () => {
    const connector = factory();
    const contacts = await connector.listContacts(context, { limit: 1 });
    const deals = await connector.listDeals(context, { limit: 1 });
    expect(contacts.items[0]?.source.providerUpdatedAt).toBeInstanceOf(Date);
    expect(deals.items[0]?.input.status).toBe('WON');
    expect(deals.items[0]?.relatedContactExternalIds).toEqual(['contact-1']);
  });

  it('supports incremental overlap and optional capabilities honestly', async () => {
    const connector = factory();
    const result = await connector.listContacts(context, {
      updatedSince: new Date('2026-09-01T01:30:00.000Z')
    });
    expect(result.items.length).toBeGreaterThan(0);
    expect(connector.capabilities.webhooks).toBe(false);
    expect(connector.capabilities.conversations).toBe(false);
  });
}

describe('FixtureCRMConnector contract', () => {
  connectorContractTests(
    () => new FixtureCRMConnector({ data: createFixtureCRMData(100), pageSize: 7 })
  );
});
