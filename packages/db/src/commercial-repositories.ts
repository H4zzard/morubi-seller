import { and, asc, desc, eq, gt, ilike, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import type {
  ContactDetailDto,
  ContactSummaryDto,
  ConversationMessagesDto,
  ConversationParticipantDto,
  ConversationSummaryDto,
  CursorPageDto,
  DealDetailDto,
  DealSummaryDto,
  ExternalIdentityDto,
  MessageDto
} from '@morubi/contracts';
import { errors, type TenantContext } from '@morubi/domain';
import type { MorubiDatabase } from './database.js';
import {
  contacts,
  audioAssets,
  audioTranscripts,
  conversationReadStates,
  conversationParticipants,
  conversations,
  dealContacts,
  deals,
  externalEntityIdentities,
  memberships,
  messages,
  user
} from './schema.js';
import { setTenantContext } from './tenant.js';

interface PageInput {
  cursor?: string | undefined;
  limit: number;
  search?: string | undefined;
}

interface CursorValue {
  at: string;
  id: string;
}

function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCursor(value?: string): CursorValue | null {
  if (!value) return null;
  try {
    const candidate = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as unknown;
    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof Reflect.get(candidate, 'at') === 'string' &&
      !Number.isNaN(Date.parse(Reflect.get(candidate, 'at') as string)) &&
      typeof Reflect.get(candidate, 'id') === 'string'
    ) {
      return candidate as CursorValue;
    }
  } catch {
    // The public error deliberately does not expose cursor internals.
  }
  throw errors.validation([{ path: 'cursor', message: 'Cursor inválido.' }]);
}

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

function externalIdentityDto(
  row: typeof externalEntityIdentities.$inferSelect
): ExternalIdentityDto {
  return {
    provider: row.provider,
    externalWorkspaceId: row.externalWorkspaceId,
    externalId: row.externalId,
    externalUrl: row.externalUrl,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString()
  };
}

function contactDto(row: typeof contacts.$inferSelect): ContactSummaryDto {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    companyName: row.companyName,
    jobTitle: row.jobTitle,
    primaryProvider: row.primaryProvider,
    syncStatus: row.syncStatus,
    providerUpdatedAt: iso(row.providerUpdatedAt),
    lastSyncedAt: iso(row.lastSyncedAt),
    lastInteractionAt: iso(row.lastInteractionAt),
    updatedAt: row.updatedAt.toISOString()
  };
}

function dealDto(
  row: typeof deals.$inferSelect,
  ownerName: string | null,
  contactNames: string[]
): DealSummaryDto {
  return {
    id: row.id,
    title: row.title,
    amountMinor: row.amountMinor?.toString() ?? null,
    currency: row.currency,
    status: row.status,
    providerStageId: row.providerStageId,
    providerStageLabel: row.providerStageLabel,
    ownerName,
    primaryProvider: row.primaryProvider,
    contactNames,
    syncStatus: row.syncStatus,
    providerUpdatedAt: iso(row.providerUpdatedAt),
    lastSyncedAt: iso(row.lastSyncedAt),
    lastInteractionAt: iso(row.lastInteractionAt),
    updatedAt: row.updatedAt.toISOString()
  };
}

function participantDto(
  row: typeof conversationParticipants.$inferSelect
): ConversationParticipantDto {
  return {
    id: row.id,
    type: row.type,
    contactId: row.contactId,
    membershipId: row.membershipId,
    externalParticipantId: row.externalParticipantId,
    displayName: row.displayName
  };
}

