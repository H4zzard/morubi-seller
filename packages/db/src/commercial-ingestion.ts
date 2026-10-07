import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { TenantContext } from '@morubi/domain';
import {
  payloadHash,
  sourceIdempotencyKey,
  type CanonicalCommercialEventInput,
  type CanonicalContactInput,
  type CanonicalConversationInput,
  type CanonicalDealInput,
  type CanonicalMessageInput,
  type ExternalEntityType,
  type SourceEnvelope
} from '@morubi/domain';
import type { MorubiDatabase } from './database.js';
import {
  commercialEvents,
  contacts,
  conversationParticipants,
  conversations,
  dealContacts,
  deals,
  externalEntityIdentities,
  messages,
  sourceRecords
} from './schema.js';
import { setTenantContext } from './tenant.js';

type DatabaseTransaction = Parameters<Parameters<MorubiDatabase['transaction']>[0]>[0];

export interface IngestionResult {
  id: string;
  deduplicated: boolean;
  applied: boolean;
  sourceRecordId: string;
}

interface IngestionState {
  tx: DatabaseTransaction;
  entityId: string;
  sourceRecordId: string;
  existingIdentity: boolean;
  observedAt: Date;
}

function normalizedProvider(value: string): string {
  return value.trim().toLowerCase();
}

function shouldApply(current: Date | null, incoming: Date | null | undefined): boolean {
  return !current || !incoming || incoming.getTime() >= current.getTime();
}

