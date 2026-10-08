import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'dotenv';
import pg from 'pg';

const { Client } = pg;
const workspaceDirectory = resolve(import.meta.dirname, '../../..');
const apiEnvironmentPath = resolve(workspaceDirectory, 'apps/api/.env');
const roleName = 'morubi_auth';

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function requireValue(environment, names) {
  for (const name of names) {
    const value = environment[name]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing required database configuration: ${names.join(' or ')}`);
}

function authConnectionUrl(source, password) {
  const url = new URL(source);
  const username = decodeURIComponent(url.username);
  const suffixIndex = username.indexOf('.');
  const suffix = suffixIndex === -1 ? '' : username.slice(suffixIndex);
  url.username = `${roleName}${suffix}`;
  url.password = password;
  return url.toString();
}

function setEnvironmentValue(source, name, value) {
  const line = `${name}=${value}`;
  const expression = new RegExp(`^${name}=.*$`, 'm');
  if (expression.test(source)) return source.replace(expression, line);
  const separator = source.endsWith('\n') ? '' : '\n';
  return `${source}${separator}${line}\n`;
}

const source = await readFile(apiEnvironmentPath, 'utf8');
const environment = { ...parse(source), ...process.env };
const adminUrl = requireValue(environment, ['TEST_DATABASE_ADMIN_URL', 'DATABASE_ADMIN_URL']);
const runtimeUrl = requireValue(environment, ['DATABASE_URL']);
const testRuntimeUrl = requireValue(environment, ['TEST_DATABASE_URL', 'DATABASE_URL']);
const password = randomBytes(48).toString('base64url');
const authUrl = authConnectionUrl(runtimeUrl, password);
const testAuthUrl = authConnectionUrl(testRuntimeUrl, password);

const admin = new Client({ connectionString: adminUrl });
await admin.connect();
try {
  await admin.query(`
    DO $role$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${roleName}') THEN
        CREATE ROLE ${quoteIdentifier(roleName)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
      END IF;
    END
    $role$;
  `);
  await admin.query(`ALTER ROLE ${quoteIdentifier(roleName)} NOINHERIT`);
  await admin.query(
    `ALTER ROLE ${quoteIdentifier(roleName)} WITH LOGIN PASSWORD ${quoteLiteral(password)}`
  );
  const flags = await admin.query(`
    select rolcanlogin, rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolbypassrls
    from pg_roles
    where rolname = '${roleName}'
  `);
  const role = flags.rows[0];
  if (
    !role?.rolcanlogin ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolinherit ||
    role.rolbypassrls
  ) {
    throw new Error('The dedicated authentication role has unsafe PostgreSQL flags.');
  }
  const database = await admin.query('select current_database() as name');
  const databaseName = database.rows[0]?.name;
  if (!databaseName) throw new Error('Unable to resolve the target database.');
  await admin.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(roleName)}`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(roleName)}`);
} finally {
  await admin.end();
}

const verification = new Client({ connectionString: testAuthUrl });
await verification.connect();
try {
  const result = await verification.query(`
    select current_user as "currentUser", rolsuper, rolcreatedb, rolcreaterole,
      rolinherit, rolbypassrls
    from pg_roles
    where rolname = current_user
  `);
  const role = result.rows[0];
  if (
    role?.currentUser !== roleName ||
    role.rolsuper ||
    role.rolcreatedb ||
    role.rolcreaterole ||
    role.rolinherit ||
    role.rolbypassrls
  ) {
    throw new Error('The dedicated authentication role failed its security preflight.');
  }
} finally {
  await verification.end();
}

let updatedSource = setEnvironmentValue(source, 'AUTH_DATABASE_URL', authUrl);
updatedSource = setEnvironmentValue(updatedSource, 'TEST_AUTH_DATABASE_URL', testAuthUrl);
await writeFile(apiEnvironmentPath, updatedSource, { encoding: 'utf8', mode: 0o600 });

console.info('Authentication role configured and security flags verified.');
