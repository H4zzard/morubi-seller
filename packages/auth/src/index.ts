import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import type { MorubiDatabase } from '@morubi/db';
import * as schema from '@morubi/db/schema';

export interface MorubiAuthOptions {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
}

export function createMorubiAuth(database: MorubiDatabase, options: MorubiAuthOptions) {
  return betterAuth({
    appName: 'Morubi',
    baseURL: options.baseURL,
    secret: options.secret,
    trustedOrigins: options.trustedOrigins,
    database: drizzleAdapter(database, {
      provider: 'pg',
      schema
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 128
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      preserveSessionInDatabase: true
    },
    advanced: {
      cookiePrefix: 'morubi',
      useSecureCookies: process.env.NODE_ENV === 'production'
    }
  });
}

export type MorubiAuth = ReturnType<typeof createMorubiAuth>;
