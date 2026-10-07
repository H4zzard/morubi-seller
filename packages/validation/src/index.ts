import { z } from 'zod';
import {
  callPhases,
  interventionCategories,
  interventionDeliveryStatuses,
  liveCallStatuses,
  liveSpeakerRoles,
  meetingProviders,
  roles
} from '@morubi/contracts';

export const uuidSchema = z.uuid();
export const roleSchema = z.enum(roles);

export const signInSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128)
});

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional()
});

export const createMembershipSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  role: roleSchema
});

export const updateMembershipRoleSchema = z.object({ role: roleSchema });

export const notificationSchema = z.object({
  title: z.string().trim().min(1).max(80),
  body: z.string().trim().min(1).max(240)
});

export const cursorPageQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  search: z.string().trim().max(120).optional()
});

export const messagePageQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50)
});
export const conversationMessagesRequestSchema = z.object({
  conversationId: uuidSchema,
  cursor: z.string().trim().min(1).max(512).optional()
});

export const interventionCategorySchema = z.enum(interventionCategories);
export const interventionDeliveryStatusSchema = z.enum(interventionDeliveryStatuses);
export const interventionFeedbackSchema = z.object({
  rating: z.enum(['HELPFUL', 'NOT_HELPFUL']),
  actionTaken: z.string().trim().min(1).max(120).optional()
});
export const devConversationScenarioSchema = z.object({
  conversationId: uuidSchema,
  scenario: z.enum([
    'PRICE',
    'COMPETITOR',
    'TIMING',
    'DECISION_MAKER',
    'BUYING_SIGNAL',
    'REJECTION',
    'NEUTRAL'
  ])
});
export const devAudioScenarioSchema = z.object({
  conversationId: uuidSchema,
  scenario: z.enum(['PRICE', 'TIMING', 'COMPETITOR', 'BUYING_SIGNAL', 'NEUTRAL'])
});
export const audioSettingsSchema = z.object({ enabled: z.boolean() });
export const intelligenceDeliverySettingsSchema = z.object({
  mode: z.enum(['SHADOW', 'VISIBLE']),
  realtimeEnabled: z.boolean(),
  feedbackEnabled: z.boolean(),
  maxCardsPerWindow: z.number().int().min(1).max(20),
  cardWindowSeconds: z.number().int().min(30).max(86_400),
  cooldownSeconds: z.number().int().min(0).max(86_400),
  minimumPriority: z.number().int().min(0).max(100),
  deliveryTtlSeconds: z.number().int().min(30).max(86_400),
  generativeAiEnabled: z.boolean().default(false),
  generateInShadow: z.boolean().default(true),
  companyRules: z.array(z.string().trim().min(1).max(500)).max(30).default([]),
  maxGenerationInputCharacters: z.number().int().min(500).max(20_000).default(6_000),
  maxGenerationOutputCharacters: z.number().int().min(100).max(2_000).default(700),
  organizationGenerationBudgetMicros: z
    .number()
    .int()
    .min(0)
    .max(Number.MAX_SAFE_INTEGER)
    .default(0),
  sellerGenerationBudgetMicros: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  maxCostPerInterventionMicros: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0)
});
export const evaluationExportQuerySchema = z.object({
  format: z.enum(['json', 'csv']).default('json')
});
export const realtimeEventEnvelopeSchema = z.object({
  id: uuidSchema,
  version: z.literal(1),
  type: z.enum(['intervention.created', 'intervention.updated', 'deal_state.updated']),
  occurredAt: z.iso.datetime(),
  correlationId: z.string().min(1).max(120),
  conversationId: uuidSchema.nullable(),
  dealId: uuidSchema.nullable(),
  liveCallSessionId: uuidSchema.nullable(),
  payload: z.record(z.string(), z.unknown())
});

export const meetingProviderSchema = z.enum(meetingProviders);
export const liveCallStatusSchema = z.enum(liveCallStatuses);
export const liveSpeakerRoleSchema = z.enum(liveSpeakerRoles);
export const callPhaseSchema = z.enum(callPhases);