function messageDto(
  row: typeof messages.$inferSelect,
  audio?: {
    asset: typeof audioAssets.$inferSelect;
    transcript: typeof audioTranscripts.$inferSelect | null;
  }
): MessageDto {
  return {
    id: row.id,
    conversationId: row.conversationId,
    senderParticipantId: row.senderParticipantId,
    senderType: row.senderType,
    senderDisplayName: row.senderDisplayName,
    contentType: row.contentType,
    text: row.deletedAt ? null : row.text,
    provider: row.provider,
    occurredAt: row.occurredAt.toISOString(),
    observedAt: row.observedAt.toISOString(),
    ingestedAt: row.ingestedAt.toISOString(),
    deletedAt: iso(row.deletedAt),
    audio: audio
      ? {
          assetId: audio.asset.id,
          mimeType: audio.asset.mimeType,
          durationMs: audio.asset.durationMs,
          status: audio.asset.status,
          transcriptStatus: audio.transcript
            ? 'READY'
            : audio.asset.status === 'FAILED'
              ? 'FAILED'
              : audio.asset.status === 'TRANSCRIBING'
                ? 'PROCESSING'
                : audio.asset.status === 'DELETED' || audio.asset.status === 'EXPIRED'
                  ? 'UNAVAILABLE'
                  : 'PENDING',
          transcript: row.deletedAt ? null : (audio.transcript?.text ?? null),
          language: audio.transcript?.language ?? null,
          failureCode: audio.asset.failureCode
        }
      : null
  };
}

type DatabaseTransaction = Parameters<Parameters<MorubiDatabase['transaction']>[0]>[0];

async function dealContactsByDeal(tx: DatabaseTransaction, dealIds: string[]) {
  const result = new Map<
    string,
    Array<{ id: string; name: string; email: string | null; companyName: string | null }>
  >();
  if (dealIds.length === 0) return result;
  const rows = await tx
    .select({ dealId: dealContacts.dealId, contact: contacts })
    .from(dealContacts)
    .innerJoin(
      contacts,
      and(
        eq(contacts.id, dealContacts.contactId),
        eq(contacts.organizationId, dealContacts.organizationId)
      )
    )
    .where(inArray(dealContacts.dealId, dealIds));
  for (const { dealId, contact } of rows) {
    const values = result.get(dealId) ?? [];
    values.push({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      companyName: contact.companyName
    });
    result.set(dealId, values);
  }
  return result;
}

async function participantsByConversation(tx: DatabaseTransaction, conversationIds: string[]) {
  const result = new Map<string, ConversationParticipantDto[]>();
  if (conversationIds.length === 0) return result;
  const rows = await tx
    .select()
    .from(conversationParticipants)
    .where(inArray(conversationParticipants.conversationId, conversationIds))
    .orderBy(asc(conversationParticipants.createdAt));
  for (const row of rows) {
    const values = result.get(row.conversationId) ?? [];
    values.push(participantDto(row));
    result.set(row.conversationId, values);
  }
  return result;
}

export class ContactRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  public async list(input: PageInput): Promise<CursorPageDto<ContactSummaryDto>> {
    const cursor = decodeCursor(input.cursor);
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const conditions = [
        eq(contacts.organizationId, this.context.organizationId),
        isNull(contacts.archivedAt)
      ];
      if (cursor) {
        const at = new Date(cursor.at);
        conditions.push(
          or(
            lt(contacts.updatedAt, at),
            and(eq(contacts.updatedAt, at), lt(contacts.id, cursor.id))
          )!
        );
      }
      if (input.search) {
        const pattern = `%${input.search}%`;
        conditions.push(
          sql`(coalesce(${contacts.name}, '') || ' ' || coalesce(${contacts.email}, '') || ' ' || coalesce(${contacts.phone}, '') || ' ' || coalesce(${contacts.companyName}, '')) ilike ${pattern}`
        );
      }
      const rows = await tx
        .select()
        .from(contacts)
        .where(and(...conditions))
        .orderBy(desc(contacts.updatedAt), desc(contacts.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      const last = page.at(-1);
      return {
        items: page.map(contactDto),
        nextCursor:
          hasMore && last ? encodeCursor({ at: last.updatedAt.toISOString(), id: last.id }) : null
      };
    });
  }

  public async getById(id: string): Promise<ContactDetailDto | null> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [contact] = await tx
        .select()
        .from(contacts)
        .where(
          and(
            eq(contacts.organizationId, this.context.organizationId),
            eq(contacts.id, id),
            isNull(contacts.archivedAt)
          )
        )
        .limit(1);
      if (!contact) return null;
      const [identities, relatedDeals, relatedConversations] = await Promise.all([
        tx
          .select()
          .from(externalEntityIdentities)
          .where(
            and(
              eq(externalEntityIdentities.organizationId, this.context.organizationId),
              eq(externalEntityIdentities.entityType, 'CONTACT'),
              eq(externalEntityIdentities.entityId, id)
            )
          ),
        tx
          .select({ deal: deals })
          .from(dealContacts)
          .innerJoin(
            deals,
            and(
              eq(deals.id, dealContacts.dealId),
              eq(deals.organizationId, dealContacts.organizationId)
            )
          )
          .where(
            and(
              eq(dealContacts.organizationId, this.context.organizationId),
              eq(dealContacts.contactId, id),
              isNull(deals.archivedAt)
            )
          ),
        tx
          .select()
          .from(conversations)
          .where(
            and(
              eq(conversations.organizationId, this.context.organizationId),
              eq(conversations.primaryContactId, id),
              isNull(conversations.archivedAt)
            )
          )
          .orderBy(desc(conversations.lastMessageAt))
          .limit(20)
      ]);
      return {
        ...contactDto(contact),
        externalIdentities: identities.map(externalIdentityDto),
        deals: relatedDeals.map(({ deal }) => ({
          id: deal.id,
          title: deal.title,
          status: deal.status,
          amountMinor: deal.amountMinor?.toString() ?? null,
          currency: deal.currency
        })),
        conversations: relatedConversations.map((conversation) => ({
          id: conversation.id,
          subject: conversation.subject,
          channel: conversation.channel,
          lastMessageAt: iso(conversation.lastMessageAt)
        }))
      };
    });
  }
}

