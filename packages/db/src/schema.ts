import { relations, sql } from 'drizzle-orm';
import type { DealStateSnapshot, DecisionOutput, PolicyThresholds } from '@morubi/intelligence';
import type { GenerationOutput } from '@morubi/ai';
import type { LiveCallMemory } from '@morubi/live-calls';
import type { PostCallProposal, PostCallReportContent } from '@morubi/post-call';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()
};

// Better Auth core schema. Users are global identities; tenancy begins at memberships.
export const user = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  ...timestamps
});

export const session = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ...timestamps
  },
  (table) => [index('sessions_user_id_idx').on(table.userId)]
);

export const account = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    ...timestamps
  },
  (table) => [
    index('accounts_user_id_idx').on(table.userId),
    uniqueIndex('accounts_provider_account_uidx').on(table.providerId, table.accountId)
  ]
);

export const verification = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...timestamps
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)]
);

export const membershipRole = pgEnum('membership_role', ['OWNER', 'ADMIN', 'MANAGER', 'SELLER']);

export const syncStatus = pgEnum('sync_status', ['SYNCED', 'STALE', 'ERROR']);
export const dealStatus = pgEnum('deal_status', ['OPEN', 'WON', 'LOST']);
export const conversationChannel = pgEnum('conversation_channel', [
  'WHATSAPP',
  'CRM_CHAT',
  'EMAIL',
  'SMS',
  'OTHER'
]);
export const participantType = pgEnum('participant_type', [
  'CONTACT',
  'MEMBERSHIP',
  'EXTERNAL',
  'SYSTEM'
]);
export const messageSenderType = pgEnum('message_sender_type', [
  'SELLER',
  'LEAD',
  'SYSTEM',
  'UNKNOWN'
]);
export const messageContentType = pgEnum('message_content_type', ['TEXT', 'AUDIO', 'OTHER']);
export const commercialEventActorType = pgEnum('commercial_event_actor_type', [
  'SELLER',
  'LEAD',
  'MANAGER',
  'SYSTEM',
  'UNKNOWN'
]);
export const commercialEventSource = pgEnum('commercial_event_source', [
  'CRM',
  'WHATSAPP',
  'EMAIL',
  'MEET',
  'ZOOM',
  'MANUAL',
  'OTHER'
]);
export const commercialEventType = pgEnum('commercial_event_type', [
  'MESSAGE',
  'NOTE',
  'CALL',
  'TRANSCRIPT',
  'STATUS_CHANGE',
  'OTHER'
]);
export const externalEntityType = pgEnum('external_entity_type', [
  'CONTACT',
  'DEAL',
  'CONVERSATION',
  'MESSAGE',
  'COMMERCIAL_EVENT'
]);
export const crmConnectionStatus = pgEnum('crm_connection_status', [
  'ACTIVE',
  'ERROR',
  'DISCONNECTED',
  'REAUTH_REQUIRED',
  'SYNCING'
]);
export const integrationHealth = pgEnum('integration_health', [
  'HEALTHY',
  'DEGRADED',
  'AUTH_ERROR',
  'RATE_LIMITED',
  'SYNC_ERROR'
]);
export const syncJobType = pgEnum('sync_job_type', [
  'INITIAL',
  'INCREMENTAL',
  'WEBHOOK_RECONCILIATION',
  'MANUAL'
]);
export const syncJobStatus = pgEnum('sync_job_status', [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'PARTIAL'
]);
export const aiDecisionPolicyResult = pgEnum('ai_decision_policy_result', [
  'ALLOW',
  'SUPPRESS',
  'ESCALATE',
  'SHADOW',
  'REQUIRE_MORE_CONTEXT'
]);
export const memoryScopeType = pgEnum('memory_scope_type', [
  'DEAL_FACT',
  'CONTACT_FACT',
  'SELLER_PATTERN',
  'COMPANY_PATTERN',
  'PLAYBOOK_REFERENCE'
]);
export const memoryFactStatus = pgEnum('memory_fact_status', ['ACTIVE', 'SUPERSEDED', 'REJECTED']);
export const interventionTemplateStatus = pgEnum('intervention_template_status', [
  'ACTIVE',
  'INACTIVE'
]);
export const interventionOutcome = pgEnum('intervention_outcome', [
  'MATCHED',
  'GENERATION_REQUIRED',
  'SUPPRESSED'
]);
export const interventionCategory = pgEnum('intervention_category', [
  'OBJECTION',
  'BUYING_SIGNAL',
  'RISK',
  'DISCOVERY_GAP',
  'NEXT_STEP',
  'INFORMATION'
]);
export const interventionDeliveryStatus = pgEnum('intervention_delivery_status', [
  'CREATED',
  'DELIVERED',
  'VIEWED',
  'DISMISSED',
  'APPLIED',
  'EXPIRED'
]);
export const interventionFeedbackRating = pgEnum('intervention_feedback_rating', [
  'HELPFUL',
  'NOT_HELPFUL'
]);
export const intelligenceJobStatus = pgEnum('intelligence_job_status', [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED'
]);
export const generationJobStatus = pgEnum('generation_job_status', [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED'
]);
export const generativeProfile = pgEnum('generative_profile', [
  'FAST_GENERATION',
  'DEEP_REASONING'
]);
export const generativeExecutionStatus = pgEnum('generative_execution_status', [
  'RUNNING',
  'COMPLETED',
  'VALIDATION_FAILED',
  'PROVIDER_FAILED',
  'STALE',
  'SUPPRESSED'
]);
export const generationValidationResult = pgEnum('generation_validation_result', [
  'VALID',
  'INVALID',
  'REVIEW_REQUIRED'
]);
export const audioAssetStatus = pgEnum('audio_asset_status', [
  'CREATED',
  'FETCHING',
  'READY',
  'TRANSCRIBING',
  'TRANSCRIBED',
  'FAILED',
  'EXPIRED',
  'DELETED'
]);
export const transcriptionJobStatus = pgEnum('transcription_job_status', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'RETRY',
  'CANCELLED'
]);
export const transcriptStatus = pgEnum('transcript_status', ['CURRENT', 'SUPERSEDED', 'REJECTED']);
export const commercialContentOrigin = pgEnum('commercial_content_origin', [
  'TEXT',
  'AUDIO_TRANSCRIPT',
  'CALL_TRANSCRIPT',
  'MANUAL'
]);
export const meetingProvider = pgEnum('meeting_provider', ['MEET', 'ZOOM', 'TEAMS', 'UNKNOWN']);
export const liveCallSessionStatus = pgEnum('live_call_session_status', [
  'DETECTED',
  'READY',
  'STARTING',
  'ACTIVE',
  'ENDING',
  'ENDED',
  'FAILED',
  'CANCELLED'
]);
export const postCallJobStatus = pgEnum('post_call_job_status', [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'RETRY',
  'CANCELLED'
]);
export const callReportStatus = pgEnum('call_report_status', [
  'PROCESSING',
  'READY',
  'FAILED',
  'STALE'
]);
export const callReportRevisionStatus = pgEnum('call_report_revision_status', [
  'CURRENT',
  'SUPERSEDED',
  'REJECTED'
]);
export const liveCaptureMode = pgEnum('live_capture_mode', [
  'MICROPHONE',
  'SYSTEM_AUDIO',
  'MIXED',
  'FIXTURE',
  'UNKNOWN'
]);
export const liveTranscriptionMode = pgEnum('live_transcription_mode', ['REALTIME', 'FIXTURE']);
export const liveSpeakerRole = pgEnum('live_speaker_role', ['SELLER', 'LEAD', 'UNKNOWN']);
export const callPhase = pgEnum('call_phase', [
  'INTRODUCTION',
  'DISCOVERY',
  'PRESENTATION',
  'VALUE',
  'DECISION',
  'UNKNOWN'
]);
export const callConsentMode = pgEnum('call_consent_mode', [
  'MANUAL_CONFIRMATION',
  'ORGANIZATION_POLICY'
]);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    ...timestamps
  },
  (table) => [uniqueIndex('organizations_slug_uidx').on(table.slug)]
);

export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: membershipRole('role').notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex('memberships_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('memberships_organization_user_uidx').on(table.organizationId, table.userId),
    index('memberships_organization_role_idx').on(table.organizationId, table.role),
    index('memberships_user_idx').on(table.userId)
  ]
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    actorUserId: text('actor_user_id').references(() => user.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    index('audit_logs_organization_created_idx').on(table.organizationId, table.createdAt),
    index('audit_logs_organization_resource_idx').on(
      table.organizationId,
      table.resourceType,
      table.resourceId
    )
  ]
);

