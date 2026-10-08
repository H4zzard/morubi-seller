import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDatabase } from '@morubi/db';
import { loadApiTestEnvironment } from '../setup-env.js';
import { getTestDatabaseEnvironment } from './test-database-env.js';

interface RuntimeRole {
  currentUser: string;
  rolsuper: boolean;
  rolcreatedb: boolean;
  rolcreaterole: boolean;
  rolinherit: boolean;
  rolbypassrls: boolean;
}

async function validateRuntimeRole(
  connectionUrl: string,
  expectedRole: 'morubi_app' | 'morubi_auth'
): Promise<RuntimeRole> {
  const runtime = createDatabase(connectionUrl);
  try {
    const result = await runtime.pool.query<RuntimeRole>(
      `select
        current_user as "currentUser",
        rolsuper,
        rolcreatedb,
        rolcreaterole,
        rolinherit,
        rolbypassrls
      from pg_roles
      where rolname = current_user`
    );
    const role = result.rows[0];

    if (!role) throw new Error('Unable to resolve the PostgreSQL integration runtime role.');
    if (
      role.currentUser !== expectedRole ||
      role.rolsuper ||
      role.rolcreatedb ||
      role.rolcreaterole ||
      role.rolinherit ||
      role.rolbypassrls
    ) {
      throw new Error(
        'Unsafe PostgreSQL integration role: expected ' +
          `current_user=${expectedRole} and every elevated flag disabled; received ` +
          `current_user=${role.currentUser}, rolsuper=${role.rolsuper}, ` +
          `rolbypassrls=${role.rolbypassrls}`
      );
    }

    return role;
  } finally {
    await runtime.close();
  }
}

async function applyMigrations(adminUrl: string): Promise<void> {
  const admin = createDatabase(adminUrl);
  try {
    await migrate(admin.db, {
      migrationsFolder: fileURLToPath(new URL('../../../../packages/db/drizzle', import.meta.url))
    });
  } finally {
    await admin.close();
  }
}

export default async function globalSetup(): Promise<void> {
  loadApiTestEnvironment();
  const { adminUrl, runtimeUrl, authUrl } = getTestDatabaseEnvironment();
  const runtimeRole = await validateRuntimeRole(runtimeUrl, 'morubi_app');
  const authRole = await validateRuntimeRole(authUrl, 'morubi_auth');

  console.info(
    `[integration] runtime role verified: current_user=${runtimeRole.currentUser}, ` +
      `rolsuper=${runtimeRole.rolsuper}, rolbypassrls=${runtimeRole.rolbypassrls}`
  );
  console.info(
    `[integration] auth role verified: current_user=${authRole.currentUser}, ` +
      `rolsuper=${authRole.rolsuper}, rolbypassrls=${authRole.rolbypassrls}`
  );

  await applyMigrations(adminUrl);
}
