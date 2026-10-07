import { describe, expect, it } from 'vitest';
import { parseApiEnv, parseWorkerEnv } from './index.js';

const required = {
  DATABASE_URL: 'postgresql://localhost/morubi',
  BETTER_AUTH_SECRET: 'test-secret-with-at-least-thirty-two-characters',
  BETTER_AUTH_URL: 'http://localhost:4000',
  WEB_ORIGIN: 'http://localhost:3000'
};

describe('intelligence feature flag defaults', () => {
  it('enables intelligence only in non-production by default', () => {
    expect(parseApiEnv({ ...required, NODE_ENV: 'test' }).INTELLIGENCE_ENABLED).toBe(true);
    expect(parseApiEnv({ ...required, NODE_ENV: 'production' }).INTELLIGENCE_ENABLED).toBe(false);
  });

  it('starts in shadow with external providers and visibility disabled', () => {
    const env = parseApiEnv({ ...required, NODE_ENV: 'development' });
    expect(env).toMatchObject({
      JEV_ENABLED: false,
      SHADOW_MODE: true,
      INTERVENTIONS_VISIBLE: false,
      REALTIME_ENABLED: false,
      SELLER_FEEDBACK_ENABLED: false,
      GENERATIVE_AI_ENABLED: false,
      DEEPSEEK_ENABLED: false,
      INTELLIGENCE_DEV_UI: false,
      AUDIO_INTELLIGENCE_ENABLED: false,
      GEMINI_TRANSCRIPTION_ENABLED: false,
      LIVE_CALLS_ENABLED: false,
      MEET_DETECTION_ENABLED: false,
      ZOOM_DETECTION_ENABLED: false,
      LIVE_TRANSCRIPTION_ENABLED: false,
      LIVE_COPILOT_ENABLED: false,
      LIVE_GENERATION_ENABLED: false
    });
  });

  it('requires a provider key only when DeepSeek generation is enabled', () => {
    expect(
      parseWorkerEnv({ ...required, GENERATIVE_AI_ENABLED: 'false', DEEPSEEK_ENABLED: 'false' })
        .DEEPSEEK_API_KEY
    ).toBeUndefined();
    expect(() =>
      parseWorkerEnv({ ...required, GENERATIVE_AI_ENABLED: 'true', DEEPSEEK_ENABLED: 'true' })
    ).toThrow();
  });

  it('requires Gemini credentials only with external audio transcription enabled', () => {
    expect(
      parseWorkerEnv({
        ...required,
        AUDIO_INTELLIGENCE_ENABLED: 'true',
        GEMINI_TRANSCRIPTION_ENABLED: 'false'
      }).GEMINI_API_KEY
    ).toBeUndefined();
    expect(() =>
      parseWorkerEnv({
        ...required,
        AUDIO_INTELLIGENCE_ENABLED: 'true',
        GEMINI_TRANSCRIPTION_ENABLED: 'true'
      })
    ).toThrow();
  });
});
