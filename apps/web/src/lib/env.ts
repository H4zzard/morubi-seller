import { parseWebEnv } from '@morubi/config';

export const webEnv = parseWebEnv({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_INTELLIGENCE_DEV_UI: process.env.NEXT_PUBLIC_INTELLIGENCE_DEV_UI
});