export class DealRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  public async list(input: PageInput): Promise<CursorPageDto<DealSummaryDto>> {
    const cursor = decodeCursor(input.cursor);
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const conditions = [
        eq(deals.organizationId, this.context.organizationId),
        isNull(deals.archivedAt)
      ];
      if (this.context.role === 'SELLER') {
        conditions.push(eq(deals.ownerMembershipId, this.context.membershipId));
      }
      if (cursor) {
        const at = new Date(cursor.at);
        conditions.push(
          or(lt(deals.updatedAt, at), and(eq(deals.updatedAt, at), lt(deals.id, cursor.id)))!
        );
      }
      if (input.search) conditions.push(ilike(deals.title, `%${input.search}%`));
      const rows = await tx
        .select({ deal: deals, ownerName: user.name })
        .from(deals)
        .leftJoin(
          memberships,
          and(
            eq(memberships.id, deals.ownerMembershipId),
            eq(memberships.organizationId, deals.organizationId)
          )
        )
        .leftJoin(user, eq(user.id, memberships.userId))
        .where(and(...conditions))
        .orderBy(desc(deals.updatedAt), desc(deals.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      const related = await dealContactsByDeal(
        tx,
        page.map(({ deal }) => deal.id)
      );
      const last = page.at(-1)?.deal;
      return {
        items: page.map(({ deal, ownerName }) =>
          dealDto(
            deal,
            ownerName,
            (related.get(deal.id) ?? []).map((contact) => contact.name)
          )
        ),
        nextCursor:
          hasMore && last ? encodeCursor({ at: last.updatedAt.toISOString(), id: last.id }) : null
      };
    });
  }

  public async getById(id: string): Promise<DealDetailDto | null> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [row] = await tx
        .select({ deal: deals, ownerName: user.name })
        .from(deals)
        .leftJoin(
          memberships,
          and(
            eq(memberships.id, deals.ownerMembershipId),
            eq(memberships.organizationId, deals.organizationId)
          )
        )
        .leftJoin(user, eq(user.id, memberships.userId))
        .where(
          and(
            eq(deals.organizationId, this.context.organizationId),
            eq(deals.id, id),
            isNull(deals.archivedAt),
            this.context.role === 'SELLER'
              ? eq(deals.ownerMembershipId, this.context.membershipId)
              : undefined
          )
        )
        .limit(1);
      if (!row) return null;
      const [related, identities] = await Promise.all([
        dealContactsByDeal(tx, [id]),
        tx
          .select()
          .from(externalEntityIdentities)
          .where(
            and(
              eq(externalEntityIdentities.organizationId, this.context.organizationId),
              eq(externalEntityIdentities.entityType, 'DEAL'),
              eq(externalEntityIdentities.entityId, id)
            )
          )
      ]);
      const relatedContacts = related.get(id) ?? [];
      return {
        ...dealDto(
          row.deal,
          row.ownerName,
          relatedContacts.map((contact) => contact.name)
        ),
        openedAt: iso(row.deal.openedAt),
        closedAt: iso(row.deal.closedAt),
        externalIdentities: identities.map(externalIdentityDto),
        contacts: relatedContacts
      };
    });
  }
}

