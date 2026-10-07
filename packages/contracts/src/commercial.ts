export const dealStatuses = ['OPEN', 'WON', 'LOST'] as const;
export type DealStatus = (typeof dealStatuses)[number];

export const conversationChannels = ['WHATSAPP', 'CRM_CHAT', 'EMAIL', 'SMS', 'OTHER'] as const;
export type ConversationChannel = (typeof conversationChannels)[number];

export const messageSenderTypes = ['SELLER', 'LEAD', 'SYSTEM', 'UNKNOWN'] as const;
export type MessageSenderType = (typeof messageSenderTypes)[number];

export const messageContentTypes = ['TEXT', 'AUDIO', 'OTHER'] as const;
export type MessageContentType = (typeof messageContentTypes)[number];

export type SyncStatus = 'SYNCED' | 'STALE' | 'ERROR';

export interface CursorPageDto<T> {
  items: T[];
  nextCursor: string | null;
}

export interface ExternalIdentityDto {
  provider: string;
  externalWorkspaceId: string;
  externalId: string;
  externalUrl: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface FreshnessDto {
  syncStatus: SyncStatus;
  providerUpdatedAt: string | null;
  lastSyncedAt: string | null;
}

export interface ContactSummaryDto extends FreshnessDto {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  primaryProvider: string | null;
  lastInteractionAt: string | null;
  updatedAt: string;
}

export interface ContactDetailDto extends ContactSummaryDto {
  externalIdentities: ExternalIdentityDto[];
  deals: Array<Pick<DealSummaryDto, 'id' | 'title' | 'status' | 'amountMinor' | 'currency'>>;
  conversations: Array<
    Pick<ConversationSummaryDto, 'id' | 'subject' | 'channel' | 'lastMessageAt'>
  >;
}

export interface DealSummaryDto extends FreshnessDto {
  id: string;
  title: string;
  amountMinor: string | null;
  currency: string | null;
  status: DealStatus;
  providerStageId: string | null;
  providerStageLabel: string | null;
  ownerName: string | null;
  primaryProvider: string | null;
  contactNames: string[];
  lastInteractionAt: string | null;
  updatedAt: string;
}

export interface DealDetailDto extends DealSummaryDto {
  openedAt: string | null;
  closedAt: string | null;
  externalIdentities: ExternalIdentityDto[];
  contacts: Array<Pick<ContactSummaryDto, 'id' | 'name' | 'email' | 'companyName'>>;
}

export interface ConversationParticipantDto {
  id: string;
  type: 'CONTACT' | 'MEMBERSHIP' | 'EXTERNAL' | 'SYSTEM';
  contactId: string | null;
  membershipId: string | null;
  externalParticipantId: string | null;
  displayName: string | null;
}

export interface ConversationSummaryDto {
  id: string;
  subject: string | null;
  channel: ConversationChannel;
  primaryContactId: string | null;
  primaryContactName: string | null;
  companyName: string | null;
  dealId: string | null;
  dealTitle: string | null;
  dealStatus: DealStatus | null;
  primaryProvider: string | null;
  participants: ConversationParticipantDto[];
  lastMessagePreview: string | null;
  unreadCount: number;
  needsAttention: boolean;
  startedAt: string;
  lastMessageAt: string | null;
  lastSyncedAt: string | null;
}

export interface MessageDto {
  id: string;
  conversationId: string;
  senderParticipantId: string | null;
  senderType: MessageSenderType;
  senderDisplayName: string | null;
  contentType: MessageContentType;
  text: string | null;
  provider: string;
  occurredAt: string;
  observedAt: string;
  ingestedAt: string;
  deletedAt: string | null;
  audio: AudioMessageDto | null;
}

export type AudioAssetStatus =
  | 'CREATED'
  | 'FETCHING'
  | 'READY'
  | 'TRANSCRIBING'
  | 'TRANSCRIBED'
  | 'FAILED'
  | 'EXPIRED'
  | 'DELETED';
export type TranscriptStatus = 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'UNAVAILABLE';

export interface AudioMessageDto {
  assetId: string;
  mimeType: string;
  durationMs: number;
  status: AudioAssetStatus;
  transcriptStatus: TranscriptStatus;
  transcript: string | null;
  language: string | null;
  failureCode: string | null;
}

export interface AudioBinaryDto {
  mimeType: string;
  dataBase64: string;
}

export interface AudioAssetDevDto {
  id: string;
  messageId: string;
  conversationId: string;
  status: AudioAssetStatus;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  transcript: string | null;
  jobId: string | null;
  jobStatus: string | null;
  commercialEventId: string | null;
  decisionId: string | null;
  interventionDeliveryId: string | null;
  createdAt: string;
}

export interface ConversationMessagesDto {
  conversation: ConversationSummaryDto;
  messages: CursorPageDto<MessageDto>;
}
