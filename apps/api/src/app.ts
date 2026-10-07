import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import type { MorubiAuth } from '@morubi/auth';
import { evaluateGenerativeCorpus, exportGenerativeEvaluationCsv } from '@morubi/ai';
import type { ApiEnv } from '@morubi/config';
import type { UserDto } from '@morubi/contracts';
import {
  AuditRepository,
  AudioAssetService,
  CommercialIngestionService,
  ContactRepository,
  CopilotRepository,
  ConversationRepository,
  CRMConnectionRepository,
  DealRepository,
  devConversationScenarios,
  devAudioScenarios,
  syntheticWavFixture,
  GenerativeReadRepository,
  IntelligenceReadRepository,
  IntelligenceJobRepository,
  LiveCallRepository,
  MembershipRepository,
  OrganizationRepository,
  resolveTenantContext,
  type DatabaseHandle
} from '@morubi/db';
import { fixtureLiveCallScript } from '@morubi/live-calls';
import { LocalObjectStorage, type ObjectStorage } from '@morubi/storage';
import { AppError, errors, type TenantContext } from '@morubi/domain';
import { can, type Permission } from '@morubi/permissions';
import {
  createMembershipSchema,
  createOrganizationSchema,
  cursorPageQuerySchema,
  devConversationScenarioSchema,
  devAudioScenarioSchema,
  audioSettingsSchema,
  createLiveCallSchema,
  devLiveCallScenarioSchema,
  evaluationExportQuerySchema,
  intelligenceDeliverySettingsSchema,
  interventionFeedbackSchema,
  messagePageQuerySchema,
  liveCallHeartbeatSchema,
  linkLiveCallContextSchema,
  liveCallSettingsSchema,
  liveTranscriptTurnSchema,
  startLiveCallSchema,
  updateMembershipRoleSchema,
  uuidSchema
} from '@morubi/validation';
import { registerBetterAuthRoutes, sessionResolverFromAuth } from './better-auth-handler.js';
import { evaluateFixtureCorpus, exportEvaluationCsv } from '@morubi/intelligence';
import type { SessionResolver } from './types.js';

export interface AppDependencies {
  database: DatabaseHandle;
  env: ApiEnv;
  auth?: MorubiAuth;
  sessionResolver?: SessionResolver;
  audioStorage?: ObjectStorage;
}

function incomingHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === 'string') headers.set(key, value);
    else if (value) value.forEach((item) => headers.append(key, item));
  }
  return headers;
}

async function requireIdentity(
  request: FastifyRequest,
  resolver: SessionResolver
): Promise<UserDto> {
  const identity = await resolver.resolve(incomingHeaders(request));
  if (!identity) throw errors.unauthorized();
  request.log = request.log.child({ userId: identity.id });
  return identity;
}

async function requireTenant(
  request: FastifyRequest,
  resolver: SessionResolver,
  database: DatabaseHandle
): Promise<{ identity: UserDto; context: TenantContext }> {
  const identity = await requireIdentity(request, resolver);
  const organizationId = uuidSchema.safeParse(request.headers['x-organization-id']);
  if (!organizationId.success) throw errors.validation([{ path: 'x-organization-id' }]);
  const context = await resolveTenantContext(database.db, identity.id, organizationId.data);
  // A missing membership is deliberately indistinguishable from a missing tenant.
  if (!context) throw errors.notFound();
  request.log = request.log.child({
    organizationId: context.organizationId,
    membershipId: context.membershipId,
    role: context.role
  });
  return { identity, context };
}

function requirePermission(context: TenantContext, permission: Permission): void {
  if (!can(context, permission)) throw errors.forbidden();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && Reflect.get(error, 'code') === '23505';
}

