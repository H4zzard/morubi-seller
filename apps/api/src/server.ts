import 'dotenv/config';
import { createAuthUserDirectory, createMorubiAuth } from '@morubi/auth';
import { GeminiRealtimeTranscriptionProvider } from '@morubi/ai';
import { parseApiEnv } from '@morubi/config';
import { createDatabase } from '@morubi/db';
import { buildApp } from './app.js';
import { trustedAuthOrigins } from './better-auth-handler.js';

const env = parseApiEnv(process.env);
const database = createDatabase(env.DATABASE_URL);
const authDatabase = createDatabase(env.AUTH_DATABASE_URL);
const auth = createMorubiAuth(authDatabase.db, {
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: trustedAuthOrigins(env)
});
const realtimeTranscriptionProvider =
  env.LIVE_TRANSCRIPTION_ENABLED && env.GEMINI_TRANSCRIPTION_ENABLED && env.GEMINI_API_KEY
    ? new GeminiRealtimeTranscriptionProvider({
        apiKey: env.GEMINI_API_KEY,
        baseUrl: env.GEMINI_BASE_URL,
        model: env.GEMINI_LIVE_TRANSCRIPTION_MODEL,
        language: 'pt-BR',
        connectTimeoutMs: env.GEMINI_LIVE_CONNECT_TIMEOUT_MS,
        sessionRenewalMs: env.GEMINI_LIVE_SESSION_RENEWAL_MS,
        configVersion: 'gemini-live-transcription-v1'
      })
    : undefined;
const app = await buildApp({
  database,
  auth,
  authUserDirectory: createAuthUserDirectory(authDatabase.db),
  ...(realtimeTranscriptionProvider ? { realtimeTranscriptionProvider } : {}),
  env
});
app.addHook('onClose', async () => authDatabase.close());

try {
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
} catch (error) {
  app.log.fatal({ err: error }, 'API failed to start');
  await app.close();
  process.exitCode = 1;
}