export class CommercialIngestionService {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  public async resolveExternalEntityId(
    entityType: ExternalEntityType,
    providerValue: string,
    externalWorkspaceIdValue: string,
    externalId: string
  ): Promise<string | null> {
    const provider = normalizedProvider(providerValue);
    const externalWorkspaceId = externalWorkspaceIdValue.trim();
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [identity] = await tx
        .select({ entityId: externalEntityIdentities.entityId })
        .from(externalEntityIdentities)
        .where(
          and(
            eq(externalEntityIdentities.organizationId, this.context.organizationId),
            eq(externalEntityIdentities.provider, provider),
            eq(externalEntityIdentities.externalWorkspaceId, externalWorkspaceId),
            eq(externalEntityIdentities.entityType, entityType),
            eq(externalEntityIdentities.externalId, externalId)
          )
        )
        .limit(1);
      return identity?.entityId ?? null;
    });
  }

  private async ingest(
    entityType: ExternalEntityType,
    source: SourceEnvelope,
    apply: (state: IngestionState) => Promise<boolean>
  ): Promise<IngestionResult> {
    const provider = normalizedProvider(source.provider);
    const externalWorkspaceId = source.externalWorkspaceId?.trim() ?? '';
    const idempotencyKey = sourceIdempotencyKey(source);
    const hash = payloadHash(source.rawPayload);
    const observedAt = source.observedAt ?? new Date();

    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const lockKey = `${this.context.organizationId}|${provider}|${externalWorkspaceId}|${entityType}|${source.externalId}`;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`);

      const [duplicate] = await tx
        .select()
        .from(sourceRecords)
        .where(
          and(
            eq(sourceRecords.organizationId, this.context.organizationId),
            eq(sourceRecords.provider, provider),
            eq(sourceRecords.externalWorkspaceId, externalWorkspaceId),
            eq(sourceRecords.entityType, entityType),
            eq(sourceRecords.idempotencyKey, idempotencyKey)
          )
        )
        .limit(1);
      if (duplicate?.normalizedEntityId) {
        return {
          id: duplicate.normalizedEntityId,
          deduplicated: true,
          applied: false,
          sourceRecordId: duplicate.id
        };
      }

      const [identity] = await tx
        .select()
        .from(externalEntityIdentities)
        .where(
          and(
            eq(externalEntityIdentities.organizationId, this.context.organizationId),
            eq(externalEntityIdentities.provider, provider),
            eq(externalEntityIdentities.externalWorkspaceId, externalWorkspaceId),
            eq(externalEntityIdentities.entityType, entityType),
            eq(externalEntityIdentities.externalId, source.externalId)
          )
        )
        .limit(1);
      const entityId = identity?.entityId ?? randomUUID();
      const sourceRecordId = randomUUID();

      await tx.insert(sourceRecords).values({
        id: sourceRecordId,
        organizationId: this.context.organizationId,
        provider,
        externalWorkspaceId,
        connectionId: source.connectionId,
        syncJobId: source.syncJobId,
        entityType,
        externalId: source.externalId,
        idempotencyKey,
        payloadHash: hash,
        rawPayload: source.rawPayload,
        providerOccurredAt: source.providerOccurredAt,
        providerUpdatedAt: source.providerUpdatedAt,
        ingestedAt: observedAt,
        normalizedEntityId: entityId
      });

      const applied = await apply({
        tx,
        entityId,
        sourceRecordId,
        existingIdentity: Boolean(identity),
        observedAt
      });

      if (identity) {
        await tx
          .update(externalEntityIdentities)
          .set({
            externalUrl: source.externalUrl ?? identity.externalUrl,
            connectionId: source.connectionId ?? identity.connectionId,
            lastSeenAt: observedAt,
            updatedAt: observedAt
          })
          .where(eq(externalEntityIdentities.id, identity.id));
      } else {
        await tx.insert(externalEntityIdentities).values({
          organizationId: this.context.organizationId,
          provider,
          externalWorkspaceId,
          connectionId: source.connectionId,
          entityType,
          entityId,
          externalId: source.externalId,
          externalUrl: source.externalUrl,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt
        });
      }

      return { id: entityId, deduplicated: false, applied, sourceRecordId };
    });
  }

  public ingestContact(
    source: SourceEnvelope,
    input: CanonicalContactInput
  ): Promise<IngestionResult> {
    return this.ingest(
      'CONTACT',
      source,
      async ({ tx, entityId, existingIdentity, observedAt }) => {
        if (existingIdentity) {
          const [current] = await tx
            .select()
            .from(contacts)
            .where(eq(contacts.id, entityId))
            .limit(1);
          if (!current || !shouldApply(current.providerUpdatedAt, source.providerUpdatedAt))
            return false;
          await tx
            .update(contacts)
            .set({
              name: input.name,
              email: input.email,
              phone: input.phone,
              companyName: input.companyName,
              jobTitle: input.jobTitle,
              primaryProvider: normalizedProvider(source.provider),
              syncStatus: 'SYNCED',
              providerUpdatedAt: source.providerUpdatedAt,
              lastSyncedAt: observedAt,
              archivedAt: input.archived ? observedAt : null,
              updatedAt: observedAt
            })
            .where(eq(contacts.id, entityId));
          return true;
        }
        await tx.insert(contacts).values({
          id: entityId,
          organizationId: this.context.organizationId,
          name: input.name,
          email: input.email,
          phone: input.phone,
          companyName: input.companyName,
          jobTitle: input.jobTitle,
          primaryProvider: normalizedProvider(source.provider),
          providerUpdatedAt: source.providerUpdatedAt,
          lastSyncedAt: observedAt,
          archivedAt: input.archived ? observedAt : null
        });
        return true;
      }
    );
  }

  public ingestDeal(source: SourceEnvelope, input: CanonicalDealInput): Promise<IngestionResult> {
    return this.ingest('DEAL', source, async ({ tx, entityId, existingIdentity, observedAt }) => {
      if (existingIdentity) {
        const [current] = await tx.select().from(deals).where(eq(deals.id, entityId)).limit(1);
        if (!current || !shouldApply(current.providerUpdatedAt, source.providerUpdatedAt))
          return false;
        await tx
          .update(deals)
          .set({
            title: input.title,
            amountMinor: input.amountMinor,
            currency: input.currency,
            status: input.status,
            providerStageId: input.providerStageId,
            providerStageLabel: input.providerStageLabel,
            ownerMembershipId: input.ownerMembershipId,
            primaryProvider: normalizedProvider(source.provider),
            syncStatus: 'SYNCED',
            providerUpdatedAt: source.providerUpdatedAt,
            lastSyncedAt: observedAt,
            openedAt: input.openedAt,
            closedAt: input.closedAt,
            archivedAt: input.archived ? observedAt : null,
            updatedAt: observedAt
          })
          .where(eq(deals.id, entityId));
      } else {
        await tx.insert(deals).values({
          id: entityId,
          organizationId: this.context.organizationId,
          title: input.title,
          amountMinor: input.amountMinor,
          currency: input.currency,
          status: input.status,
          providerStageId: input.providerStageId,
          providerStageLabel: input.providerStageLabel,
          ownerMembershipId: input.ownerMembershipId,
          primaryProvider: normalizedProvider(source.provider),
          providerUpdatedAt: source.providerUpdatedAt,
          lastSyncedAt: observedAt,
          openedAt: input.openedAt,
          closedAt: input.closedAt,
          archivedAt: input.archived ? observedAt : null
        });
      }
      if (input.contactIds) {
        await tx.delete(dealContacts).where(eq(dealContacts.dealId, entityId));
        if (input.contactIds.length > 0) {
          await tx.insert(dealContacts).values(
            input.contactIds.map((contactId, index) => ({
              organizationId: this.context.organizationId,
              dealId: entityId,
              contactId,
              isPrimary: index === 0
            }))
          );
        }
      }
      return true;
    });
  }

  public ingestConversation(
    source: SourceEnvelope,
    input: CanonicalConversationInput
  ): Promise<IngestionResult> {
    return this.ingest(
      'CONVERSATION',
      source,
      async ({ tx, entityId, existingIdentity, observedAt }) => {
        if (existingIdentity) {
          const [current] = await tx
            .select()
            .from(conversations)
            .where(eq(conversations.id, entityId))
            .limit(1);
          if (!current || !shouldApply(current.providerUpdatedAt, source.providerUpdatedAt))
            return false;
          await tx
            .update(conversations)
            .set({
              subject: input.subject,
              channel: input.channel,
              primaryContactId: input.primaryContactId,
              dealId: input.dealId,
              primaryProvider: normalizedProvider(source.provider),
              providerUpdatedAt: source.providerUpdatedAt,
              lastSyncedAt: observedAt,
              startedAt: input.startedAt,
              archivedAt: input.archived ? observedAt : null,
              updatedAt: observedAt
            })
            .where(eq(conversations.id, entityId));
        } else {
          await tx.insert(conversations).values({
            id: entityId,
            organizationId: this.context.organizationId,
            subject: input.subject,
            channel: input.channel,
            primaryContactId: input.primaryContactId,
            dealId: input.dealId,
            primaryProvider: normalizedProvider(source.provider),
            providerUpdatedAt: source.providerUpdatedAt,
            lastSyncedAt: observedAt,
            startedAt: input.startedAt,
            archivedAt: input.archived ? observedAt : null
          });
        }
        if (input.participants) {
          await tx
            .delete(conversationParticipants)
            .where(eq(conversationParticipants.conversationId, entityId));
          if (input.participants.length > 0) {
            await tx.insert(conversationParticipants).values(
              input.participants.map((participant) => ({
                organizationId: this.context.organizationId,
                conversationId: entityId,
                type: participant.type,
                contactId: participant.contactId,
                membershipId: participant.membershipId,
                externalParticipantId: participant.externalParticipantId,
                displayName: participant.displayName
              }))
            );
          }
        }
        return true;
      }
    );
  }

  public ingestMessage(
    source: SourceEnvelope,
    input: CanonicalMessageInput
  ): Promise<IngestionResult> {
    return this.ingest(
      'MESSAGE',
      source,
      async ({ tx, entityId, existingIdentity, observedAt }) => {
        const hash = payloadHash(source.rawPayload);
        if (existingIdentity) {
          const [current] = await tx
            .select()
            .from(messages)
            .where(eq(messages.id, entityId))
            .limit(1);
          if (!current || !shouldApply(current.providerUpdatedAt, source.providerUpdatedAt))
            return false;
          await tx
            .update(messages)
            .set({
              conversationId: input.conversationId,
              senderParticipantId: input.senderParticipantId,
              senderType: input.senderType,
              senderDisplayName: input.senderDisplayName,
              contentType: input.contentType,
              text: input.text,
              providerUpdatedAt: source.providerUpdatedAt,
              occurredAt: input.occurredAt,
              observedAt,
              payloadHash: hash,
              deletedAt: input.deleted ? observedAt : null,
              updatedAt: observedAt
            })
            .where(eq(messages.id, entityId));
        } else {
          await tx.insert(messages).values({
            id: entityId,
            organizationId: this.context.organizationId,
            conversationId: input.conversationId,
            senderParticipantId: input.senderParticipantId,
            senderType: input.senderType,
            senderDisplayName: input.senderDisplayName,
            contentType: input.contentType,
            text: input.text,
            provider: normalizedProvider(source.provider),
            providerUpdatedAt: source.providerUpdatedAt,
            occurredAt: input.occurredAt,
            observedAt,
            ingestedAt: observedAt,
            payloadHash: hash,
            deletedAt: input.deleted ? observedAt : null
          });
        }
        await tx
          .update(conversations)
          .set({
            lastMessageAt: sql`greatest(coalesce(${conversations.lastMessageAt}, ${input.occurredAt}), ${input.occurredAt})`,
            lastSyncedAt: observedAt,
            updatedAt: observedAt
          })
          .where(eq(conversations.id, input.conversationId));
        const [conversation] = await tx
          .select({ contactId: conversations.primaryContactId, dealId: conversations.dealId })
          .from(conversations)
          .where(eq(conversations.id, input.conversationId))
          .limit(1);
        if (conversation?.contactId) {
          await tx
            .update(contacts)
            .set({
              lastInteractionAt: sql`greatest(coalesce(${contacts.lastInteractionAt}, ${input.occurredAt}), ${input.occurredAt})`,
              updatedAt: observedAt
            })
            .where(eq(contacts.id, conversation.contactId));
        }
        if (conversation?.dealId) {
          await tx
            .update(deals)
            .set({
              lastInteractionAt: sql`greatest(coalesce(${deals.lastInteractionAt}, ${input.occurredAt}), ${input.occurredAt})`,
              updatedAt: observedAt
            })
            .where(eq(deals.id, conversation.dealId));
        }
        return true;
      }
    );
  }

  public ingestCommercialEvent(
    source: SourceEnvelope,
    input: CanonicalCommercialEventInput
  ): Promise<IngestionResult> {
    return this.ingest(
      'COMMERCIAL_EVENT',
      source,
      async ({ tx, entityId, sourceRecordId, existingIdentity, observedAt }) => {
        if (existingIdentity) return false;
        await tx.insert(commercialEvents).values({
          id: entityId,
          organizationId: this.context.organizationId,
          contactId: input.contactId,
          dealId: input.dealId,
          conversationId: input.conversationId,
          messageId: input.messageId,
          audioTranscriptId: input.audioTranscriptId,
          liveCallSessionId: input.liveCallSessionId,
          liveTranscriptTurnId: input.liveTranscriptTurnId,
          contentOrigin: input.contentOrigin,
          actorType: input.actorType,
          source: input.source,
          type: input.type,
          text: input.text,
          occurredAt: input.occurredAt,
          observedAt,
          metadata: input.metadata,
          sourceRecordId,
          supersedesEventId: input.supersedesEventId
        });
        return true;
      }
    );
  }
}
