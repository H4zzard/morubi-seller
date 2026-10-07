import 'dotenv/config';
import { createMorubiAuth } from '@morubi/auth';
import { parseApiEnv } from '@morubi/config';
import { createDatabase } from '@morubi/db';
import { buildApp } from './app.js';

const env = parseApiEnv(process.env);
const database = createDatabase(env.DATABASE_URL);
const auth = createMorubiAuth(database.db, {
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN, env.DESKTOP_DEV_ORIGIN]
});
const app = await buildApp({ database, auth, env });

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'API failed to start');
  await app.close();
  process.exitCode = 1;
}
