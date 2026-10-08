import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { eq, inArray } from 'drizzle-orm';
import type { UserDto } from '@morubi/contracts';
import type { MorubiDatabase } from '@morubi/db';
import * as schema from '@morubi/db/schema';

export interface MorubiAuthOptions {
  baseURL: string;
  secret: string;
  trustedOrigins: string[];
}

export interface AuthUserDirectory {
  findByEmail(email: string): Promise<UserDto | null>;
  findByIds(ids: string[]): Promise<UserDto[]>;
}

export function createAuthUserDirectory(database: MorubiDatabase): AuthUserDirectory {
  const toDto = (row: typeof schema.user.$inferSelect): UserDto => ({
    id: row.id,
    name: row.name,
    email: row.email
  });
  return {
    async findByEmail(email) {
      const [found] = await database
        .select()
        .from(schema.user)
        .where(eq(schema.user.email, email))
        .limit(1);
      return found ? toDto(found) : null;
    },
    async findByIds(ids) {
      if (ids.length === 0) return [];
      const rows = await database.select().from(schema.user).where(inArray(schema.user.id, ids));
      return rows.map(toDto);
    }
  };
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