export const crmConnections = pgTable(
  'crm_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalAccountId: text('external_account_id').notNull(),
    externalAccountName: text('external_account_name').notNull(),
    status: crmConnectionStatus('status').default('ACTIVE').notNull(),
    health: integrationHealth('health').default('HEALTHY').notNull(),
    secretReference: text('secret_reference'),
    scopes: jsonb('scopes')
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    capabilities: jsonb('capabilities')
      .$type<Record<string, boolean>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    syncCheckpoint: jsonb('sync_checkpoint')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    connectedByUserId: text('connected_by_user_id').references(() => user.id, {
      onDelete: 'set null'
    }),
    connectedAt: timestamp('connected_at', { withTimezone: true }).defaultNow().notNull(),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastSuccessfulSyncAt: timestamp('last_successful_sync_at', { withTimezone: true }),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    lastErrorCode: text('last_error_code'),
    lastErrorSummary: text('last_error_summary'),
    contactCount: integer('contact_count').default(0).notNull(),
    dealCount: integer('deal_count').default(0).notNull(),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('crm_connections_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('crm_connections_external_account_uidx').on(
      table.organizationId,
      table.provider,
      table.externalAccountId
    ),
    index('crm_connections_organization_status_idx').on(table.organizationId, table.status)
  ]
);

export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    connectionId: uuid('connection_id').notNull(),
    type: syncJobType('type').notNull(),
    status: syncJobStatus('status').default('PENDING').notNull(),
    checkpoint: jsonb('checkpoint')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    contactsFetched: integer('contacts_fetched').default(0).notNull(),
    contactsApplied: integer('contacts_applied').default(0).notNull(),
    dealsFetched: integer('deals_fetched').default(0).notNull(),
    dealsApplied: integer('deals_applied').default(0).notNull(),
    recordsSkipped: integer('records_skipped').default(0).notNull(),
    errorCount: integer('error_count').default(0).notNull(),
    retryCount: integer('retry_count').default(0).notNull(),
    errorCode: text('error_code'),
    errorSummary: text('error_summary'),
    requestedByUserId: text('requested_by_user_id').references(() => user.id, {
      onDelete: 'set null'
    }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('sync_jobs_organization_id_uidx').on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [crmConnections.organizationId, crmConnections.id],
      name: 'sync_jobs_organization_connection_fk'
    }).onDelete('cascade'),
    uniqueIndex('sync_jobs_one_active_per_connection_uidx')
      .on(table.organizationId, table.connectionId)
      .where(sql`${table.status} in ('PENDING', 'RUNNING')`),
    index('sync_jobs_organization_created_idx').on(
      table.organizationId,
      table.connectionId,
      table.createdAt
    )
  ]
);

export const contacts = pgTable(
  'contacts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    companyName: text('company_name'),
    jobTitle: text('job_title'),
    primaryProvider: text('primary_provider'),
    syncStatus: syncStatus('sync_status').default('SYNCED').notNull(),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('contacts_organization_id_uidx').on(table.organizationId, table.id),
    index('contacts_organization_updated_idx').on(table.organizationId, table.updatedAt, table.id),
    index('contacts_organization_name_idx').on(table.organizationId, table.name)
  ]
);

export const deals = pgTable(
  'deals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }),
    currency: text('currency'),
    status: dealStatus('status').default('OPEN').notNull(),
    providerStageId: text('provider_stage_id'),
    providerStageLabel: text('provider_stage_label'),
    ownerMembershipId: uuid('owner_membership_id'),
    primaryProvider: text('primary_provider'),
    syncStatus: syncStatus('sync_status').default('SYNCED').notNull(),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('deals_organization_id_uidx').on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.ownerMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: 'deals_organization_owner_fk'
    }).onDelete('set null'),
    index('deals_organization_updated_idx').on(table.organizationId, table.updatedAt, table.id),
    index('deals_organization_status_idx').on(table.organizationId, table.status),
    check(
      'deals_currency_check',
      sql`${table.currency} is null or ${table.currency} ~ '^[A-Z]{3}$'`
    ),
    check(
      'deals_amount_minor_check',
      sql`${table.amountMinor} is null or ${table.amountMinor} >= 0`
    )
  ]
);

export const dealContacts = pgTable(
  'deal_contacts',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').notNull(),
    contactId: uuid('contact_id').notNull(),
    role: text('role'),
    isPrimary: boolean('is_primary').default(false).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    primaryKey({ columns: [table.dealId, table.contactId] }),
    foreignKey({
      columns: [table.organizationId, table.dealId],
      foreignColumns: [deals.organizationId, deals.id],
      name: 'deal_contacts_organization_deal_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: 'deal_contacts_organization_contact_fk'
    }).onDelete('cascade'),
    index('deal_contacts_organization_contact_idx').on(table.organizationId, table.contactId)
  ]
);

export const conversations = pgTable(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    subject: text('subject'),
    channel: conversationChannel('channel').notNull(),
    primaryContactId: uuid('primary_contact_id'),
    dealId: uuid('deal_id'),
    primaryProvider: text('primary_provider'),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('conversations_organization_id_uidx').on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.primaryContactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: 'conversations_organization_contact_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.dealId],
      foreignColumns: [deals.organizationId, deals.id],
      name: 'conversations_organization_deal_fk'
    }).onDelete('set null'),
    index('conversations_organization_last_message_idx').on(
      table.organizationId,
      table.lastMessageAt,
      table.id
    )
  ]
);

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull(),
    type: participantType('type').notNull(),
    contactId: uuid('contact_id'),
    membershipId: uuid('membership_id'),
    externalParticipantId: text('external_participant_id'),
    displayName: text('display_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('conversation_participants_organization_id_uidx').on(
      table.organizationId,
      table.id
    ),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: 'conversation_participants_organization_conversation_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: 'conversation_participants_organization_contact_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: 'conversation_participants_organization_membership_fk'
    }).onDelete('set null'),
    index('conversation_participants_conversation_idx').on(
      table.organizationId,
      table.conversationId
    )
  ]
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull(),
    senderParticipantId: uuid('sender_participant_id'),
    senderType: messageSenderType('sender_type').notNull(),
    senderDisplayName: text('sender_display_name'),
    contentType: messageContentType('content_type').notNull(),
    text: text('text'),
    provider: text('provider').notNull(),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
    payloadHash: text('payload_hash').notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('messages_organization_id_uidx').on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: 'messages_organization_conversation_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.senderParticipantId],
      foreignColumns: [conversationParticipants.organizationId, conversationParticipants.id],
      name: 'messages_organization_sender_fk'
    }).onDelete('set null'),
    index('messages_conversation_occurred_idx').on(
      table.organizationId,
      table.conversationId,
      table.occurredAt,
      table.id
    ),
    check(
      'messages_text_content_check',
      sql`${table.contentType} <> 'TEXT' or ${table.text} is not null or ${table.deletedAt} is not null`
    )
  ]
);

export const audioAssets = pgTable(
  'audio_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull(),
    messageId: uuid('message_id').notNull(),
    contactId: uuid('contact_id'),
    dealId: uuid('deal_id'),
    idempotencyKey: text('idempotency_key').notNull(),
    sourceProvider: text('source_provider').notNull(),
    sourceUrl: text('source_url'),
    storageProvider: text('storage_provider').notNull(),
    storageKey: text('storage_key').notNull(),
    originalFileName: text('original_file_name'),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    durationMs: integer('duration_ms').notNull(),
    sha256: text('sha256').notNull(),
    speakerType: messageSenderType('speaker_type').notNull(),
    status: audioAssetStatus('status').default('READY').notNull(),
    failureCode: text('failure_code'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    retentionUntil: timestamp('retention_until', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex('audio_assets_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('audio_assets_idempotency_uidx').on(table.organizationId, table.idempotencyKey),
    uniqueIndex('audio_assets_message_uidx').on(table.organizationId, table.messageId),
    uniqueIndex('audio_assets_storage_key_uidx').on(table.storageKey),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: 'audio_assets_organization_conversation_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.messageId],
      foreignColumns: [messages.organizationId, messages.id],
      name: 'audio_assets_organization_message_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: 'audio_assets_organization_contact_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.dealId],
      foreignColumns: [deals.organizationId, deals.id],
      name: 'audio_assets_organization_deal_fk'
    }).onDelete('set null'),
    index('audio_assets_retention_idx').on(table.status, table.retentionUntil),
    check('audio_assets_limits_check', sql`${table.sizeBytes} > 0 and ${table.durationMs} > 0`)
  ]
);

