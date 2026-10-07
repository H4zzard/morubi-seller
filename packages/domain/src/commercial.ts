import { createHash } from 'node:crypto';
import type {
  ConversationChannel,
  DealStatus,
  MessageContentType,
  MessageSenderType
} from '@morubi/contracts';

export type ExternalEntityType =
  'CONTACT' | 'DEAL' | 'CONVERSATION' | 'MESSAGE' | 'COMMERCIAL_EVENT';

export interface SourceEnvelope {
  provider: string;
  externalWorkspaceId?: string;
  connectionId?: string | null;
  syncJobId?: string | null;
  externalId: string;
  externalUrl?: string | null;
  idempotencyKey?: string;
  providerOccurredAt?: Date | null;
  providerUpdatedAt?: Date | null;
  observedAt?: Date;
  rawPayload: unknown;
}

export interface CanonicalContactInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  archived?: boolean;
}

export interface CanonicalDealInput {
  title: string;
  amountMinor?: bigint | null;
  currency?: string | null;
  status: DealStatus;
  providerStageId?: string | null;
  providerStageLabel?: string | null;
  ownerMembershipId?: string | null;
  contactIds?: string[];
  openedAt?: Date | null;
  closedAt?: Date | null;
  archived?: boolean;
}

export interface CanonicalConversationInput {
  subject?: string | null;
  channel: ConversationChannel;
  primaryContactId?: string | null;
  dealId?: string | null;
  startedAt: Date;
  archived?: boolean;
  participants?: Array<{
    type: 'CONTACT' | 'MEMBERSHIP' | 'EXTERNAL' | 'SYSTEM';
    contactId?: string | null;
    membershipId?: string | null;
    externalParticipantId?: string | null;
    displayName?: string | null;
  }>;
}

export interface CanonicalMessageInput {
  conversationId: string;
  senderParticipantId?: string | null;
  senderType: MessageSenderType;
  senderDisplayName?: string | null;
  contentType: MessageContentType;
  text?: string | null;
  occurredAt: Date;
  deleted?: boolean;
}

export interface CanonicalCommercialEventInput {
  contactId?: string | null;
  dealId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  audioTranscriptId?: string | null;
  liveCallSessionId?: string | null;
  liveTranscriptTurnId?: string | null;
  contentOrigin?: 'TEXT' | 'AUDIO_TRANSCRIPT' | 'CALL_TRANSCRIPT' | 'MANUAL';
  actorType: 'SELLER' | 'LEAD' | 'MANAGER' | 'SYSTEM' | 'UNKNOWN';
  source: 'CRM' | 'WHATSAPP' | 'EMAIL' | 'MEET' | 'ZOOM' | 'MANUAL' | 'OTHER';
  type: 'MESSAGE' | 'NOTE' | 'CALL' | 'TRANSCRIPT' | 'STATUS_CHANGE' | 'OTHER';
  text?: string | null;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
  supersedesEventId?: string | null;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stableValue(child)])
    );
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  return value;
}

export function payloadHash(payload: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(payload)))
    .digest('hex');
}

export function sourceIdempotencyKey(source: SourceEnvelope): string {
  return source.idempotencyKey?.trim() || `${source.externalId}:${payloadHash(source.rawPayload)}`;
}