export async function buildApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const { database, env } = dependencies;
  const audioStorage = dependencies.audioStorage ?? new LocalObjectStorage(env.AUDIO_STORAGE_ROOT);
  const resolver =
    dependencies.sessionResolver ??
    (dependencies.auth ? sessionResolverFromAuth(dependencies.auth) : undefined);
  if (!resolver) throw new Error('An auth instance or sessionResolver is required');

  const app = Fastify({
    trustProxy: env.TRUST_PROXY,
    genReqId(request) {
      const candidate = request.headers['x-request-id'];
      return typeof candidate === 'string' && /^[a-zA-Z0-9_-]{8,80}$/.test(candidate)
        ? candidate
        : randomUUID();
    },
    logger: {
      level: env.LOG_LEVEL,
      base: { app: 'api', environment: env.NODE_ENV },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers.set-cookie',
          'body.password',
          '*.password',
          '*.token'
        ],
        censor: '[REDACTED]'
      }
    }
  });
  await app.register(cors, {
    origin: [env.WEB_ORIGIN, env.DESKTOP_DEV_ORIGIN],
    credentials: true,
    allowedHeaders: [
      'content-type',
      'x-request-id',
      'x-organization-id',
      'x-morubi-client',
      'last-event-id'
    ],
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS']
  });

  if (dependencies.auth) registerBetterAuthRoutes(app, dependencies.auth, env.BETTER_AUTH_URL);

  app.get('/health', () => ({ status: 'ok', service: 'morubi-api' }));

  app.get('/v1/auth/session', async (request) => {
    const identity = await requireIdentity(request, resolver);
    const choices = await new OrganizationRepository(database.db).listForUser(identity.id);
    const requestedOrganizationId = request.headers['x-organization-id'];
    const context =
      typeof requestedOrganizationId === 'string' &&
      uuidSchema.safeParse(requestedOrganizationId).success
        ? await resolveTenantContext(database.db, identity.id, requestedOrganizationId)
        : null;
    return { user: identity, tenant: context, organizations: choices };
  });

  app.post('/v1/auth/session/audit', async (request, reply) => {
    const { context } = await requireTenant(request, resolver, database);
    await new AuditRepository(database.db, context).record(
      'user.login',
      'session',
      context.membershipId,
      { client: request.headers['x-morubi-client'] ?? 'unknown' }
    );
    return reply.status(204).send();
  });

  app.get('/v1/me', async (request) => {
    const { identity, context } = await requireTenant(request, resolver, database);
    return { user: identity, tenant: context };
  });

  app.get('/v1/organizations', async (request) => {
    const identity = await requireIdentity(request, resolver);
    return new OrganizationRepository(database.db).listForUser(identity.id);
  });

  app.post('/v1/organizations', async (request, reply) => {
    const identity = await requireIdentity(request, resolver);
    const input = createOrganizationSchema.parse(request.body);
    try {
      const created = await new OrganizationRepository(database.db).createForUser(
        identity.id,
        input.name,
        input.slug
      );
      return reply.status(201).send(created);
    } catch (error) {
      if (isUniqueViolation(error))
        throw errors.conflict('Este slug de organização já está em uso.');
      throw error;
    }
  });

  app.get('/v1/organizations/current', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'organization.view');
    const organization = await new OrganizationRepository(database.db).getCurrent(context);
    if (!organization) throw errors.notFound();
    return organization;
  });

  app.get<{ Querystring: { cursor?: string; limit?: string; search?: string } }>(
    '/v1/contacts',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'commercial.read');
      return new ContactRepository(database.db, context).list(
        cursorPageQuerySchema.parse(request.query)
      );
    }
  );

  app.get<{ Params: { contactId: string } }>('/v1/contacts/:contactId', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'commercial.read');
    const contactId = uuidSchema.parse(request.params.contactId);
    const contact = await new ContactRepository(database.db, context).getById(contactId);
    if (!contact) throw errors.notFound();
    return contact;
  });

  app.get<{ Querystring: { cursor?: string; limit?: string; search?: string } }>(
    '/v1/deals',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'commercial.read');
      return new DealRepository(database.db, context).list(
        cursorPageQuerySchema.parse(request.query)
      );
    }
  );

  app.get<{ Params: { dealId: string } }>('/v1/deals/:dealId', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'commercial.read');
    const dealId = uuidSchema.parse(request.params.dealId);
    const deal = await new DealRepository(database.db, context).getById(dealId);
    if (!deal) throw errors.notFound();
    return deal;
  });

  app.get<{ Params: { dealId: string } }>('/v1/deals/:dealId/state', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'intelligence.read');
    const dealId = uuidSchema.parse(request.params.dealId);
    if (!(await new DealRepository(database.db, context).getById(dealId))) throw errors.notFound();
    return {
      state: await new IntelligenceReadRepository(database.db, context).getDealState(dealId)
    };
  });

  app.get<{ Params: { dealId: string } }>('/v1/deals/:dealId/memory', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'intelligence.read');
    const dealId = uuidSchema.parse(request.params.dealId);
    if (!(await new DealRepository(database.db, context).getById(dealId))) throw errors.notFound();
    return {
      items: await new IntelligenceReadRepository(database.db, context).getDealMemory(dealId)
    };
  });

  app.get<{ Querystring: { limit?: string } }>(
    '/v1/dev/intelligence/decisions',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'intelligence.dev.read');
      if (env.NODE_ENV === 'production' && !env.INTELLIGENCE_DEV_UI) throw errors.notFound();
      const requested = Number(request.query.limit ?? 100);
      const limit =
        Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 200) : 100;
      return {
        items: await new IntelligenceReadRepository(database.db, context).listDecisions(limit)
      };
    }
  );

  app.get<{ Querystring: { cursor?: string; limit?: string; search?: string } }>(
    '/v1/conversations',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'commercial.read');
      return new ConversationRepository(database.db, context).list(
        cursorPageQuerySchema.parse(request.query)
      );
    }
  );

  app.get<{
    Params: { conversationId: string };
    Querystring: { cursor?: string; limit?: string };
  }>('/v1/conversations/:conversationId/messages', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'commercial.read');
    const conversationId = uuidSchema.parse(request.params.conversationId);
    const result = await new ConversationRepository(database.db, context).listMessages(
      conversationId,
      messagePageQuerySchema.parse(request.query)
    );
    if (!result) throw errors.notFound();
    return result;
  });

  app.get<{ Params: { messageId: string } }>(
    '/v1/messages/:messageId/audio',
    async (request, reply) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'commercial.read');
      if (!env.AUDIO_INTELLIGENCE_ENABLED) throw errors.notFound();
      const result = await new AudioAssetService(database.db, context, audioStorage, {
        maxBytes: env.AUDIO_MAX_BYTES,
        retentionDays: env.AUDIO_RETENTION_DAYS,
        provider: 'api-read',
        model: 'none'
      }).getBinaryByMessage(uuidSchema.parse(request.params.messageId));
      if (!result) throw errors.notFound();
      return reply
        .header('cache-control', 'private, no-store')
        .type(result.mimeType)
        .send(Buffer.from(result.dataBase64, 'base64'));
    }
  );

  app.post<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/read',
    async (request, reply) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'commercial.read');
      await new ConversationRepository(database.db, context).markRead(
        uuidSchema.parse(request.params.conversationId)
      );
      return reply.status(204).send();
    }
  );

  app.get<{ Params: { conversationId: string } }>(
    '/v1/conversations/:conversationId/context',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'intervention.viewOwn');
      const result = await new CopilotRepository(database.db, context).getConversationContext(
        uuidSchema.parse(request.params.conversationId)
      );
      if (!result) throw errors.notFound();
      return result;
    }
  );

  app.get('/v1/realtime/events', async (request, reply) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'intervention.viewOwn');
    if (!env.REALTIME_ENABLED) throw errors.notFound();
    const repository = new CopilotRepository(database.db, context);
    const header = request.headers['last-event-id'];
    let lastEventId =
      typeof header === 'string' && uuidSchema.safeParse(header).success ? header : undefined;
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    });
    reply.raw.write('retry: 2000\n\n');
    const deadline = Date.now() + 25_000;
    while (!reply.raw.destroyed && Date.now() < deadline) {
      const events = await repository.listRealtimeEvents(lastEventId, 50);
      for (const event of events) {
        reply.raw.write(
          `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
        );
        lastEventId = event.id;
      }
      if (events.length === 0) reply.raw.write(': heartbeat\n\n');
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    if (!reply.raw.destroyed) reply.raw.end();
  });

  app.post<{ Params: { deliveryId: string } }>(
    '/v1/interventions/:deliveryId/viewed',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'intervention.viewOwn');
      return new CopilotRepository(database.db, context).transition(
        uuidSchema.parse(request.params.deliveryId),
        'VIEWED'
      );
    }
  );

  app.post<{ Params: { deliveryId: string } }>(
    '/v1/interventions/:deliveryId/dismiss',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'intervention.viewOwn');
      return new CopilotRepository(database.db, context).transition(
        uuidSchema.parse(request.params.deliveryId),
        'DISMISSED'
      );
    }
  );

  app.post<{ Params: { deliveryId: string } }>(
    '/v1/interventions/:deliveryId/applied',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'intervention.viewOwn');
      return new CopilotRepository(database.db, context).transition(
        uuidSchema.parse(request.params.deliveryId),
        'APPLIED'
      );
    }
  );

  app.post<{ Params: { deliveryId: string } }>(
    '/v1/interventions/:deliveryId/feedback',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'intervention.feedbackOwn');
      return new CopilotRepository(database.db, context).feedback(
        uuidSchema.parse(request.params.deliveryId),
        interventionFeedbackSchema.parse(request.body)
      );
    }
  );

  app.patch('/v1/dev/intelligence/settings', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'intelligence.dev.inspect');
    if (env.NODE_ENV === 'production' && !env.INTELLIGENCE_DEV_UI) throw errors.notFound();
    return new CopilotRepository(database.db, context).updateSettings(
      intelligenceDeliverySettingsSchema.parse(request.body)
    );
  });

  app.get('/v1/dev/intelligence/analytics', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'intelligence.dev.inspect');
    if (env.NODE_ENV === 'production' && !env.INTELLIGENCE_DEV_UI) throw errors.notFound();
    return new CopilotRepository(database.db, context).analytics();
  });

  app.get<{ Querystring: { format?: string } }>(
    '/v1/dev/intelligence/evaluation',
    async (request, reply) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'intelligence.dev.inspect');
      if (env.NODE_ENV === 'production' && !env.INTELLIGENCE_DEV_UI) throw errors.notFound();
      const { format } = evaluationExportQuerySchema.parse(request.query);
      const report = await evaluateFixtureCorpus();
      if (format === 'csv') {
        return reply
          .type('text/csv; charset=utf-8')
          .header('content-disposition', 'attachment; filename="morubi-copilot-evaluation.csv"')
          .send(exportEvaluationCsv(report));
      }
      return report;
    }
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/v1/dev/intelligence/generative-executions',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'intelligence.dev.inspect');
      if (env.NODE_ENV === 'production' && !env.INTELLIGENCE_DEV_UI) throw errors.notFound();
      const requested = Number(request.query.limit ?? 100);
      const limit =
        Number.isSafeInteger(requested) && requested > 0 ? Math.min(requested, 200) : 100;
      return {
        items: await new GenerativeReadRepository(database.db, context).listExecutions(limit)
      };
    }
  );

  app.get<{ Querystring: { format?: string } }>(
    '/v1/dev/intelligence/generative-evaluation',
    async (request, reply) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'intelligence.dev.inspect');
      if (env.NODE_ENV === 'production' && !env.INTELLIGENCE_DEV_UI) throw errors.notFound();
      const { format } = evaluationExportQuerySchema.parse(request.query);
      const report = await evaluateGenerativeCorpus();
      if (format === 'csv') {
        return reply
          .type('text/csv; charset=utf-8')
          .header('content-disposition', 'attachment; filename="morubi-generative-evaluation.csv"')
          .send(exportGenerativeEvaluationCsv(report));
      }
      return report;
    }
  );

  app.post('/v1/dev/conversations/simulate', async (request, reply) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'intelligence.dev.inspect');
    if (env.NODE_ENV === 'production' && !env.INTELLIGENCE_DEV_UI) throw errors.notFound();
    const input = devConversationScenarioSchema.parse(request.body);
    const repository = new CopilotRepository(database.db, context);
    const conversation = await repository.getConversationContext(input.conversationId);
    if (!conversation) throw errors.notFound();
    const text = devConversationScenarios[input.scenario];
    const occurredAt = new Date();
    const externalId = randomUUID();
    const ingestion = new CommercialIngestionService(database.db, context);
    const source = {
      provider: 'fixture',
      externalWorkspaceId: `dev-${context.organizationId}`,
      externalId,
      observedAt: occurredAt,
      providerOccurredAt: occurredAt,
      providerUpdatedAt: occurredAt,
      rawPayload: { scenario: input.scenario, text }
    };
    const message = await ingestion.ingestMessage(source, {
      conversationId: input.conversationId,
      senderType: 'LEAD',
      senderDisplayName: conversation.conversation.contactName ?? 'Lead sintético',
      contentType: 'TEXT',
      text,
      occurredAt
    });
    const event = await ingestion.ingestCommercialEvent(
      { ...source, externalId: `${externalId}:event` },
      {
        contactId: null,
        dealId: conversation.conversation.dealId,
        conversationId: input.conversationId,
        messageId: message.id,
        actorType: 'LEAD',
        source: 'MANUAL',
        type: 'MESSAGE',
        text,
        occurredAt,
        metadata: { fixture: true, scenario: input.scenario }
      }
    );
    const jobId = await new IntelligenceJobRepository(database.db, context).enqueue(
      event.id,
      request.id
    );
    return reply.status(202).send({ messageId: message.id, eventId: event.id, jobId });
  });

  app.patch('/v1/dev/audio/settings', async (request, reply) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'intelligence.dev.inspect');
    if (env.NODE_ENV === 'production' || !env.INTELLIGENCE_DEV_UI) throw errors.notFound();
    if (!env.AUDIO_INTELLIGENCE_ENABLED) throw errors.notFound();
    const { enabled } = audioSettingsSchema.parse(request.body);
    await new AudioAssetService(database.db, context, audioStorage, {
      maxBytes: env.AUDIO_MAX_BYTES,
      retentionDays: env.AUDIO_RETENTION_DAYS,
      provider: env.GEMINI_TRANSCRIPTION_ENABLED ? 'gemini' : 'fixture-transcription',
      model: env.GEMINI_TRANSCRIPTION_ENABLED ? 'gemini-3.5-transcribe' : 'fixture-v1'
    }).setOrganizationEnabled(enabled);
    return reply.send({ enabled });
  });

  app.get('/v1/dev/audio/assets', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'intelligence.dev.inspect');
    if (env.NODE_ENV === 'production' || !env.INTELLIGENCE_DEV_UI) throw errors.notFound();
    return {
      items: await new AudioAssetService(database.db, context, audioStorage, {
        maxBytes: env.AUDIO_MAX_BYTES,
        retentionDays: env.AUDIO_RETENTION_DAYS,
        provider: 'read',
        model: 'none'
      }).list()
    };
  });

  app.post('/v1/dev/audio/simulate', async (request, reply) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'intelligence.dev.inspect');
    if (
      env.NODE_ENV === 'production' ||
      !env.INTELLIGENCE_DEV_UI ||
      !env.AUDIO_INTELLIGENCE_ENABLED
    )
      throw errors.notFound();
    const input = devAudioScenarioSchema.parse(request.body);
    const repository = new CopilotRepository(database.db, context);
    const conversation = await repository.getConversationContext(input.conversationId);
    if (!conversation) throw errors.notFound();
    const text = devAudioScenarios[input.scenario];
    const occurredAt = new Date();
    const externalId = randomUUID();
    const ingestion = new CommercialIngestionService(database.db, context);
    const source = {
      provider: 'fixture-audio',
      externalWorkspaceId: `dev-${context.organizationId}`,
      externalId,
      observedAt: occurredAt,
      providerOccurredAt: occurredAt,
      providerUpdatedAt: occurredAt,
      rawPayload: { scenario: input.scenario, contentType: 'AUDIO' }
    };
    const message = await ingestion.ingestMessage(source, {
      conversationId: input.conversationId,
      senderType: 'LEAD',
      senderDisplayName: conversation.conversation.contactName ?? 'Lead sintÃ©tico',
      contentType: 'AUDIO',
      occurredAt
    });
    const service = new AudioAssetService(database.db, context, audioStorage, {
      maxBytes: env.AUDIO_MAX_BYTES,
      retentionDays: env.AUDIO_RETENTION_DAYS,
      provider: env.GEMINI_TRANSCRIPTION_ENABLED ? 'gemini' : 'fixture-transcription',
      model: env.GEMINI_TRANSCRIPTION_ENABLED ? 'gemini-3.5-transcribe' : 'fixture-v1'
    });
    await service.setOrganizationEnabled(true);
    const audio = syntheticWavFixture(text);
    const result = await service.ingest({
      conversationId: input.conversationId,
      messageId: message.id,
      sourceProvider: 'fixture-audio',
      mimeType: 'audio/wav',
      durationMs: 1_000,
      speakerType: 'LEAD',
      occurredAt,
      data: audio,
      metadata: { fixture: true, scenario: input.scenario },
      correlationId: request.id
    });
    return reply.status(202).send({ messageId: message.id, ...result });
  });

  app.get('/v1/live-calls/current', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'commercial.read');
    if (!env.LIVE_CALLS_ENABLED) throw errors.notFound();
    return {
      session: await new LiveCallRepository(database.db, context, true).current()
    };
  });

  app.post('/v1/live-calls', async (request, reply) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'commercial.read');
    if (!env.LIVE_CALLS_ENABLED) throw errors.notFound();
    const input = createLiveCallSchema.parse(request.body);
    const session = await new LiveCallRepository(database.db, context, true).create(input);
    return reply.status(201).send(session);
  });

  app.get<{ Params: { sessionId: string } }>('/v1/live-calls/:sessionId', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'commercial.read');
    if (!env.LIVE_CALLS_ENABLED) throw errors.notFound();
    const session = await new LiveCallRepository(database.db, context, true).get(
      uuidSchema.parse(request.params.sessionId)
    );
    if (!session) throw errors.notFound();
    return session;
  });

  app.patch<{ Params: { sessionId: string } }>(
    '/v1/live-calls/:sessionId/context',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'commercial.read');
      if (!env.LIVE_CALLS_ENABLED) throw errors.notFound();
      return new LiveCallRepository(database.db, context, true).linkContext(
        uuidSchema.parse(request.params.sessionId),
        linkLiveCallContextSchema.parse(request.body)
      );
    }
  );

  app.post<{ Params: { sessionId: string } }>(
    '/v1/live-calls/:sessionId/start',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'commercial.read');
      if (!env.LIVE_CALLS_ENABLED || !env.LIVE_TRANSCRIPTION_ENABLED) throw errors.notFound();
      const input = startLiveCallSchema.parse(request.body);
      return new LiveCallRepository(database.db, context, true).start(
        uuidSchema.parse(request.params.sessionId),
        input
      );
    }
  );

  app.post<{ Params: { sessionId: string } }>(
    '/v1/live-calls/:sessionId/heartbeat',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'commercial.read');
      if (!env.LIVE_CALLS_ENABLED) throw errors.notFound();
      return new LiveCallRepository(database.db, context, true).heartbeat(
        uuidSchema.parse(request.params.sessionId),
        liveCallHeartbeatSchema.parse(request.body)
      );
    }
  );

  app.post<{ Params: { sessionId: string } }>(
    '/v1/live-calls/:sessionId/turns',
    async (request, reply) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'commercial.read');
      if (!env.LIVE_CALLS_ENABLED || !env.LIVE_TRANSCRIPTION_ENABLED) throw errors.notFound();
      const input = liveTranscriptTurnSchema.parse(request.body);
      const estimatedCostMicros = BigInt(
        Math.ceil((input.audioProcessedMs * env.LIVE_TRANSCRIPTION_COST_MICROS_PER_MINUTE) / 60_000)
      );
      const result = await new LiveCallRepository(database.db, context, true).acceptTurn(
        uuidSchema.parse(request.params.sessionId),
        {
          ...input,
          startedAt: new Date(input.startedAt),
          endedAt: input.endedAt ? new Date(input.endedAt) : null,
          estimatedCostMicros
        },
        request.id
      );
      return reply.status(input.isFinal ? 202 : 200).send(result);
    }
  );

  app.post<{ Params: { sessionId: string } }>('/v1/live-calls/:sessionId/end', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'commercial.read');
    if (!env.LIVE_CALLS_ENABLED) throw errors.notFound();
    return new LiveCallRepository(database.db, context, true).end(
      uuidSchema.parse(request.params.sessionId)
    );
  });

  app.get('/v1/dev/live-calls/settings', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'intelligence.dev.inspect');
    if (env.NODE_ENV === 'production' || !env.INTELLIGENCE_DEV_UI || !env.LIVE_CALLS_ENABLED)
      throw errors.notFound();
    return new LiveCallRepository(database.db, context, true).settings();
  });

  app.patch('/v1/dev/live-calls/settings', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'intelligence.dev.inspect');
    if (env.NODE_ENV === 'production' || !env.INTELLIGENCE_DEV_UI || !env.LIVE_CALLS_ENABLED)
      throw errors.notFound();
    return new LiveCallRepository(database.db, context, true).updateSettings(
      liveCallSettingsSchema.parse(request.body)
    );
  });

  app.post('/v1/dev/live-calls/simulate', async (request, reply) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'intelligence.dev.inspect');
    if (env.NODE_ENV === 'production' || !env.INTELLIGENCE_DEV_UI || !env.LIVE_CALLS_ENABLED)
      throw errors.notFound();
    const input = devLiveCallScenarioSchema.parse(request.body);
    const live = new LiveCallRepository(database.db, context, true);
    if (input.action === 'DETECT') {
      await live.updateSettings({
        callCaptureEnabled: true,
        meetDetectionEnabled: true,
        zoomDetectionEnabled: true,
        liveTranscriptionEnabled: true,
        liveCopilotEnabled: true,
        liveGenerationEnabled: false,
        autoStartEnabled: false,
        rawAudioRetentionDays: 0,
        transcriptRetentionDays: 90,
        maxBufferBytes: 4_194_304,
        turnAggregationGapMs: 1_200,
        liveCardTtlSeconds: 20
      });
      const session = await live.create({
        meetingProvider: input.meetingProvider,
        meetingExternalId: `fixture-${randomUUID()}`,
        meetingTitle: `${input.meetingProvider === 'MEET' ? 'Google Meet' : 'Zoom'} detectado`,
        conversationId: input.conversationId,
        detectionConfidence: 1,
        detectionEvidence: 'FIXTURE'
      });
      return reply.status(201).send(session);
    }
    const sessionId = input.sessionId ?? (await live.current())?.id;
    if (!sessionId) throw errors.notFound();
    if (input.action === 'START') {
      return live.start(sessionId, {
        consentMode: 'MANUAL_CONFIRMATION',
        policyVersion: 'live-consent-v1',
        captureMode: 'FIXTURE',
        transcriptionMode: 'FIXTURE',
        captureSources: ['LOCAL_SPEAKER', 'REMOTE_AUDIO']
      });
    }
    if (input.action === 'EMIT_SCRIPT') {
      const base = Date.now();
      const results = [];
      for (const [index, entry] of fixtureLiveCallScript.entries()) {
        const clientTurnId = `fixture-${index + 1}`;
        const startedAt = new Date(base + index * 4_000);
        if (entry.partial) {
          await live.acceptTurn(
            sessionId,
            {
              clientTurnId,
              speakerRole: entry.speakerRole,
              speakerOrigin: 'FIXTURE',
              speakerConfidence: 1,
              text: entry.partial,
              isPartial: true,
              isFinal: false,
              startedAt,
              endedAt: null,
              confidence: null,
              provider: 'fixture-realtime',
              model: 'fixture-realtime-v1',
              sequence: index + 1,
              audioProcessedMs: 0,
              estimatedCostMicros: 0n
            },
            request.id
          );
        }
        results.push(
          await live.acceptTurn(
            sessionId,
            {
              clientTurnId,
              speakerRole: entry.speakerRole,
              speakerOrigin: 'FIXTURE',
              speakerConfidence: 1,
              text: entry.final,
              isPartial: false,
              isFinal: true,
              startedAt,
              endedAt: new Date(startedAt.getTime() + entry.durationMs),
              confidence: 1,
              provider: 'fixture-realtime',
              model: 'fixture-realtime-v1',
              sequence: index + 1,
              audioProcessedMs: entry.durationMs,
              estimatedCostMicros: 0n
            },
            request.id
          )
        );
      }
      return reply.status(202).send({ session: await live.get(sessionId), results });
    }
    return live.end(sessionId);
  });

  app.get('/v1/memberships', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'membership.view');
    return new MembershipRepository(database.db, context).list();
  });

  app.get('/v1/integrations/crm', async (request) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'integration.read');
    const connections = await new CRMConnectionRepository(database.db, context).list();
    return {
      pilotProvider: null,
      providerSelectionRequired: true,
      connections
    };
  });

  app.get<{ Params: { connectionId: string } }>(
    '/v1/integrations/crm/:connectionId/status',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'integration.read');
      const connectionId = uuidSchema.parse(request.params.connectionId);
      const connection = (await new CRMConnectionRepository(database.db, context).list()).find(
        (candidate) => candidate.id === connectionId
      );
      if (!connection) throw errors.notFound();
      return connection;
    }
  );

  app.post('/v1/memberships', async (request, reply) => {
    const { context } = await requireTenant(request, resolver, database);
    requirePermission(context, 'membership.manage');
    const input = createMembershipSchema.parse(request.body);
    try {
      const membership = await new MembershipRepository(database.db, context).addByEmail(
        input.email,
        input.role
      );
      return reply.status(201).send(membership);
    } catch (error) {
      if (isUniqueViolation(error))
        throw errors.conflict('Este usuário já pertence à organização.');
      throw error;
    }
  });

  app.patch<{ Params: { membershipId: string } }>(
    '/v1/memberships/:membershipId/role',
    async (request) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'membership.manage');
      const membershipId = uuidSchema.parse(request.params.membershipId);
      const input = updateMembershipRoleSchema.parse(request.body);
      return new MembershipRepository(database.db, context).updateRole(membershipId, input.role);
    }
  );

  app.delete<{ Params: { membershipId: string } }>(
    '/v1/memberships/:membershipId',
    async (request, reply) => {
      const { context } = await requireTenant(request, resolver, database);
      requirePermission(context, 'membership.manage');
      const membershipId = uuidSchema.parse(request.params.membershipId);
      await new MembershipRepository(database.db, context).remove(membershipId);
      return reply.status(204).send();
    }
  );

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Os dados informados são inválidos.',
          requestId: request.id,
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        }
      });
    }
    if (error instanceof AppError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, requestId: request.id }
      });
    }
    request.log.error({ err: error }, 'Unhandled request error');
    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'A solicitação não pôde ser concluída.',
        requestId: request.id
      }
    });
  });

  app.addHook('onClose', async () => database.close());
  return app;
}