export const transcriptionJobs = pgTable(
  'transcription_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    audioAssetId: uuid('audio_asset_id').notNull(),
    processingKey: text('processing_key').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    status: transcriptionJobStatus('status').default('PENDING').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(3).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    correlationId: text('correlation_id').notNull(),
    errorCode: text('error_code'),
    ...timestamps
  },
  (table) => [
    uniqueIndex('transcription_jobs_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('transcription_jobs_processing_key_uidx').on(
      table.organizationId,
      table.processingKey
    ),
    foreignKey({
      columns: [table.organizationId, table.audioAssetId],
      foreignColumns: [audioAssets.organizationId, audioAssets.id],
      name: 'transcription_jobs_organization_asset_fk'
    }).onDelete('cascade'),
    index('transcription_jobs_claim_idx').on(table.status, table.availableAt, table.createdAt),
    check(
      'transcription_jobs_attempts_check',
      sql`${table.attempts} >= 0 and ${table.maxAttempts} > 0`
    )
  ]
);

export const audioTranscripts = pgTable(
  'audio_transcripts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    audioAssetId: uuid('audio_asset_id').notNull(),
    transcriptionJobId: uuid('transcription_job_id').notNull(),
    version: integer('version').notNull(),
    status: transcriptStatus('status').default('CURRENT').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    text: text('text').notNull(),
    language: text('language'),
    confidence: real('confidence'),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    audioDurationMs: integer('audio_duration_ms').notNull(),
    usageMeasurement: text('usage_measurement').notNull(),
    estimatedCostMicros: bigint('estimated_cost_micros', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex('audio_transcripts_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('audio_transcripts_asset_version_uidx').on(
      table.organizationId,
      table.audioAssetId,
      table.version
    ),
    uniqueIndex('audio_transcripts_job_uidx').on(table.organizationId, table.transcriptionJobId),
    foreignKey({
      columns: [table.organizationId, table.audioAssetId],
      foreignColumns: [audioAssets.organizationId, audioAssets.id],
      name: 'audio_transcripts_organization_asset_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.transcriptionJobId],
      foreignColumns: [transcriptionJobs.organizationId, transcriptionJobs.id],
      name: 'audio_transcripts_organization_job_fk'
    }).onDelete('cascade'),
    index('audio_transcripts_current_idx').on(
      table.organizationId,
      table.audioAssetId,
      table.status
    ),
    check(
      'audio_transcripts_values_check',
      sql`${table.version} > 0 and length(trim(${table.text})) > 0 and ${table.audioDurationMs} > 0 and (${table.confidence} is null or ${table.confidence} between 0 and 1)`
    )
  ]
);

export const conversationReadStates = pgTable(
  'conversation_read_states',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    conversationId: uuid('conversation_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    lastReadMessageAt: timestamp('last_read_message_at', { withTimezone: true }),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.conversationId, table.membershipId] }),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: 'conversation_read_states_organization_conversation_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.membershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: 'conversation_read_states_organization_membership_fk'
    }).onDelete('cascade'),
    index('conversation_read_states_membership_idx').on(
      table.organizationId,
      table.membershipId,
      table.updatedAt
    )
  ]
);

export const liveCallSessions = pgTable(
  'live_call_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sellerMembershipId: uuid('seller_membership_id').notNull(),
    dealId: uuid('deal_id'),
    contactId: uuid('contact_id'),
    conversationId: uuid('conversation_id'),
    calendarEventId: text('calendar_event_id'),
    provider: meetingProvider('meeting_provider').notNull(),
    meetingExternalId: text('meeting_external_id'),
    meetingTitle: text('meeting_title'),
    status: liveCallSessionStatus('status').default('DETECTED').notNull(),
    captureMode: liveCaptureMode('capture_mode').default('UNKNOWN').notNull(),
    transcriptionMode: liveTranscriptionMode('transcription_mode').default('FIXTURE').notNull(),
    currentPhase: callPhase('current_phase').default('INTRODUCTION').notNull(),
    phaseConfidence: real('phase_confidence').default(0.5).notNull(),
    phaseOrigin: text('phase_origin').default('HEURISTIC').notNull(),
    memory: jsonb('memory')
      .$type<LiveCallMemory>()
      .default(
        sql`'{"phase":"INTRODUCTION","phaseConfidence":0.5,"pains":[],"objections":[],"openQuestions":[],"buyingSignals":[],"sellerActions":[],"lastInterventionId":null,"lastSequence":0}'::jsonb`
      )
      .notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    lastHeartbeatAt: timestamp('last_heartbeat_at', { withTimezone: true }),
    failureCode: text('failure_code'),
    detectionConfidence: real('detection_confidence').default(0).notNull(),
    detectionEvidence: text('detection_evidence'),
    ...timestamps
  },
  (table) => [
    uniqueIndex('live_call_sessions_organization_id_uidx').on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.sellerMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: 'live_call_sessions_organization_seller_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.dealId],
      foreignColumns: [deals.organizationId, deals.id],
      name: 'live_call_sessions_organization_deal_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: 'live_call_sessions_organization_contact_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: 'live_call_sessions_organization_conversation_fk'
    }).onDelete('set null'),
    index('live_call_sessions_seller_status_idx').on(
      table.organizationId,
      table.sellerMembershipId,
      table.status,
      table.createdAt
    ),
    uniqueIndex('live_call_sessions_one_active_seller_uidx')
      .on(table.organizationId, table.sellerMembershipId)
      .where(sql`${table.status} in ('STARTING', 'ACTIVE', 'ENDING')`),
    check(
      'live_call_sessions_confidence_check',
      sql`${table.phaseConfidence} between 0 and 1 and ${table.detectionConfidence} between 0 and 1`
    )
  ]
);

export const callConsentRecords = pgTable(
  'call_consent_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    liveCallSessionId: uuid('live_call_session_id').notNull(),
    mode: callConsentMode('consent_mode').notNull(),
    confirmedByMembershipId: uuid('confirmed_by_membership_id').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull(),
    policyVersion: text('policy_version').notNull(),
    captureSources: jsonb('capture_sources').$type<string[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('call_consent_records_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('call_consent_records_session_uidx').on(
      table.organizationId,
      table.liveCallSessionId
    ),
    foreignKey({
      columns: [table.organizationId, table.liveCallSessionId],
      foreignColumns: [liveCallSessions.organizationId, liveCallSessions.id],
      name: 'call_consent_records_organization_session_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.confirmedByMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: 'call_consent_records_organization_confirmer_fk'
    }).onDelete('restrict')
  ]
);

