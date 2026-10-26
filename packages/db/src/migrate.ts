import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { createDatabase } from './database.js';

const connectionString = process.env.DATABASE_ADMIN_URL;
if (!connectionString) throw new Error('DATABASE_ADMIN_URL is required for migrations');

const database = createDatabase(connectionString);
try {
  await migrate(database.db, {
    migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url))
  });
} finally {
  await database.close();
}