export class ConversationRepository {
  public constructor(
    private readonly db: MorubiDatabase,
    private readonly context: TenantContext
  ) {}

  private async getSummaries(tx: DatabaseTransaction, input: PageInput, onlyId?: string) {
    const cursor = decodeCursor(input.cursor);
    const sortAt = sql<Date>`coalesce(${conversations.lastMessageAt}, ${conversations.startedAt})`;
    const conditions = [
      eq(conversations.organizationId, this.context.organizationId),
      isNull(conversations.archivedAt)
    ];
    if (onlyId) conditions.push(eq(conversations.id, onlyId));
    if (this.context.role === 'SELLER') {
      conditions.push(eq(deals.ownerMembershipId, this.context.membershipId));
    }
    if (cursor) {
      const at = new Date(cursor.at);
      conditions.push(sql`(${sortAt}, ${conversations.id}) < (${at}, ${cursor.id}::uuid)`);
    }
    if (input.search)
      conditions.push(
        or(
          ilike(conversations.subject, `%${input.search}%`),
          ilike(contacts.name, `%${input.search}%`)
        )!
      );
    const lastPreview = sql<
      string | null
    >`(select left(m.text, 160) from messages m where m.organization_id = ${conversations.organizationId} and m.conversation_id = ${conversations.id} and m.deleted_at is null order by m.occurred_at desc, m.id desc limit 1)`;
    const needsAttention = sql<boolean>`exists(select 1 from intervention_deliveries d where d.organization_id = ${conversations.organizationId} and d.conversation_id = ${conversations.id} and d.status in ('CREATED', 'DELIVERED') and d.expires_at > now())`;
    const unreadCount = sql<number>`(select count(*)::int from messages m where m.organization_id = ${conversations.organizationId} and m.conversation_id = ${conversations.id} and m.sender_type = 'LEAD' and m.deleted_at is null and m.occurred_at > coalesce((select cr.last_read_message_at from conversation_read_states cr where cr.organization_id = ${conversations.organizationId} and cr.conversation_id = ${conversations.id} and cr.membership_id = ${this.context.membershipId}::uuid), '-infinity'::timestamptz))`;
    const rows = await tx
      .select({
        conversation: conversations,
        primaryContactName: contacts.name,
        companyName: contacts.companyName,
        dealTitle: deals.title,
        dealStatus: deals.status,
        lastMessagePreview: lastPreview,
        unreadCount,
        needsAttention,
        sortAt
      })
      .from(conversations)
      .leftJoin(
        contacts,
        and(
          eq(contacts.id, conversations.primaryContactId),
          eq(contacts.organizationId, conversations.organizationId)
        )
      )
      .leftJoin(
        deals,
        and(
          eq(deals.id, conversations.dealId),
          eq(deals.organizationId, conversations.organizationId)
        )
      )
      .where(and(...conditions))
      .orderBy(desc(sortAt), desc(conversations.id))
      .limit(onlyId ? 1 : input.limit + 1);
    const page = rows.slice(0, input.limit);
    const participantMap = await participantsByConversation(
      tx,
      page.map(({ conversation }) => conversation.id)
    );
    return rows.map(
      ({
        conversation,
        primaryContactName,
        companyName,
        dealTitle,
        dealStatus,
        lastMessagePreview,
        unreadCount,
        needsAttention,
        sortAt: rowSortAt
      }) => ({
        dto: {
          id: conversation.id,
          subject: conversation.subject,
          channel: conversation.channel,
          primaryContactId: conversation.primaryContactId,
          primaryContactName,
          companyName,
          dealId: conversation.dealId,
          dealTitle,
          dealStatus,
          primaryProvider: conversation.primaryProvider,
          participants: participantMap.get(conversation.id) ?? [],
          lastMessagePreview,
          unreadCount,
          needsAttention,
          startedAt: conversation.startedAt.toISOString(),
          lastMessageAt: iso(conversation.lastMessageAt),
          lastSyncedAt: iso(conversation.lastSyncedAt)
        } satisfies ConversationSummaryDto,
        sortAt: rowSortAt
      })
    );
  }