export const liveTranscriptTurns = pgTable(
  'live_transcript_turns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    liveCallSessionId: uuid('live_call_session_id').notNull(),
    clientTurnId: text('client_turn_id').notNull(),
    speakerRole: liveSpeakerRole('speaker_role').notNull(),
    speakerOrigin: text('speaker_origin').notNull(),
    speakerConfidence: real('speaker_confidence').notNull(),
    text: text('text').notNull(),
    isPartial: boolean('is_partial').default(false).notNull(),
    isFinal: boolean('is_final').default(false).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    confidence: real('confidence'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    sequence: integer('sequence').notNull(),
    commercialEventId: uuid('commercial_event_id'),
    transcriptFinalAt: timestamp('transcript_final_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('live_transcript_turns_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('live_transcript_turns_client_uidx').on(
      table.organizationId,
      table.liveCallSessionId,
      table.clientTurnId
    ),
    uniqueIndex('live_transcript_turns_final_sequence_uidx')
      .on(table.organizationId, table.liveCallSessionId, table.sequence)
      .where(sql`${table.isFinal} = true`),
    foreignKey({
      columns: [table.organizationId, table.liveCallSessionId],
      foreignColumns: [liveCallSessions.organizationId, liveCallSessions.id],
      name: 'live_transcript_turns_organization_session_fk'
    }).onDelete('cascade'),
    index('live_transcript_turns_session_sequence_idx').on(
      table.organizationId,
      table.liveCallSessionId,
      table.sequence
    ),
    check(
      'live_transcript_turns_values_check',
      sql`length(trim(${table.text})) > 0 and ${table.sequence} >= 0 and not (${table.isPartial} and ${table.isFinal}) and ${table.speakerConfidence} between 0 and 1 and (${table.confidence} is null or ${table.confidence} between 0 and 1)`
    )
  ]
);

export const callUsage = pgTable(
  'call_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    liveCallSessionId: uuid('live_call_session_id').notNull(),
    sellerMembershipId: uuid('seller_membership_id').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    callDurationSeconds: integer('call_duration_seconds').default(0).notNull(),
    audioProcessedSeconds: integer('audio_processed_seconds').default(0).notNull(),
    transcriptionInputUnits: integer('transcription_input_units').default(0).notNull(),
    decisionCount: integer('decision_count').default(0).notNull(),
    generationCount: integer('generation_count').default(0).notNull(),
    cardsDelivered: integer('cards_delivered').default(0).notNull(),
    droppedChunks: integer('dropped_chunks').default(0).notNull(),
    costTotalMicros: bigint('cost_total_micros', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('call_usage_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('call_usage_session_uidx').on(table.organizationId, table.liveCallSessionId),
    foreignKey({
      columns: [table.organizationId, table.liveCallSessionId],
      foreignColumns: [liveCallSessions.organizationId, liveCallSessions.id],
      name: 'call_usage_organization_session_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.sellerMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: 'call_usage_organization_seller_fk'
    }).onDelete('cascade'),
    check(
      'call_usage_nonnegative_check',
      sql`${table.callDurationSeconds} >= 0 and ${table.audioProcessedSeconds} >= 0 and ${table.transcriptionInputUnits} >= 0 and ${table.decisionCount} >= 0 and ${table.generationCount} >= 0 and ${table.cardsDelivered} >= 0 and ${table.droppedChunks} >= 0 and ${table.costTotalMicros} >= 0`
    )
  ]
);

export const postCallJobs = pgTable(
  'post_call_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    liveCallSessionId: uuid('live_call_session_id').notNull(),
    transcriptVersion: text('transcript_version').notNull(),
    processingVersion: text('processing_version').notNull(),
    status: postCallJobStatus('status').default('PENDING').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(3).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    correlationId: text('correlation_id').notNull(),
    priority: integer('priority').default(10).notNull(),
    errorCode: text('error_code'),
    ...timestamps
  },
  (table) => [
    uniqueIndex('post_call_jobs_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('post_call_jobs_processing_uidx').on(
      table.organizationId,
      table.liveCallSessionId,
      table.transcriptVersion,
      table.processingVersion
    ),
    foreignKey({
      columns: [table.organizationId, table.liveCallSessionId],
      foreignColumns: [liveCallSessions.organizationId, liveCallSessions.id],
      name: 'post_call_jobs_organization_session_fk'
    }).onDelete('cascade'),
    index('post_call_jobs_claim_idx').on(
      table.status,
      table.priority,
      table.availableAt,
      table.createdAt
    ),
    check(
      'post_call_jobs_attempts_check',
      sql`${table.attempts} >= 0 and ${table.maxAttempts} between 1 and 10 and ${table.priority} between 0 and 50`
    )
  ]
);

export const callReports = pgTable(
  'call_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    liveCallSessionId: uuid('live_call_session_id').notNull(),
    status: callReportStatus('status').default('PROCESSING').notNull(),
    transcriptVersion: text('transcript_version').notNull(),
    processingVersion: text('processing_version').notNull(),
    failureCode: text('failure_code'),
    readyAt: timestamp('ready_at', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('call_reports_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('call_reports_session_uidx').on(table.organizationId, table.liveCallSessionId),
    foreignKey({
      columns: [table.organizationId, table.liveCallSessionId],
      foreignColumns: [liveCallSessions.organizationId, liveCallSessions.id],
      name: 'call_reports_organization_session_fk'
    }).onDelete('cascade'),
    index('call_reports_status_idx').on(table.organizationId, table.status, table.updatedAt)
  ]
);

export const callReportRevisions = pgTable(
  'call_report_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    callReportId: uuid('call_report_id').notNull(),
    liveCallSessionId: uuid('live_call_session_id').notNull(),
    transcriptVersion: text('transcript_version').notNull(),
    version: integer('version').notNull(),
    status: callReportRevisionStatus('status').default('CURRENT').notNull(),
    processingVersion: text('processing_version').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    profile: text('profile').default('POST_CALL_ANALYSIS').notNull(),
    promptVersion: text('prompt_version').notNull(),
    configVersion: text('config_version').notNull(),
    content: jsonb('content').$type<PostCallReportContent>().notNull(),
    proposals: jsonb('proposals')
      .$type<PostCallProposal[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    estimatedCostMicros: bigint('estimated_cost_micros', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    evidenceCount: integer('evidence_count').default(0).notNull(),
    summary: text('summary').notNull(),
    outcome: text('outcome').notNull(),
    confidence: real('confidence').notNull(),
    durationSeconds: integer('duration_seconds').default(0).notNull(),
    participantCount: integer('participant_count').default(0).notNull(),
    topicCount: integer('topic_count').default(0).notNull(),
    objectionCount: integer('objection_count').default(0).notNull(),
    actionItemCount: integer('action_item_count').default(0).notNull(),
    sellerScoreAverage: real('seller_score_average'),
    dealStage: text('deal_stage'),
    purchaseIntent: text('purchase_intent').notNull(),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('call_report_revisions_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('call_report_revisions_version_uidx').on(
      table.organizationId,
      table.callReportId,
      table.version
    ),
    uniqueIndex('call_report_revisions_current_uidx')
      .on(table.organizationId, table.callReportId)
      .where(sql`${table.status} = 'CURRENT'`),
    index('call_report_revisions_analytics_idx').on(
      table.organizationId,
      table.outcome,
      table.purchaseIntent,
      table.generatedAt
    ),
    foreignKey({
      columns: [table.organizationId, table.callReportId],
      foreignColumns: [callReports.organizationId, callReports.id],
      name: 'call_report_revisions_organization_report_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.liveCallSessionId],
      foreignColumns: [liveCallSessions.organizationId, liveCallSessions.id],
      name: 'call_report_revisions_organization_session_fk'
    }).onDelete('cascade'),
    check(
      'call_report_revisions_values_check',
      sql`${table.version} > 0 and ${table.inputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.estimatedCostMicros} >= 0 and ${table.evidenceCount} > 0 and ${table.durationSeconds} >= 0 and ${table.participantCount} >= 0 and ${table.topicCount} >= 0 and ${table.objectionCount} >= 0 and ${table.actionItemCount} >= 0 and ${table.confidence} between 0 and 1 and ${table.profile} = 'POST_CALL_ANALYSIS'`
    )
  ]
);

export const callReportEvidence = pgTable(
  'call_report_evidence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    callReportRevisionId: uuid('call_report_revision_id').notNull(),
    liveTranscriptTurnId: uuid('live_transcript_turn_id').notNull(),
    timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
    speakerRole: text('speaker_role').notNull(),
    participantRole: text('participant_role').notNull(),
    excerpt: text('excerpt').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('call_report_evidence_turn_uidx').on(table.organizationId, table.callReportRevisionId, table.liveTranscriptTurnId),
    foreignKey({ columns: [table.organizationId, table.callReportRevisionId], foreignColumns: [callReportRevisions.organizationId, callReportRevisions.id], name: 'call_report_evidence_organization_revision_fk' }).onDelete('cascade'),
    foreignKey({ columns: [table.organizationId, table.liveTranscriptTurnId], foreignColumns: [liveTranscriptTurns.organizationId, liveTranscriptTurns.id], name: 'call_report_evidence_organization_turn_fk' }).onDelete('cascade'),
    index('call_report_evidence_revision_idx').on(table.organizationId, table.callReportRevisionId)
  ]
);

export const callReportActionItems = pgTable(
  'call_report_action_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    callReportRevisionId: uuid('call_report_revision_id').notNull(),
    description: text('description').notNull(),
    ownerRole: text('owner_role'),
    ownerName: text('owner_name'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    source: text('source').notNull(),
    confidence: real('confidence').notNull(),
    status: text('status').default('OPEN').notNull(),
    evidenceTurnIds: uuid('evidence_turn_ids').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    foreignKey({ columns: [table.organizationId, table.callReportRevisionId], foreignColumns: [callReportRevisions.organizationId, callReportRevisions.id], name: 'call_report_action_items_organization_revision_fk' }).onDelete('cascade'),
    index('call_report_action_items_revision_idx').on(table.organizationId, table.callReportRevisionId),
    check('call_report_action_items_values_check', sql`${table.confidence} between 0 and 1 and ${table.source} in ('EXPLICIT', 'IMPLICIT') and ${table.status} = 'OPEN'`)
  ]
);

export const callReportSellerPerformance = pgTable(
  'call_report_seller_performance',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
    callReportRevisionId: uuid('call_report_revision_id').notNull(),
    dimension: text('dimension').notNull(),
    rating: text('rating').notNull(),
    score: real('score'),
    confidence: real('confidence').notNull(),
    rationale: text('rationale').notNull(),
    evidenceTurnIds: uuid('evidence_turn_ids').array().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('call_report_seller_performance_dimension_uidx').on(table.organizationId, table.callReportRevisionId, table.dimension),
    foreignKey({ columns: [table.organizationId, table.callReportRevisionId], foreignColumns: [callReportRevisions.organizationId, callReportRevisions.id], name: 'call_report_seller_performance_organization_revision_fk' }).onDelete('cascade'),
    index('call_report_seller_performance_analytics_idx').on(table.organizationId, table.dimension, table.rating, table.createdAt),
    check('call_report_seller_performance_values_check', sql`${table.confidence} between 0 and 1 and (${table.score} is null or ${table.score} between 0 and 100)`)
  ]
);

export const externalEntityIdentities = pgTable(
  'external_entity_identities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalWorkspaceId: text('external_workspace_id').default('').notNull(),
    connectionId: uuid('connection_id'),
    entityType: externalEntityType('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    externalId: text('external_id').notNull(),
    externalUrl: text('external_url'),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex('external_identities_strong_uidx').on(
      table.organizationId,
      table.provider,
      table.externalWorkspaceId,
      table.entityType,
      table.externalId
    ),
    index('external_identities_entity_idx').on(
      table.organizationId,
      table.entityType,
      table.entityId
    ),
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [crmConnections.organizationId, crmConnections.id],
      name: 'external_identities_organization_connection_fk'
    }).onDelete('set null')
  ]
);

