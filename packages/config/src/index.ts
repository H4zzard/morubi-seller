import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .default(false);

const optionalBooleanFromString = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().default('127.0.0.1'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.url(),
    AUTH_DATABASE_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url(),
    WEB_ORIGIN: z.url(),
    DESKTOP_DEV_ORIGIN: z.url().default('http://localhost:5173'),
    DESKTOP_APP_ORIGIN: z.string().min(1).default('morubi-app://app'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    TRUST_PROXY: booleanFromString,
    INTELLIGENCE_ENABLED: optionalBooleanFromString,
    JEV_ENABLED: booleanFromString,
    SHADOW_MODE: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(true),
    INTERVENTIONS_VISIBLE: booleanFromString,
    INTELLIGENCE_DEV_UI: booleanFromString,
    REALTIME_ENABLED: booleanFromString,
    SELLER_FEEDBACK_ENABLED: booleanFromString,
    GENERATIVE_AI_ENABLED: booleanFromString,
    DEEPSEEK_ENABLED: booleanFromString,
    AUDIO_INTELLIGENCE_ENABLED: booleanFromString,
    GEMINI_TRANSCRIPTION_ENABLED: booleanFromString,
    LIVE_CALLS_ENABLED: booleanFromString,
    MEET_DETECTION_ENABLED: booleanFromString,
    ZOOM_DETECTION_ENABLED: booleanFromString,
    LIVE_TRANSCRIPTION_ENABLED: booleanFromString,
    LIVE_COPILOT_ENABLED: booleanFromString,
    LIVE_GENERATION_ENABLED: booleanFromString,
    POST_CALL_INTELLIGENCE_ENABLED: booleanFromString,
    LIVE_TRANSCRIPTION_COST_MICROS_PER_MINUTE: z.coerce
      .number()
      .int()
      .min(0)
      .max(Number.MAX_SAFE_INTEGER)
      .default(0),
    AUDIO_STORAGE_ROOT: z.string().min(1).default('.data/audio'),
    AUDIO_MAX_BYTES: z.coerce.number().int().min(1024).max(104_857_600).default(20_971_520),
    AUDIO_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30)
  })
  .transform((value) => ({
    ...value,
    INTELLIGENCE_ENABLED: value.INTELLIGENCE_ENABLED ?? value.NODE_ENV !== 'production'
  }));

export const webEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
  NEXT_PUBLIC_INTELLIGENCE_DEV_UI: booleanFromString
});

export const desktopEnvSchema = z.object({
  MORUBI_API_URL: z.url().default('http://localhost:4000'),
  MORUBI_DESKTOP_ORIGIN: z.string().min(1).optional(),
  MORUBI_USER_DATA_DIR: z.string().min(1).optional(),
  MORUBI_LIVE_CAPTURE_ENABLED: booleanFromString
});

const bigintFromString = z
  .string()
  .regex(/^\d+$/)
  .transform((value) => BigInt(value));

