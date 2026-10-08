import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMorubiAuth } from '@morubi/auth';
import { parseApiEnv } from '@morubi/config';
import { createDatabase, type DatabaseHandle } from '@morubi/db';
import { buildApp } from '../../src/app.js';
import { getTestDatabaseEnvironment } from './test-database-env.js';

const { adminUrl, runtimeUrl, authUrl } = getTestDatabaseEnvironment();

function responseCookie(value: string | string[] | undefined): string {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.map((cookie) => cookie.split(';', 1)[0]).join('; ');
}

describe('Better Auth role and RLS boundary', () => {
  const suffix = randomUUID();
  const email = `auth-${suffix}@example.test`;
  const password = `Valid-${suffix}`;
  const slug = `auth-${suffix}`;
  let admin: DatabaseHandle;
  let runtime: DatabaseHandle;
  let authDatabase: DatabaseHandle;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    admin = createDatabase(adminUrl);
    runtime = createDatabase(runtimeUrl);
    authDatabase = createDatabase(authUrl);
    const env = parseApiEnv({
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: runtimeUrl,
      AUTH_DATABASE_URL: authUrl,
      BETTER_AUTH_SECRET: 'integration-secret-with-at-least-thirty-two-characters',
      BETTER_AUTH_URL: 'http://localhost:4000',
      WEB_ORIGIN: 'http://localhost:3000',
      DESKTOP_DEV_ORIGIN: 'http://localhost:5173',
      DESKTOP_APP_ORIGIN: 'morubi-app://app',
      LOG_LEVEL: 'silent'
    });
    const auth = createMorubiAuth(authDatabase.db, {
      baseURL: env.BETTER_AUTH_URL,
      secret: env.BETTER_AUTH_SECRET,
      trustedOrigins: [env.WEB_ORIGIN, env.DESKTOP_DEV_ORIGIN]
    });
    app = await buildApp({ database: runtime, auth, env });
  });

  afterAll(async () => {
    await admin.pool.query('delete from users where email = $1', [email]);
    await app.close();
    await authDatabase.close();
    await admin.close();
  });

  it('forces RLS and exposes auth-table policies only to morubi_auth', async () => {
    const tables = await admin.pool.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      select relname, relrowsecurity, relforcerowsecurity
      from pg_class
      where relnamespace = 'public'::regnamespace
        and relname = any(array['users', 'accounts', 'sessions', 'verifications'])
      order by relname
    `);
    expect(tables.rows).toHaveLength(4);
    expect(tables.rows.every((row) => row.relrowsecurity && row.relforcerowsecurity)).toBe(true);

    const policies = await admin.pool.query<{ tablename: string; roles: string }>(`
      select tablename, roles::text as roles
      from pg_policies
      where schemaname = 'public'
        and tablename = any(array['users', 'accounts', 'sessions', 'verifications'])
    `);
    expect(policies.rows).toHaveLength(4);
    expect(policies.rows.every((policy) => policy.roles === '{morubi_auth}')).toBe(true);
  });

  it('denies cross-boundary table access for both runtime roles', async () => {
    await expect(runtime.pool.query('select id from users limit 1')).rejects.toMatchObject({
      code: '42501'
    });
    await expect(authDatabase.pool.query('select id from deals limit 1')).rejects.toMatchObject({
      code: '42501'
    });
    await expect(
      authDatabase.pool.query('select id from commercial_events limit 1')
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      authDatabase.pool.query('select id from live_call_sessions limit 1')
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('supports signup, web login, onboarding, session persistence and logout', async () => {
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: 'http://localhost:3000' },
      payload: { name: 'Auth Integration', email, password }
    });
    expect(signup.statusCode).toBe(200);
    const created = await authDatabase.pool.query<{ id: string }>(
      'select id from users where email = $1',
      [email]
    );
    expect(created.rows).toHaveLength(1);
    const userId = created.rows[0]?.id;
    const credentials = await authDatabase.pool.query(
      'select id from accounts where user_id = $1',
      [userId]
    );
    const signupSessions = await authDatabase.pool.query(
      'select id from sessions where user_id = $1',
      [userId]
    );
    expect(credentials.rows).toHaveLength(1);
    expect(signupSessions.rows.length).toBeGreaterThanOrEqual(1);

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: 'http://localhost:3000' },
      payload: { email, password: 'wrong-password' }
    });
    expect(wrongPassword.statusCode).toBe(401);

    const webLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: 'http://localhost:3000' },
      payload: { email, password }
    });
    expect(webLogin.statusCode).toBe(200);
    const cookie = responseCookie(webLogin.headers['set-cookie']);
    expect(cookie).not.toBe('');

    const betterAuthSession = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { cookie }
    });
    expect(betterAuthSession.statusCode).toBe(200);
    expect(betterAuthSession.json()).toMatchObject({ user: { email } });

    const organization = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      headers: { cookie, 'content-type': 'application/json' },
      payload: { name: 'Auth Integration', slug }
    });
    expect(organization.statusCode).toBe(201);
    const organizationId = organization.json<{ organization: { id: string } }>().organization.id;

    const session = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie, 'x-organization-id': organizationId }
    });
    expect(session.statusCode).toBe(200);
    expect(session.json()).toMatchObject({ tenant: { organizationId } });

    const desktopLogin = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: 'http://localhost:5173' },
      payload: { email, password }
    });
    expect(desktopLogin.statusCode).toBe(200);

    const missingOrigin = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email, password }
    });
    expect(missingOrigin.statusCode).toBe(403);

    const untrustedOrigin = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: 'https://untrusted.example' },
      payload: { email, password }
    });
    expect(untrustedOrigin.statusCode).toBe(403);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie, origin: 'http://localhost:3000' }
    });
    expect(logout.statusCode).toBe(200);

    const afterLogout = await app.inject({
      method: 'GET',
      url: '/v1/auth/session',
      headers: { cookie }
    });
    expect(afterLogout.statusCode).toBe(401);
  });
});