export const sourceRecords = pgTable(
  'source_records',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    externalWorkspaceId: text('external_workspace_id').default('').notNull(),
    connectionId: uuid('connection_id'),
    syncJobId: uuid('sync_job_id'),
    entityType: externalEntityType('entity_type').notNull(),
    externalId: text('external_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    rawPayload: jsonb('raw_payload').notNull(),
    providerOccurredAt: timestamp('provider_occurred_at', { withTimezone: true }),
    providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true }),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull(),
    normalizedEntityId: uuid('normalized_entity_id')
  },
  (table) => [
    uniqueIndex('source_records_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('source_records_idempotency_uidx').on(
      table.organizationId,
      table.provider,
      table.externalWorkspaceId,
      table.entityType,
      table.idempotencyKey
    ),
    index('source_records_entity_history_idx').on(
      table.organizationId,
      table.entityType,
      table.normalizedEntityId,
      table.ingestedAt
    ),
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [crmConnections.organizationId, crmConnections.id],
      name: 'source_records_organization_connection_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.syncJobId],
      foreignColumns: [syncJobs.organizationId, syncJobs.id],
      name: 'source_records_organization_sync_job_fk'
    }).onDelete('set null')
  ]
);

export const commercialEvents = pgTable(
  'commercial_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    schemaVersion: text('schema_version').default('1').notNull(),
    contactId: uuid('contact_id'),
    dealId: uuid('deal_id'),
    conversationId: uuid('conversation_id'),
    messageId: uuid('message_id'),
    audioTranscriptId: uuid('audio_transcript_id'),
    liveCallSessionId: uuid('live_call_session_id'),
    liveTranscriptTurnId: uuid('live_transcript_turn_id'),
    contentOrigin: commercialContentOrigin('content_origin').default('TEXT').notNull(),
    actorType: commercialEventActorType('actor_type').notNull(),
    source: commercialEventSource('source').notNull(),
    type: commercialEventType('type').notNull(),
    text: text('text'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    metadata: jsonb('metadata')
      .notNull()
      .default(sql`'{}'::jsonb`),
    sourceRecordId: uuid('source_record_id'),
    supersedesEventId: uuid('supersedes_event_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('commercial_events_organization_id_uidx').on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.contactId],
      foreignColumns: [contacts.organizationId, contacts.id],
      name: 'commercial_events_organization_contact_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.audioTranscriptId],
      foreignColumns: [audioTranscripts.organizationId, audioTranscripts.id],
      name: 'commercial_events_organization_audio_transcript_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.liveCallSessionId],
      foreignColumns: [liveCallSessions.organizationId, liveCallSessions.id],
      name: 'commercial_events_organization_live_session_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.liveTranscriptTurnId],
      foreignColumns: [liveTranscriptTurns.organizationId, liveTranscriptTurns.id],
      name: 'commercial_events_organization_live_turn_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.dealId],
      foreignColumns: [deals.organizationId, deals.id],
      name: 'commercial_events_organization_deal_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: 'commercial_events_organization_conversation_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.messageId],
      foreignColumns: [messages.organizationId, messages.id],
      name: 'commercial_events_organization_message_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.sourceRecordId],
      foreignColumns: [sourceRecords.organizationId, sourceRecords.id],
      name: 'commercial_events_organization_source_record_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.supersedesEventId],
      foreignColumns: [table.organizationId, table.id],
      name: 'commercial_events_organization_supersedes_fk'
    }).onDelete('no action'),
    index('commercial_events_timeline_idx').on(table.organizationId, table.occurredAt, table.id),
    check(
      'commercial_events_context_check',
      sql`${table.contactId} is not null or ${table.dealId} is not null or ${table.conversationId} is not null or ${table.messageId} is not null or ${table.liveCallSessionId} is not null or ${table.liveTranscriptTurnId} is not null`
    )
  ]
);

export const aiDecisions = pgTable(
  'ai_decisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').notNull(),
    commercialEventId: uuid('commercial_event_id').notNull(),
    processingKey: text('processing_key').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    modelVersion: text('model_version'),
    configVersion: text('config_version').notNull(),
    decisionVersion: text('decision_version').notNull(),
    policyVersion: text('policy_version').notNull(),
    contextVersion: text('context_version').notNull(),
    output: jsonb('output').$type<DecisionOutput>().notNull(),
    confidence: real('confidence').notNull(),
    policyResult: aiDecisionPolicyResult('policy_result').notNull(),
    policyReason: text('policy_reason').notNull(),
    shadowMode: boolean('shadow_mode').default(true).notNull(),
    inputSize: integer('input_size').default(0).notNull(),
    outputSize: integer('output_size').default(0).notNull(),
    latencyMs: integer('latency_ms').default(0).notNull(),
    estimatedCostMicros: bigint('estimated_cost_micros', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('ai_decisions_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('ai_decisions_processing_key_uidx').on(table.organizationId, table.processingKey),
    foreignKey({
      columns: [table.organizationId, table.dealId],
      foreignColumns: [deals.organizationId, deals.id],
      name: 'ai_decisions_organization_deal_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.commercialEventId],
      foreignColumns: [commercialEvents.organizationId, commercialEvents.id],
      name: 'ai_decisions_organization_event_fk'
    }).onDelete('cascade'),
    index('ai_decisions_organization_created_idx').on(table.organizationId, table.createdAt)
  ]
);

export const dealStateRevisions = pgTable(
  'deal_state_revisions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').notNull(),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<DealStateSnapshot>().notNull(),
    sourceEventId: uuid('source_event_id').notNull(),
    aiDecisionId: uuid('ai_decision_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('deal_state_revisions_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('deal_state_revisions_version_uidx').on(
      table.organizationId,
      table.dealId,
      table.version
    ),
    uniqueIndex('deal_state_revisions_decision_uidx').on(table.organizationId, table.aiDecisionId),
    foreignKey({
      columns: [table.organizationId, table.dealId],
      foreignColumns: [deals.organizationId, deals.id],
      name: 'deal_state_revisions_organization_deal_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.sourceEventId],
      foreignColumns: [commercialEvents.organizationId, commercialEvents.id],
      name: 'deal_state_revisions_organization_event_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.aiDecisionId],
      foreignColumns: [aiDecisions.organizationId, aiDecisions.id],
      name: 'deal_state_revisions_organization_decision_fk'
    }).onDelete('cascade')
  ]
);