export const createLiveCallSchema = z.object({
  meetingProvider: meetingProviderSchema,
  meetingExternalId: z.string().trim().min(1).max(240).optional(),
  meetingTitle: z.string().trim().min(1).max(240).optional(),
  dealId: uuidSchema.optional(),
  contactId: uuidSchema.optional(),
  conversationId: uuidSchema.optional(),
  calendarEventId: z.string().trim().min(1).max(240).optional(),
  detectionConfidence: z.number().min(0).max(1).default(0),
  detectionEvidence: z
    .enum(['URL_HOST', 'PROCESS_NAME', 'WINDOW_TITLE', 'CALENDAR', 'MANUAL', 'FIXTURE'])
    .default('MANUAL')
});

export const linkLiveCallContextSchema = z
  .object({
    dealId: uuidSchema.optional(),
    contactId: uuidSchema.optional(),
    conversationId: uuidSchema.optional(),
    calendarEventId: z.string().trim().min(1).max(240).optional()
  })
  .refine((value) => Object.values(value).some((item) => item !== undefined), {
    message: 'At least one context field is required.'
  });

export const startLiveCallSchema = z.object({
  consentConfirmed: z.literal(true),
  consentMode: z
    .enum(['MANUAL_CONFIRMATION', 'ORGANIZATION_POLICY'])
    .default('MANUAL_CONFIRMATION'),
  policyVersion: z.string().trim().min(1).max(80).default('live-consent-v1'),
  captureMode: z.enum(['MICROPHONE', 'SYSTEM_AUDIO', 'MIXED', 'FIXTURE']),
  transcriptionMode: z.enum(['REALTIME', 'FIXTURE']),
  captureSources: z
    .array(z.enum(['LOCAL_SPEAKER', 'REMOTE_AUDIO', 'MIXED', 'UNKNOWN']))
    .min(1)
    .max(3)
});

export const liveTranscriptTurnSchema = z
  .object({
    clientTurnId: z.string().trim().min(1).max(160),
    speakerRole: liveSpeakerRoleSchema,
    speakerOrigin: z.enum(['LOCAL_SPEAKER', 'REMOTE_AUDIO', 'MIXED', 'UNKNOWN', 'FIXTURE']),
    speakerConfidence: z.number().min(0).max(1),
    text: z.string().trim().min(1).max(4_000),
    isPartial: z.boolean(),
    isFinal: z.boolean(),
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime().nullable(),
    confidence: z.number().min(0).max(1).nullable(),
    provider: z.string().trim().min(1).max(80),
    model: z.string().trim().min(1).max(120),
    sequence: z.number().int().min(0).max(1_000_000),
    audioProcessedMs: z.number().int().min(0).max(600_000).default(0),
    estimatedCostMicros: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0)
  })
  .refine((value) => value.isPartial !== value.isFinal, {
    message: 'A turn must be either partial or final.',
    path: ['isFinal']
  })
  .refine((value) => !value.isFinal || value.endedAt !== null, {
    message: 'A final turn requires endedAt.',
    path: ['endedAt']
  });

export const liveCallHeartbeatSchema = z.object({
  bufferedBytes: z.number().int().min(0).max(67_108_864).default(0),
  droppedChunks: z.number().int().min(0).max(1_000_000).default(0)
});

export const liveCallWindowModeSchema = z.object({
  compact: z.boolean(),
  alwaysOnTop: z.boolean().default(false)
});

export const liveCallSettingsSchema = z.object({
  callCaptureEnabled: z.boolean(),
  meetDetectionEnabled: z.boolean(),
  zoomDetectionEnabled: z.boolean(),
  liveTranscriptionEnabled: z.boolean(),
  liveCopilotEnabled: z.boolean(),
  liveGenerationEnabled: z.boolean(),
  autoStartEnabled: z.boolean().default(false),
  rawAudioRetentionDays: z.number().int().min(0).max(3650).default(0),
  transcriptRetentionDays: z.number().int().min(1).max(3650).default(90),
  maxBufferBytes: z.number().int().min(65_536).max(67_108_864).default(4_194_304),
  turnAggregationGapMs: z.number().int().min(100).max(10_000).default(1_200),
  liveCardTtlSeconds: z.number().int().min(5).max(300).default(20)
});

export const devLiveCallScenarioSchema = z.object({
  meetingProvider: z.enum(['MEET', 'ZOOM']),
  conversationId: uuidSchema,
  action: z.enum(['DETECT', 'START', 'EMIT_SCRIPT', 'END']),
  sessionId: uuidSchema.optional()
});

export type SignInInput = z.infer<typeof signInSchema>;
export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type CreateMembershipInput = z.infer<typeof createMembershipSchema>;
export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;
