import type { NormalizedContactRecord, NormalizedDealRecord } from '../../core.js';
import type { FixtureContactDTO, FixtureDealDTO } from './dtos.js';

export function mapFixtureContact(
  accountId: string,
  dto: FixtureContactDTO
): NormalizedContactRecord {
  const updatedAt = new Date(dto.updatedAt);
  return {
    source: {
      provider: 'fixture',
      externalWorkspaceId: accountId,
      externalId: dto.id,
      idempotencyKey: `contact:${dto.id}:${dto.updatedAt}:${dto.archived ? 'archived' : 'active'}`,
      providerUpdatedAt: updatedAt,
      providerOccurredAt: updatedAt,
      rawPayload: dto
    },
    input: {
      name: dto.name,
      email: dto.email ?? null,
      phone: dto.phone ?? null,
      companyName: dto.company ?? null,
      jobTitle: dto.title ?? null,
      archived: dto.archived ?? false
    }
  };
}

export function mapFixtureDeal(accountId: string, dto: FixtureDealDTO): NormalizedDealRecord {
  const updatedAt = new Date(dto.updatedAt);
  return {
    source: {
      provider: 'fixture',
      externalWorkspaceId: accountId,
      externalId: dto.id,
      idempotencyKey: `deal:${dto.id}:${dto.updatedAt}:${dto.archived ? 'archived' : 'active'}`,
      providerUpdatedAt: updatedAt,
      providerOccurredAt: updatedAt,
      rawPayload: dto
    },
    input: {
      title: dto.title,
      amountMinor:
        dto.valueMinor === null || dto.valueMinor === undefined ? null : BigInt(dto.valueMinor),
      currency: dto.currency ?? null,
      status: dto.status.toUpperCase() as 'OPEN' | 'WON' | 'LOST',
      providerStageId: dto.stageId ?? null,
      providerStageLabel: dto.stageLabel ?? null,
      openedAt: dto.openedAt ? new Date(dto.openedAt) : null,
      closedAt: dto.closedAt ? new Date(dto.closedAt) : null,
      archived: dto.archived ?? false
    },
    relatedContactExternalIds: dto.contactIds ?? [],
    externalOwner: dto.owner ?? null
  };
}