  public async list(input: PageInput): Promise<CursorPageDto<ConversationSummaryDto>> {
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const rows = await this.getSummaries(tx, input);
      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      const last = page.at(-1);
      return {
        items: page.map((row) => row.dto),
        nextCursor:
          hasMore && last ? encodeCursor({ at: last.sortAt.toISOString(), id: last.dto.id }) : null
      };
    });
  }

  public async listMessages(
    conversationId: string,
    input: Pick<PageInput, 'cursor' | 'limit'>
  ): Promise<ConversationMessagesDto | null> {
    const cursor = decodeCursor(input.cursor);
    return this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [summary] = await this.getSummaries(tx, { limit: 1 }, conversationId);
      if (!summary) return null;
      const conditions = [
        eq(messages.organizationId, this.context.organizationId),
        eq(messages.conversationId, conversationId)
      ];
      if (cursor) {
        const at = new Date(cursor.at);
        conditions.push(
          or(
            gt(messages.occurredAt, at),
            and(eq(messages.occurredAt, at), gt(messages.id, cursor.id))
          )!
        );
      }
      const rows = await tx
        .select()
        .from(messages)
        .where(and(...conditions))
        .orderBy(asc(messages.occurredAt), asc(messages.id))
        .limit(input.limit + 1);
      const hasMore = rows.length > input.limit;
      const page = rows.slice(0, input.limit);
      const audioRows = page.length
        ? await tx
            .select({ asset: audioAssets, transcript: audioTranscripts })
            .from(audioAssets)
            .leftJoin(
              audioTranscripts,
              and(
                eq(audioTranscripts.organizationId, audioAssets.organizationId),
                eq(audioTranscripts.audioAssetId, audioAssets.id),
                eq(audioTranscripts.status, 'CURRENT')
              )
            )
            .where(
              and(
                eq(audioAssets.organizationId, this.context.organizationId),
                inArray(
                  audioAssets.messageId,
                  page.map((row) => row.id)
                )
              )
            )
        : [];
      const audioByMessage = new Map(audioRows.map((row) => [row.asset.messageId, row]));
      const last = page.at(-1);
      return {
        conversation: summary.dto,
        messages: {
          items: page.map((row) => messageDto(row, audioByMessage.get(row.id))),
          nextCursor:
            hasMore && last
              ? encodeCursor({ at: last.occurredAt.toISOString(), id: last.id })
              : null
        }
      };
    });
  }

  public async markRead(conversationId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await setTenantContext(tx, this.context);
      const [summary] = await this.getSummaries(tx, { limit: 1 }, conversationId);
      if (!summary) throw errors.notFound();
      const [latest] = await tx
        .select({ occurredAt: sql<Date | null>`max(${messages.occurredAt})` })
        .from(messages)
        .where(
          and(
            eq(messages.organizationId, this.context.organizationId),
            eq(messages.conversationId, conversationId)
          )
        );
      const now = new Date();
      await tx
        .insert(conversationReadStates)
        .values({
          organizationId: this.context.organizationId,
          conversationId,
          membershipId: this.context.membershipId,
          lastReadMessageAt: latest?.occurredAt,
          lastReadAt: now,
          updatedAt: now
        })
        .onConflictDoUpdate({
          target: [
            conversationReadStates.organizationId,
            conversationReadStates.conversationId,
            conversationReadStates.membershipId
          ],
          set: { lastReadMessageAt: latest?.occurredAt, lastReadAt: now, updatedAt: now }
        });
    });
  }
}
