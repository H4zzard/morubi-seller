import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

const { Pool } = pg;

export type MorubiDatabase = NodePgDatabase<typeof schema>;

export interface DatabaseHandle {
  db: MorubiDatabase;
  pool: pg.Pool;
  close(): Promise<void>;
}

export function createDatabase(connectionString: string): DatabaseHandle {
  const pool = new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
  const db = drizzle(pool, { schema });
  return {
    db,
    pool,
    close: async () => pool.end()
  };
}
