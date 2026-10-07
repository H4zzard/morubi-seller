import { createAuthClient } from 'better-auth/react';
import { webEnv } from './env';

export const authClient = createAuthClient({ baseURL: webEnv.NEXT_PUBLIC_API_URL });
