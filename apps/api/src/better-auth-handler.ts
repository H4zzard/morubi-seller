import type { FastifyInstance } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { MorubiAuth } from '@morubi/auth';
import type { ApiEnv } from '@morubi/config';
import type { UserDto } from '@morubi/contracts';
import type { SessionResolver } from './types.js';

export function trustedAuthOrigins(
  env: Pick<ApiEnv, 'NODE_ENV' | 'WEB_ORIGIN' | 'DESKTOP_DEV_ORIGIN' | 'DESKTOP_APP_ORIGIN'>
): [string, string] {
  return [
    env.WEB_ORIGIN,
    env.NODE_ENV === 'production' ? env.DESKTOP_APP_ORIGIN : env.DESKTOP_DEV_ORIGIN
  ];
}

function copyResponseHeaders(
  response: Response,
  setHeader: (key: string, value: string | string[]) => void
) {
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== 'set-cookie') setHeader(key, value);
  });
  const getSetCookie = Reflect.get(response.headers, 'getSetCookie');
  if (typeof getSetCookie === 'function') {
    const reflected: unknown = Reflect.apply(getSetCookie, response.headers, []);
    if (
      Array.isArray(reflected) &&
      reflected.every((cookie): cookie is string => typeof cookie === 'string') &&
      reflected.length > 0
    ) {
      setHeader('set-cookie', reflected);
    }
  } else {
    const cookie = response.headers.get('set-cookie');
    if (cookie) setHeader('set-cookie', cookie);
  }
}

export function sessionResolverFromAuth(auth: MorubiAuth): SessionResolver {
  return {
    async resolve(headers) {
      const session = await auth.api.getSession({ headers });
      if (!session) return null;
      return {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email
      } satisfies UserDto;
    }
  };
}

export function registerBetterAuthRoutes(
  app: FastifyInstance,
  auth: MorubiAuth,
  baseUrl: string,
  trustedOrigins: readonly string[]
): void {
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      if (request.method !== 'GET') {
        const origin = request.headers.origin;
        if (typeof origin !== 'string' || !trustedOrigins.includes(origin)) {
          return reply.status(403).send({
            code: origin ? 'UNTRUSTED_ORIGIN' : 'MISSING_OR_NULL_ORIGIN',
            message: 'Origin validation failed'
          });
        }
      }
      const url = new URL(request.url, baseUrl);
      const headers = fromNodeHeaders(request.headers);
      const body = request.body === undefined ? undefined : JSON.stringify(request.body);
      const authRequest = new Request(url, {
        method: request.method,
        headers,
        ...(body === undefined ? {} : { body })
      });
      const response = await auth.handler(authRequest);
      copyResponseHeaders(response, (key, value) => {
        reply.header(key, value);
      });
      reply.status(response.status);
      const responseBody = response.body ? await response.text() : null;
      return reply.send(responseBody);
    }
  });
}
