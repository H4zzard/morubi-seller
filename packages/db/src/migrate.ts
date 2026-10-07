import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './database.js';

const connectionString = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_ADMIN_URL or DATABASE_URL is required');

const database = createDatabase(connectionString);
try {
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url))
  });
} finally {
  await database.close();
}
