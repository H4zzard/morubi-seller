import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq, inArray } from 'drizzle-orm';
import type { ApiEnv } from '@morubi/config';
import {
  MembershipRepository,
  auditLogs,
  createDatabase,
  memberships,
  organizations,
  resolveTenantContext,
  user,
  type DatabaseHandle
} from '@morubi/db';
import { buildApp } from '../../src/app.js';
import { getTestDatabaseEnvironment } from './test-database-env.js';

const { adminUrl, runtimeUrl } = getTestDatabaseEnvironment();

describe('critical tenant boundary', () => {
  const userAId = `user-a-${randomUUID()}`;
  const userBId = `user-b-${randomUUID()}`;
  const userCId = `user-c-${randomUUID()}`;
  const organizationAId = randomUUID();
  const organizationBId = randomUUID();
  let admin: DatabaseHandle;
  let runtime: DatabaseHandle;

  beforeAll(async () => {
    admin = createDatabase(adminUrl);
    runtime = createDatabase(runtimeUrl);
    await admin.db.insert(user).values([
      { id: userAId, name: 'User A', email: `${userAId}@example.test` },
      { id: userBId, name: 'User B', email: `${userBId}@example.test` },
      { id: userCId, name: 'User C', email: `${userCId}@example.test` }
    ]);
    await admin.db.insert(organizations).values([
      { id: organizationAId, name: 'Organization A', slug: `org-a-${organizationAId}` },
      { id: organizationBId, name: 'Organization B', slug: `org-b-${organizationBId}` }
    ]);
    await admin.db.insert(memberships).values([
      { organizationId: organizationAId, userId: userAId, role: 'OWNER' },
      { organizationId: organizationBId, userId: userBId, role: 'OWNER' }
    ]);
  });

  afterAll(async () => {
    await admin.db
      .delete(auditLogs)
      .where(inArray(auditLogs.organizationId, [organizationAId, organizationBId]));
    await admin.db
      .delete(organizations)
      .where(inArray(organizations.id, [organizationAId, organizationBId]));
    await admin.db.delete(user).where(inArray(user.id, [userAId, userBId, userCId]));
    await runtime.close();
    await admin.close();
  });

  it('runtime scoped to A never returns memberships from B', async () => {
    const client = await runtime.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('app.current_user_id', $1, true), set_config('app.current_organization_id', $2, true)",
        [userAId, organizationAId]
      );
      const result = await client.query<{ organization_id: string }>(
        'select organization_id from memberships order by organization_id'
      );
      expect(result.rows).toEqual([{ organization_id: organizationAId }]);
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('RLS blocks a direct read and write from A into B', async () => {
    const client = await runtime.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('app.current_user_id', $1, true), set_config('app.current_organization_id', $2, true)",
        [userAId, organizationAId]
      );
      const result = await client.query('select id from memberships where organization_id = $1', [
        organizationBId
      ]);
      expect(result.rowCount).toBe(0);
      await expect(
        client.query(
          "insert into memberships (organization_id, user_id, role) values ($1, $2, 'SELLER')",
          [organizationBId, userAId]
        )
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('keeps audit records append-only for the runtime role', async () => {
    const client = await runtime.pool.connect();
    try {
      await client.query('begin');
      await client.query(
        "select set_config('app.current_user_id', $1, true), set_config('app.current_organization_id', $2, true)",
        [userAId, organizationAId]
      );
      await client.query(
        "insert into audit_logs (organization_id, actor_user_id, action, resource_type, resource_id) values ($1, $2, 'user.login', 'session', $2)",
        [organizationAId, userAId]
      );
      await expect(
        client.query('delete from audit_logs where organization_id = $1', [organizationAId])
      ).rejects.toMatchObject({ code: '42501' });
      await client.query('rollback');
    } finally {
      client.release();
    }
  });

  it('keeps one owner when two owners are demoted concurrently', async () => {
    const [ownerA] = await admin.db
      .select()
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationAId), eq(memberships.userId, userAId)))
      .limit(1);
    const [ownerC] = await admin.db
      .insert(memberships)
      .values({ organizationId: organizationAId, userId: userCId, role: 'OWNER' })
      .returning();
    const contextA = await resolveTenantContext(runtime.db, userAId, organizationAId);
    const contextC = await resolveTenantContext(runtime.db, userCId, organizationAId);
    if (!ownerA || !ownerC || !contextA || !contextC) throw new Error('Owner test setup failed');

    const results = await Promise.allSettled([
      new MembershipRepository(runtime.db, contextA).updateRole(ownerA.id, 'ADMIN'),
      new MembershipRepository(runtime.db, contextC).updateRole(ownerC.id, 'ADMIN')
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const [remaining] = await admin.db
      .select({ value: count() })
      .from(memberships)
      .where(and(eq(memberships.organizationId, organizationAId), eq(memberships.role, 'OWNER')));
    expect(remaining?.value).toBe(1);
  });

  it('API returns a safe not found when User A selects Organization B', async () => {
    const apiDatabase = createDatabase(runtimeUrl);
    const env: ApiEnv = {
      NODE_ENV: 'test',
      API_HOST: '127.0.0.1',
      API_PORT: 4000,
      DATABASE_URL: runtimeUrl,
      AUTH_DATABASE_URL: runtimeUrl,
      BETTER_AUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters',
      BETTER_AUTH_URL: 'http://localhost:4000',
      WEB_ORIGIN: 'http://localhost:3000',
      DESKTOP_DEV_ORIGIN: 'http://localhost:5173',
      DESKTOP_APP_ORIGIN: 'morubi-app://app',
      LOG_LEVEL: 'silent',
      TRUST_PROXY: false,
      INTELLIGENCE_ENABLED: true,
      JEV_ENABLED: false,
      SHADOW_MODE: true,
      INTERVENTIONS_VISIBLE: false,
      INTELLIGENCE_DEV_UI: true,
      REALTIME_ENABLED: true,
      SELLER_FEEDBACK_ENABLED: true,
      GENERATIVE_AI_ENABLED: false,
      DEEPSEEK_ENABLED: false,
      AUDIO_INTELLIGENCE_ENABLED: false,
      GEMINI_TRANSCRIPTION_ENABLED: false,
      LIVE_CALLS_ENABLED: false,
      MEET_DETECTION_ENABLED: false,
      ZOOM_DETECTION_ENABLED: false,
      LIVE_TRANSCRIPTION_ENABLED: false,
      LIVE_COPILOT_ENABLED: false,
      LIVE_GENERATION_ENABLED: false,
      POST_CALL_INTELLIGENCE_ENABLED: false,
      LIVE_TRANSCRIPTION_COST_MICROS_PER_MINUTE: 0,
      AUDIO_STORAGE_ROOT: '.data/audio-test',
      AUDIO_MAX_BYTES: 20_971_520,
      AUDIO_RETENTION_DAYS: 30
    };
    const app = await buildApp({
      database: apiDatabase,
      env,
      sessionResolver: {
        resolve: () =>
          Promise.resolve({ id: userAId, name: 'User A', email: `${userAId}@example.test` })
      }
    });
    const response = await app.inject({
      method: 'GET',
      url: '/v1/organizations/current',
      headers: { 'x-organization-id': organizationBId }
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
    expect(response.body).not.toContain('Organization B');
    await app.close();
  });
});