export const workerEnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DATABASE_URL: z.url(),
    DATABASE_ADMIN_URL: z.url().optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    INTELLIGENCE_ENABLED: optionalBooleanFromString,
    SHADOW_MODE: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .default(true),
    INTERVENTIONS_VISIBLE: booleanFromString,
    REALTIME_ENABLED: booleanFromString,
    SELLER_FEEDBACK_ENABLED: booleanFromString,
    GENERATIVE_AI_ENABLED: booleanFromString,
    DEEPSEEK_ENABLED: booleanFromString,
    DEEPSEEK_API_KEY: z.string().min(1).optional(),
    DEEPSEEK_BASE_URL: z.url().default('https://api.deepseek.com'),
    DEEPSEEK_FAST_MODEL: z.string().min(1).default('deepseek-flash'),
    DEEPSEEK_REASONING_MODEL: z.string().min(1).default('deepseek-v4-pro'),
    DEEPSEEK_FAST_TIMEOUT_MS: z.coerce.number().int().min(250).max(60_000).default(4_000),
    DEEPSEEK_REASONING_TIMEOUT_MS: z.coerce.number().int().min(250).max(120_000).default(12_000),
    DEEPSEEK_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(64).max(4_096).default(512),
    DEEPSEEK_INPUT_COST_MICROS_PER_MILLION_TOKENS: bigintFromString.default(0n),
    DEEPSEEK_OUTPUT_COST_MICROS_PER_MILLION_TOKENS: bigintFromString.default(0n),
    AUDIO_INTELLIGENCE_ENABLED: booleanFromString,
    GEMINI_TRANSCRIPTION_ENABLED: booleanFromString,
    GEMINI_API_KEY: z.string().min(1).optional(),
    GEMINI_BASE_URL: z.url().default('https://generativelanguage.googleapis.com'),
    GEMINI_TRANSCRIPTION_MODEL: z.string().min(1).default('gemini-3.5-transcribe'),
    GEMINI_TRANSCRIPTION_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(180_000)
      .default(60_000),
    GEMINI_TRANSCRIPTION_INPUT_COST_MICROS_PER_MILLION_TOKENS: bigintFromString.default(0n),
    GEMINI_TRANSCRIPTION_OUTPUT_COST_MICROS_PER_MILLION_TOKENS: bigintFromString.default(0n),
    GEMINI_TRANSCRIPTION_AUDIO_COST_MICROS_PER_MINUTE: bigintFromString.default(0n),
    AUDIO_STORAGE_ROOT: z.string().min(1).default('.data/audio'),
    AUDIO_MAX_BYTES: z.coerce.number().int().min(1024).max(104_857_600).default(20_971_520),
    AUDIO_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
    LIVE_CALLS_ENABLED: booleanFromString,
    MEET_DETECTION_ENABLED: booleanFromString,
    ZOOM_DETECTION_ENABLED: booleanFromString,
    LIVE_TRANSCRIPTION_ENABLED: booleanFromString,
    LIVE_COPILOT_ENABLED: booleanFromString,
    LIVE_GENERATION_ENABLED: booleanFromString,
    POST_CALL_INTELLIGENCE_ENABLED: booleanFromString,
    POST_CALL_PROVIDER: z.enum(['fixture', 'deepseek']).default('fixture'),
    POST_CALL_MAX_SEGMENT_CHARACTERS: z.coerce.number().int().min(1000).max(50000).default(12000),
    POST_CALL_MAX_OUTPUT_CHARACTERS: z.coerce.number().int().min(1000).max(50000).default(16000),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(500),
    WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(25)
  })
  .superRefine((value, context) => {
    if (value.GENERATIVE_AI_ENABLED && value.DEEPSEEK_ENABLED && !value.DEEPSEEK_API_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['DEEPSEEK_API_KEY'],
        message: 'DEEPSEEK_API_KEY is required when DeepSeek generation is enabled.'
      });
    }
    if (
      value.POST_CALL_INTELLIGENCE_ENABLED &&
      value.POST_CALL_PROVIDER === 'deepseek' &&
      (!value.DEEPSEEK_ENABLED || !value.DEEPSEEK_API_KEY)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['POST_CALL_PROVIDER'],
        message: 'DeepSeek and its API key are required for the deepseek post-call provider.'
      });
    }
    if (
      value.AUDIO_INTELLIGENCE_ENABLED &&
      value.GEMINI_TRANSCRIPTION_ENABLED &&
      !value.GEMINI_API_KEY
    ) {
      context.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'GEMINI_API_KEY is required when Gemini transcription is enabled.'
      });
    }
  })
  .transform((value) => ({
    ...value,
    INTELLIGENCE_ENABLED: value.INTELLIGENCE_ENABLED ?? value.NODE_ENV !== 'production'
  }));

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WebEnv = z.infer<typeof webEnvSchema>;
export type DesktopEnv = z.infer<typeof desktopEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export function parseApiEnv(environment: NodeJS.ProcessEnv): ApiEnv {
  return apiEnvSchema.parse(environment);
}

export function parseWebEnv(environment: Record<string, string | undefined>): WebEnv {
  return webEnvSchema.parse(environment);
}

export function parseDesktopEnv(environment: Record<string, string | undefined>): DesktopEnv {
  return desktopEnvSchema.parse(environment);
}

export function parseWorkerEnv(environment: NodeJS.ProcessEnv): WorkerEnv {
  return workerEnvSchema.parse(environment);
}
