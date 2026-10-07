import type {
  CRMConnector,
  CRMConnectorContext,
  ConnectorPage,
  ConnectorPageRequest,
  NormalizedContactRecord,
  NormalizedDealRecord
} from '../../core.js';
import { classifyHttpError } from '../../errors.js';
import type { FixtureContactDTO, FixtureDealDTO } from './dtos.js';
import { mapFixtureContact, mapFixtureDeal } from './mappers.js';

export interface FixtureCRMData {
  account: { id: string; name: string };
  contacts: FixtureContactDTO[];
  deals: FixtureDealDTO[];
}

export interface FixtureFailure {
  resource: 'contacts' | 'deals';
  statusCode: 429 | 500;
  times: number;
  retryAfterMs?: number;
}

export interface FixtureCRMOptions {
  data?: FixtureCRMData;
  pageSize?: number;
  failures?: FixtureFailure[];
}

export class FixtureCRMConnector implements CRMConnector {
  public readonly provider = 'fixture';
  public readonly capabilities = {
    contacts: true,
    deals: true,
    pipelines: false,
    stages: false,
    conversations: false,
    messages: false,
    incrementalSync: true,
    webhooks: false,
    credentialRefresh: false
  } as const;

  private data: FixtureCRMData;
  private readonly pageSize: number;
  private readonly failures: FixtureFailure[];

  public constructor(options: FixtureCRMOptions = {}) {
    this.data = options.data ?? createFixtureCRMData();
    this.pageSize = options.pageSize ?? 25;
    this.failures = (options.failures ?? []).map((failure) => ({ ...failure }));
  }

  public replaceData(data: FixtureCRMData): void {
    this.data = data;
  }

  public testConnection(context: CRMConnectorContext) {
    return Promise.resolve({
      ok: context.externalAccountId === this.data.account.id,
      account: {
        externalAccountId: this.data.account.id,
        externalAccountName: this.data.account.name,
        scopes: ['fixture.contacts.read', 'fixture.deals.read']
      }
    });
  }

  public getAccount() {
    return Promise.resolve({
      externalAccountId: this.data.account.id,
      externalAccountName: this.data.account.name,
      scopes: ['fixture.contacts.read', 'fixture.deals.read']
    });
  }

  public listContacts(
    context: CRMConnectorContext,
    request: ConnectorPageRequest
  ): Promise<ConnectorPage<NormalizedContactRecord>> {
    this.maybeFail('contacts');
    return Promise.resolve(
      page(
        this.filterUpdated(this.data.contacts, request.updatedSince).map((item) =>
          mapFixtureContact(context.externalAccountId, item)
        ),
        request,
        this.pageSize
      )
    );
  }

  public getContact(context: CRMConnectorContext, externalId: string) {
    const item = this.data.contacts.find((candidate) => candidate.id === externalId);
    return Promise.resolve(item ? mapFixtureContact(context.externalAccountId, item) : null);
  }

  public listDeals(
    context: CRMConnectorContext,
    request: ConnectorPageRequest
  ): Promise<ConnectorPage<NormalizedDealRecord>> {
    this.maybeFail('deals');
    return Promise.resolve(
      page(
        this.filterUpdated(this.data.deals, request.updatedSince).map((item) =>
          mapFixtureDeal(context.externalAccountId, item)
        ),
        request,
        this.pageSize
      )
    );
  }

  public getDeal(context: CRMConnectorContext, externalId: string) {
    const item = this.data.deals.find((candidate) => candidate.id === externalId);
    return Promise.resolve(item ? mapFixtureDeal(context.externalAccountId, item) : null);
  }

  private filterUpdated<T extends { updatedAt: string }>(
    items: T[],
    updatedSince?: Date | null
  ): T[] {
    if (!updatedSince) return items;
    return items.filter((item) => new Date(item.updatedAt).getTime() >= updatedSince.getTime());
  }

  private maybeFail(resource: FixtureFailure['resource']): void {
    const failure = this.failures.find(
      (candidate) => candidate.resource === resource && candidate.times > 0
    );
    if (!failure) return;
    failure.times -= 1;
    const errorInput: {
      statusCode: 429 | 500;
      retryAfterMs?: number;
      providerRequestId: string;
    } = {
      statusCode: failure.statusCode,
      providerRequestId: `fixture-${resource}-request`
    };
    if (failure.retryAfterMs !== undefined) errorInput.retryAfterMs = failure.retryAfterMs;
    throw classifyHttpError(errorInput);
  }
}

function page<T extends { source: { providerUpdatedAt?: Date | null } }>(
  items: T[],
  request: ConnectorPageRequest,
  defaultPageSize: number
): ConnectorPage<T> {
  const offset = decodeCursor(request.cursor);
  const limit = Math.max(1, Math.min(request.limit ?? defaultPageSize, defaultPageSize));
  const values = items.slice(offset, offset + limit);
  const nextOffset = offset + values.length;
  const watermark = values.reduce<Date | null>((latest, item) => {
    const candidate = item.source.providerUpdatedAt;
    return candidate && (!latest || candidate > latest) ? candidate : latest;
  }, null);
  return {
    items: values,
    nextCursor: nextOffset < items.length ? `fixture:${nextOffset}` : null,
    watermark
  };
}

function decodeCursor(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  const match = /^fixture:(\d+)$/.exec(cursor);
  if (!match?.[1]) throw classifyHttpError({ message: 'Invalid fixture cursor' });
  return Number(match[1]);
}

export function createFixtureCRMData(recordCount = 100): FixtureCRMData {
  const base = Date.parse('2026-09-01T00:00:00.000Z');
  const contacts = Array.from({ length: recordCount }, (_, index) => ({
    id: `contact-${index + 1}`,
    name: `Contato ${index + 1}`,
    email: `contact-${index + 1}@example.test`,
    company: `Empresa ${(index % 7) + 1}`,
    title: index % 2 === 0 ? 'Comprador' : 'Gestor',
    updatedAt: new Date(base + index * 60_000).toISOString(),
    archived: index === recordCount - 1
  }));
  const deals = Array.from({ length: Math.max(1, Math.floor(recordCount / 4)) }, (_, index) => ({
    id: `deal-${index + 1}`,
    title: `Oportunidade ${index + 1}`,
    valueMinor: String((index + 1) * 10_000),
    currency: 'BRL',
    status: index % 9 === 0 ? ('won' as const) : ('open' as const),
    stageId: index % 2 === 0 ? 'qualification' : 'proposal',
    stageLabel: index % 2 === 0 ? 'Qualificação' : 'Proposta',
    contactIds: [`contact-${index + 1}`],
    updatedAt: new Date(base + index * 120_000).toISOString(),
    archived: index === Math.max(1, Math.floor(recordCount / 4)) - 1
  }));
  return { account: { id: 'account-123', name: 'Fixture Company' }, contacts, deals };
}