export const dealStates = pgTable(
  'deal_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').notNull(),
    version: integer('version').default(0).notNull(),
    snapshot: jsonb('snapshot')
      .$type<DealStateSnapshot>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    lastRelevantEventId: uuid('last_relevant_event_id'),
    lastDecisionId: uuid('last_decision_id'),
    lastUpdatedAt: timestamp('last_updated_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex('deal_states_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('deal_states_deal_uidx').on(table.organizationId, table.dealId),
    foreignKey({
      columns: [table.organizationId, table.dealId],
      foreignColumns: [deals.organizationId, deals.id],
      name: 'deal_states_organization_deal_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.lastRelevantEventId],
      foreignColumns: [commercialEvents.organizationId, commercialEvents.id],
      name: 'deal_states_organization_event_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.lastDecisionId],
      foreignColumns: [aiDecisions.organizationId, aiDecisions.id],
      name: 'deal_states_organization_decision_fk'
    }).onDelete('set null')
  ]
);

export const memoryFacts = pgTable(
  'memory_facts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    scopeType: memoryScopeType('scope_type').notNull(),
    scopeId: uuid('scope_id').notNull(),
    factType: text('fact_type').notNull(),
    value: text('value').notNull(),
    valueFingerprint: text('value_fingerprint').notNull(),
    confidence: real('confidence').notNull(),
    sourceEventIds: jsonb('source_event_ids').$type<string[]>().notNull(),
    status: memoryFactStatus('status').default('ACTIVE').notNull(),
    aiDecisionId: uuid('ai_decision_id').notNull(),
    supersedesId: uuid('supersedes_id'),
    validFrom: timestamp('valid_from', { withTimezone: true }).defaultNow().notNull(),
    validTo: timestamp('valid_to', { withTimezone: true }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('memory_facts_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('memory_facts_decision_value_uidx').on(
      table.organizationId,
      table.aiDecisionId,
      table.scopeType,
      table.scopeId,
      table.factType,
      table.valueFingerprint
    ),
    foreignKey({
      columns: [table.organizationId, table.aiDecisionId],
      foreignColumns: [aiDecisions.organizationId, aiDecisions.id],
      name: 'memory_facts_organization_decision_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.supersedesId],
      foreignColumns: [table.organizationId, table.id],
      name: 'memory_facts_organization_supersedes_fk'
    }).onDelete('no action'),
    index('memory_facts_scope_idx').on(
      table.organizationId,
      table.scopeType,
      table.scopeId,
      table.status
    )
  ]
);

