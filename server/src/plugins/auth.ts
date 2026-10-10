import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { HttpError } from '../lib/errors.ts';
import { type AccessTokens, createAccessTokens } from '../lib/tokens.ts';

export interface AuthUser {
  id: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    accessTokens: AccessTokens;
    // Use as `onRequest: app.authenticate` on routes that need a signed-in user.
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
  interface FastifyRequest {
    // Set only on routes that run `app.authenticate`.
    user: AuthUser;
  }
}

export interface AuthPluginOptions {
  jwtSecret: string;
}

export default fp<AuthPluginOptions>(
  async (app, { jwtSecret }) => {
    const accessTokens = createAccessTokens(jwtSecret);

    app.decorate('accessTokens', accessTokens);
    app.decorateRequest('user', null as unknown as AuthUser);

    app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
      const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
      if (scheme?.toLowerCase() !== 'bearer' || !token) {
        reply.header('www-authenticate', 'Bearer');
        throw new HttpError(401, 'MISSING_ACCESS_TOKEN', 'Send an access token as `Authorization: Bearer <token>`');
      }

      const result = await accessTokens.verify(token);
      if (!result.ok) {
        reply.header('www-authenticate', `Bearer error="invalid_token"`);
        // The app refreshes on ACCESS_TOKEN_EXPIRED and signs the user out on anything else.
        throw result.reason === 'expired'
          ? new HttpError(401, 'ACCESS_TOKEN_EXPIRED', 'Access token has expired')
          : new HttpError(401, 'INVALID_ACCESS_TOKEN', 'Access token is invalid');
      }

      request.user = { id: result.userId };
    });
  },
  { name: 'auth' },
);