export const interventionTemplates = pgTable(
  'intervention_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade'
    }),
    code: text('code').notNull(),
    category: text('category').notNull(),
    subtype: text('subtype'),
    strategy: text('strategy').notNull(),
    title: text('title').notNull(),
    guidance: text('guidance').notNull(),
    suggestedQuestions: jsonb('suggested_questions')
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    warnings: jsonb('warnings')
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    conditions: jsonb('conditions')
      .$type<Record<string, unknown>>()
      .default(sql`'{}'::jsonb`)
      .notNull(),
    version: integer('version').default(1).notNull(),
    status: interventionTemplateStatus('status').default('ACTIVE').notNull(),
    ...timestamps
  },
  (table) => [
    uniqueIndex('intervention_templates_scope_code_version_uidx').on(
      sql`coalesce(${table.organizationId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      table.code,
      table.version
    ),
    index('intervention_templates_match_idx').on(table.organizationId, table.strategy, table.status)
  ]
);

export const interventionCandidates = pgTable(
  'intervention_candidates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    dealId: uuid('deal_id').notNull(),
    commercialEventId: uuid('commercial_event_id').notNull(),
    aiDecisionId: uuid('ai_decision_id').notNull(),
    templateId: uuid('template_id').references(() => interventionTemplates.id, {
      onDelete: 'set null'
    }),
    outcome: interventionOutcome('outcome').notNull(),
    title: text('title'),
    guidance: text('guidance'),
    question: text('question'),
    source: text('source').notNull(),
    confidence: real('confidence').notNull(),
    policyResult: aiDecisionPolicyResult('policy_result').notNull(),
    shadowMode: boolean('shadow_mode').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('intervention_candidates_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('intervention_candidates_decision_uidx').on(
      table.organizationId,
      table.aiDecisionId
    ),
    foreignKey({
      columns: [table.organizationId, table.dealId],
      foreignColumns: [deals.organizationId, deals.id],
      name: 'intervention_candidates_organization_deal_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.commercialEventId],
      foreignColumns: [commercialEvents.organizationId, commercialEvents.id],
      name: 'intervention_candidates_organization_event_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.aiDecisionId],
      foreignColumns: [aiDecisions.organizationId, aiDecisions.id],
      name: 'intervention_candidates_organization_decision_fk'
    }).onDelete('cascade')
  ]
);

export const generationJobs = pgTable(
  'generation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id').notNull(),
    generationKey: text('generation_key').notNull(),
    status: generationJobStatus('status').default('PENDING').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(3).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    correlationId: text('correlation_id').notNull(),
    errorCode: text('error_code'),
    ...timestamps
  },
  (table) => [
    uniqueIndex('generation_jobs_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('generation_jobs_key_uidx').on(table.organizationId, table.generationKey),
    uniqueIndex('generation_jobs_candidate_uidx').on(table.organizationId, table.candidateId),
    foreignKey({
      columns: [table.organizationId, table.candidateId],
      foreignColumns: [interventionCandidates.organizationId, interventionCandidates.id],
      name: 'generation_jobs_organization_candidate_fk'
    }).onDelete('cascade'),
    index('generation_jobs_claim_idx').on(table.status, table.availableAt, table.createdAt),
    check('generation_jobs_attempts_check', sql`${table.attempts} >= 0`)
  ]
);

export const generativeExecutions = pgTable(
  'generative_executions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    generationJobId: uuid('generation_job_id').notNull(),
    candidateId: uuid('candidate_id').notNull(),
    aiDecisionId: uuid('ai_decision_id').notNull(),
    dealId: uuid('deal_id').notNull(),
    commercialEventId: uuid('commercial_event_id').notNull(),
    sellerMembershipId: uuid('seller_membership_id'),
    conversationId: uuid('conversation_id'),
    generationKey: text('generation_key').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    profile: generativeProfile('profile').notNull(),
    status: generativeExecutionStatus('status').notNull(),
    configVersion: text('config_version').notNull(),
    promptVersion: text('prompt_version').notNull(),
    contextVersion: text('context_version').notNull(),
    policyVersion: text('policy_version').notNull(),
    inputSummary: jsonb('input_summary').$type<Record<string, unknown>>().notNull(),
    output: jsonb('output').$type<GenerationOutput>(),
    validationResult: generationValidationResult('validation_result'),
    validationErrors: jsonb('validation_errors')
      .$type<string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    attemptCount: integer('attempt_count').default(0).notNull(),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    estimatedCostMicros: bigint('estimated_cost_micros', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    generationStartedAt: timestamp('generation_started_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    generationCompletedAt: timestamp('generation_completed_at', { withTimezone: true }),
    validationCompletedAt: timestamp('validation_completed_at', { withTimezone: true }),
    deliveryCreatedAt: timestamp('delivery_created_at', { withTimezone: true }),
    generationLatencyMs: integer('generation_latency_ms'),
    generationToDeliveryMs: integer('generation_to_delivery_ms'),
    errorCode: text('error_code'),
    ...timestamps
  },
  (table) => [
    uniqueIndex('generative_executions_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('generative_executions_key_uidx').on(table.organizationId, table.generationKey),
    foreignKey({
      columns: [table.organizationId, table.generationJobId],
      foreignColumns: [generationJobs.organizationId, generationJobs.id],
      name: 'generative_executions_organization_job_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.candidateId],
      foreignColumns: [interventionCandidates.organizationId, interventionCandidates.id],
      name: 'generative_executions_organization_candidate_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.aiDecisionId],
      foreignColumns: [aiDecisions.organizationId, aiDecisions.id],
      name: 'generative_executions_organization_decision_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.dealId],
      foreignColumns: [deals.organizationId, deals.id],
      name: 'generative_executions_organization_deal_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.commercialEventId],
      foreignColumns: [commercialEvents.organizationId, commercialEvents.id],
      name: 'generative_executions_organization_event_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.sellerMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: 'generative_executions_organization_seller_fk'
    }).onDelete('no action'),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: 'generative_executions_organization_conversation_fk'
    }).onDelete('no action'),
    index('generative_executions_usage_idx').on(
      table.organizationId,
      table.provider,
      table.model,
      table.profile,
      table.createdAt
    )
  ]
);

export const aiUsage = pgTable(
  'ai_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    aiDecisionId: uuid('ai_decision_id'),
    generativeExecutionId: uuid('generative_execution_id'),
    callReportRevisionId: uuid('call_report_revision_id'),
    audioAssetId: uuid('audio_asset_id'),
    audioTranscriptId: uuid('audio_transcript_id'),
    liveCallSessionId: uuid('live_call_session_id'),
    liveTranscriptTurnId: uuid('live_transcript_turn_id'),
    dealId: uuid('deal_id'),
    commercialEventId: uuid('commercial_event_id'),
    sellerMembershipId: uuid('seller_membership_id'),
    conversationId: uuid('conversation_id'),
    interventionCandidateId: uuid('intervention_candidate_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    profile: text('profile'),
    purpose: text('purpose').default('DECISION').notNull(),
    success: boolean('success').notNull(),
    retryCount: integer('retry_count').default(0).notNull(),
    inputSize: integer('input_size').default(0).notNull(),
    outputSize: integer('output_size').default(0).notNull(),
    inputTokens: integer('input_tokens').default(0).notNull(),
    outputTokens: integer('output_tokens').default(0).notNull(),
    audioDurationMs: integer('audio_duration_ms').default(0).notNull(),
    usageMeasurement: text('usage_measurement').default('ACTUAL').notNull(),
    latencyMs: integer('latency_ms').default(0).notNull(),
    estimatedCostMicros: bigint('estimated_cost_micros', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    errorCode: text('error_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('ai_usage_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('ai_usage_decision_uidx').on(table.organizationId, table.aiDecisionId),
    uniqueIndex('ai_usage_generation_uidx').on(table.organizationId, table.generativeExecutionId),
    uniqueIndex('ai_usage_call_report_revision_uidx').on(
      table.organizationId,
      table.callReportRevisionId
    ),
    foreignKey({
      columns: [table.organizationId, table.callReportRevisionId],
      foreignColumns: [callReportRevisions.organizationId, callReportRevisions.id],
      name: 'ai_usage_organization_call_report_revision_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.aiDecisionId],
      foreignColumns: [aiDecisions.organizationId, aiDecisions.id],
      name: 'ai_usage_organization_decision_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.audioAssetId],
      foreignColumns: [audioAssets.organizationId, audioAssets.id],
      name: 'ai_usage_organization_audio_asset_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.audioTranscriptId],
      foreignColumns: [audioTranscripts.organizationId, audioTranscripts.id],
      name: 'ai_usage_organization_audio_transcript_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.liveCallSessionId],
      foreignColumns: [liveCallSessions.organizationId, liveCallSessions.id],
      name: 'ai_usage_organization_live_session_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.liveTranscriptTurnId],
      foreignColumns: [liveTranscriptTurns.organizationId, liveTranscriptTurns.id],
      name: 'ai_usage_organization_live_turn_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.generativeExecutionId],
      foreignColumns: [generativeExecutions.organizationId, generativeExecutions.id],
      name: 'ai_usage_organization_generation_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.dealId],
      foreignColumns: [deals.organizationId, deals.id],
      name: 'ai_usage_organization_deal_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.sellerMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: 'ai_usage_organization_seller_fk'
    }).onDelete('no action'),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: 'ai_usage_organization_conversation_fk'
    }).onDelete('no action'),
    foreignKey({
      columns: [table.organizationId, table.interventionCandidateId],
      foreignColumns: [interventionCandidates.organizationId, interventionCandidates.id],
      name: 'ai_usage_organization_candidate_fk'
    }).onDelete('no action'),
    foreignKey({
      columns: [table.organizationId, table.commercialEventId],
      foreignColumns: [commercialEvents.organizationId, commercialEvents.id],
      name: 'ai_usage_organization_event_fk'
    }).onDelete('cascade'),
    index('ai_usage_organization_created_idx').on(table.organizationId, table.createdAt)
  ]
);

export const intelligenceSettings = pgTable(
  'intelligence_settings',
  {
    organizationId: uuid('organization_id')
      .primaryKey()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    intelligenceEnabled: boolean('intelligence_enabled').default(false).notNull(),
    jevEnabled: boolean('jev_enabled').default(false).notNull(),
    shadowMode: boolean('shadow_mode').default(true).notNull(),
    interventionsVisible: boolean('interventions_visible').default(false).notNull(),
    realtimeEnabled: boolean('realtime_enabled').default(false).notNull(),
    feedbackEnabled: boolean('feedback_enabled').default(false).notNull(),
    generativeAiEnabled: boolean('generative_ai_enabled').default(false).notNull(),
    generateInShadow: boolean('generate_in_shadow').default(true).notNull(),
    audioIntelligenceEnabled: boolean('audio_intelligence_enabled').default(false).notNull(),
    audioRetentionDays: integer('audio_retention_days').default(30).notNull(),
    transcriptRetentionDays: integer('transcript_retention_days').default(90).notNull(),
    maxAudioBytes: integer('max_audio_bytes').default(20971520).notNull(),
    liveCallsEnabled: boolean('live_calls_enabled').default(false).notNull(),
    meetDetectionEnabled: boolean('meet_detection_enabled').default(false).notNull(),
    zoomDetectionEnabled: boolean('zoom_detection_enabled').default(false).notNull(),
    liveTranscriptionEnabled: boolean('live_transcription_enabled').default(false).notNull(),
    liveCopilotEnabled: boolean('live_copilot_enabled').default(false).notNull(),
    liveGenerationEnabled: boolean('live_generation_enabled').default(false).notNull(),
    callAutoStartEnabled: boolean('call_auto_start_enabled').default(false).notNull(),
    rawLiveAudioRetentionDays: integer('raw_live_audio_retention_days').default(0).notNull(),
    liveTranscriptRetentionDays: integer('live_transcript_retention_days').default(90).notNull(),
    liveMaxBufferBytes: integer('live_max_buffer_bytes').default(4194304).notNull(),
    liveTurnAggregationGapMs: integer('live_turn_aggregation_gap_ms').default(1200).notNull(),
    liveCardTtlSeconds: integer('live_card_ttl_seconds').default(20).notNull(),
    companyRules: jsonb('company_rules')
      .$type<string[]>()
      .default(
        sql`'["Não oferecer desconto sem aprovação.","Não inventar preço, prazo, feature ou condição comercial."]'::jsonb`
      )
      .notNull(),
    maxGenerationInputCharacters: integer('max_generation_input_characters')
      .default(6000)
      .notNull(),
    maxGenerationOutputCharacters: integer('max_generation_output_characters')
      .default(700)
      .notNull(),
    organizationGenerationBudgetMicros: bigint('organization_generation_budget_micros', {
      mode: 'bigint'
    })
      .default(sql`0`)
      .notNull(),
    sellerGenerationBudgetMicros: bigint('seller_generation_budget_micros', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    maxCostPerInterventionMicros: bigint('max_cost_per_intervention_micros', { mode: 'bigint' })
      .default(sql`0`)
      .notNull(),
    maxCardsPerWindow: integer('max_cards_per_window').default(3).notNull(),
    cardWindowSeconds: integer('card_window_seconds').default(900).notNull(),
    cooldownSeconds: integer('cooldown_seconds').default(180).notNull(),
    minimumPriority: integer('minimum_priority').default(40).notNull(),
    deliveryTtlSeconds: integer('delivery_ttl_seconds').default(900).notNull(),
    thresholds: jsonb('thresholds').$type<PolicyThresholds>().notNull(),
    policyVersion: text('policy_version').default('policy-v1').notNull(),
    contextVersion: text('context_version').default('context-v1').notNull(),
    decisionVersion: text('decision_version').default('decision-v1').notNull(),
    ...timestamps
  },
  (table) => [
    check(
      'intelligence_settings_card_limits_check',
      sql`${table.maxCardsPerWindow} > 0 and ${table.cardWindowSeconds} >= 30 and ${table.cooldownSeconds} >= 0 and ${table.minimumPriority} between 0 and 100 and ${table.deliveryTtlSeconds} >= 30 and ${table.maxGenerationInputCharacters} between 500 and 20000 and ${table.maxGenerationOutputCharacters} between 100 and 2000 and ${table.organizationGenerationBudgetMicros} >= 0 and ${table.sellerGenerationBudgetMicros} >= 0 and ${table.maxCostPerInterventionMicros} >= 0 and ${table.audioRetentionDays} between 1 and 3650 and ${table.transcriptRetentionDays} between 1 and 3650 and ${table.maxAudioBytes} between 1024 and 104857600 and ${table.rawLiveAudioRetentionDays} between 0 and 3650 and ${table.liveTranscriptRetentionDays} between 1 and 3650 and ${table.liveMaxBufferBytes} between 65536 and 67108864 and ${table.liveTurnAggregationGapMs} between 100 and 10000 and ${table.liveCardTtlSeconds} between 5 and 300`
    )
  ]
);

export const intelligenceJobs = pgTable(
  'intelligence_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    commercialEventId: uuid('commercial_event_id').notNull(),
    processingKey: text('processing_key').notNull(),
    status: intelligenceJobStatus('status').default('PENDING').notNull(),
    attempts: integer('attempts').default(0).notNull(),
    maxAttempts: integer('max_attempts').default(3).notNull(),
    availableAt: timestamp('available_at', { withTimezone: true }).defaultNow().notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    correlationId: text('correlation_id').notNull(),
    priority: integer('priority').default(0).notNull(),
    source: text('source').default('ASYNC').notNull(),
    deadlineAt: timestamp('deadline_at', { withTimezone: true }),
    errorCode: text('error_code'),
    ...timestamps
  },
  (table) => [
    uniqueIndex('intelligence_jobs_processing_key_uidx').on(
      table.organizationId,
      table.processingKey
    ),
    foreignKey({
      columns: [table.organizationId, table.commercialEventId],
      foreignColumns: [commercialEvents.organizationId, commercialEvents.id],
      name: 'intelligence_jobs_organization_event_fk'
    }).onDelete('cascade'),
    index('intelligence_jobs_claim_idx').on(
      table.status,
      table.priority,
      table.availableAt,
      table.createdAt
    ),
    check(
      'intelligence_jobs_attempts_check',
      sql`${table.attempts} >= 0 and ${table.priority} between 0 and 100`
    )
  ]
);

export const interventionDeliveries = pgTable(
  'intervention_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    candidateId: uuid('candidate_id').notNull(),
    sellerMembershipId: uuid('seller_membership_id').notNull(),
    conversationId: uuid('conversation_id').notNull(),
    liveCallSessionId: uuid('live_call_session_id'),
    liveTranscriptTurnId: uuid('live_transcript_turn_id'),
    dealId: uuid('deal_id').notNull(),
    category: interventionCategory('category').notNull(),
    priority: integer('priority').notNull(),
    dedupeKey: text('dedupe_key').notNull(),
    title: text('title').notNull(),
    guidance: text('guidance').notNull(),
    suggestedQuestion: text('suggested_question'),
    status: interventionDeliveryStatus('status').default('CREATED').notNull(),
    correlationId: text('correlation_id').notNull(),
    sourceEventOccurredAt: timestamp('source_event_occurred_at', { withTimezone: true }).notNull(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }),
    dismissedAt: timestamp('dismissed_at', { withTimezone: true }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    endToEndLatencyMs: integer('end_to_end_latency_ms'),
    ...timestamps
  },
  (table) => [
    uniqueIndex('intervention_deliveries_organization_id_uidx').on(table.organizationId, table.id),
    uniqueIndex('intervention_deliveries_candidate_uidx').on(
      table.organizationId,
      table.candidateId
    ),
    foreignKey({
      columns: [table.organizationId, table.candidateId],
      foreignColumns: [interventionCandidates.organizationId, interventionCandidates.id],
      name: 'intervention_deliveries_organization_candidate_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.sellerMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: 'intervention_deliveries_organization_seller_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: 'intervention_deliveries_organization_conversation_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.liveCallSessionId],
      foreignColumns: [liveCallSessions.organizationId, liveCallSessions.id],
      name: 'intervention_deliveries_organization_live_session_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.liveTranscriptTurnId],
      foreignColumns: [liveTranscriptTurns.organizationId, liveTranscriptTurns.id],
      name: 'intervention_deliveries_organization_live_turn_fk'
    }).onDelete('set null'),
    foreignKey({
      columns: [table.organizationId, table.dealId],
      foreignColumns: [deals.organizationId, deals.id],
      name: 'intervention_deliveries_organization_deal_fk'
    }).onDelete('cascade'),
    index('intervention_deliveries_current_idx').on(
      table.organizationId,
      table.sellerMembershipId,
      table.conversationId,
      table.status,
      table.expiresAt
    ),
    index('intervention_deliveries_dedupe_idx').on(
      table.organizationId,
      table.sellerMembershipId,
      table.dedupeKey,
      table.createdAt
    ),
    check('intervention_deliveries_priority_check', sql`${table.priority} between 0 and 100`)
  ]
);

export const interventionFeedback = pgTable(
  'intervention_feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    deliveryId: uuid('delivery_id').notNull(),
    sellerMembershipId: uuid('seller_membership_id').notNull(),
    rating: interventionFeedbackRating('rating').notNull(),
    actionTaken: text('action_taken'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('intervention_feedback_delivery_seller_uidx').on(
      table.organizationId,
      table.deliveryId,
      table.sellerMembershipId
    ),
    foreignKey({
      columns: [table.organizationId, table.deliveryId],
      foreignColumns: [interventionDeliveries.organizationId, interventionDeliveries.id],
      name: 'intervention_feedback_organization_delivery_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.sellerMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: 'intervention_feedback_organization_seller_fk'
    }).onDelete('cascade')
  ]
);

export const realtimeEvents = pgTable(
  'realtime_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    sellerMembershipId: uuid('seller_membership_id').notNull(),
    type: text('type').notNull(),
    version: integer('version').default(1).notNull(),
    correlationId: text('correlation_id').notNull(),
    conversationId: uuid('conversation_id'),
    dealId: uuid('deal_id'),
    liveCallSessionId: uuid('live_call_session_id'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => [
    uniqueIndex('realtime_events_organization_id_uidx').on(table.organizationId, table.id),
    foreignKey({
      columns: [table.organizationId, table.sellerMembershipId],
      foreignColumns: [memberships.organizationId, memberships.id],
      name: 'realtime_events_organization_seller_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.conversationId],
      foreignColumns: [conversations.organizationId, conversations.id],
      name: 'realtime_events_organization_conversation_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.dealId],
      foreignColumns: [deals.organizationId, deals.id],
      name: 'realtime_events_organization_deal_fk'
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.organizationId, table.liveCallSessionId],
      foreignColumns: [liveCallSessions.organizationId, liveCallSessions.id],
      name: 'realtime_events_organization_live_session_fk'
    }).onDelete('cascade'),
    index('realtime_events_replay_idx').on(
      table.organizationId,
      table.sellerMembershipId,
      table.occurredAt,
      table.id
    ),
    check(
      'realtime_events_type_check',
      sql`${table.type} in ('intervention.created', 'intervention.updated', 'deal_state.updated', 'call_report.processing', 'call_report.ready', 'call_report.failed')`
    ),
    check('realtime_events_version_check', sql`${table.version} = 1`)
  ]
);

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  memberships: many(memberships)
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, { fields: [session.userId], references: [user.id] })
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, { fields: [account.userId], references: [user.id] })
}));

export const organizationRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  auditLogs: many(auditLogs),
  contacts: many(contacts),
  deals: many(deals),
  conversations: many(conversations),
  messages: many(messages),
  commercialEvents: many(commercialEvents),
  crmConnections: many(crmConnections),
  syncJobs: many(syncJobs),
  dealStates: many(dealStates),
  aiDecisions: many(aiDecisions),
  memoryFacts: many(memoryFacts)
}));

export const membershipRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id]
  }),
  user: one(user, { fields: [memberships.userId], references: [user.id] })
}));

export const auditLogRelations = relations(auditLogs, ({ one }) => ({
  organization: one(organizations, {
    fields: [auditLogs.organizationId],
    references: [organizations.id]
  }),
  actor: one(user, { fields: [auditLogs.actorUserId], references: [user.id] })
}));
