import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { z } from 'zod';
import { isUniqueViolation, withTransaction } from '../lib/db.ts';
import { errorSchema, HttpError } from '../lib/errors.ts';
import { hashPassword, verifyDummyPassword, verifyPassword } from '../lib/password.ts';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_DAYS,
} from '../lib/tokens.ts';
import { USER_COLUMNS, type UserRow, toUser, userSchema } from '../lib/users.ts';

// Matches the CHECK constraint on app_user.username.
const username = z.string().regex(/^[A-Za-z0-9_]{3,32}$/, 'Use 3 to 32 letters, digits or underscores');
// Length only, per NIST: no character-type rules. The upper bound keeps hashing cheap.
const password = z.string().min(8).max(128);

const tokensSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().describe('Seconds until the access token expires'),
});

const sessionSchema = z.object({ user: userSchema, ...tokensSchema.shape });

// Login, registration and refresh are the routes worth brute-forcing, so they are limited per IP.
const rateLimit = { max: 10, timeWindow: '1 minute' };

async function insertRefreshToken(client: pg.Pool | pg.PoolClient, userId: string): Promise<{ id: string; token: string }> {
  const { token, hash } = generateRefreshToken();
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO refresh_token (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))
     RETURNING id`,
    [userId, hash, REFRESH_TOKEN_TTL_DAYS],
  );
  return { id: rows[0]!.id, token };
}

const authRoutes: FastifyPluginAsyncZod = async (app) => {
  async function tokensFor(userId: string, refreshToken: string) {
    return {
      accessToken: await app.accessTokens.sign(userId),
      refreshToken,
      tokenType: 'Bearer' as const,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  app.post(
    '/auth/register',
    {
      config: { rateLimit },
      schema: {
        tags: ['auth'],
        summary: 'Create an account and sign in',
        body: z.object({ username, email: z.email().max(254), password }),
        response: { 201: sessionSchema, 400: errorSchema, 409: errorSchema },
      },
    },
    async (request, reply) => {
      const { username, email, password } = request.body;
      const passwordHash = await hashPassword(password);

      try {
        const { user, refreshToken } = await withTransaction(app.db, async (client) => {
          const { rows } = await client.query<UserRow>(
            `INSERT INTO app_user (username, email, password_hash)
             VALUES ($1, $2, $3)
             RETURNING ${USER_COLUMNS}`,
            [username, email, passwordHash],
          );
          const user = toUser(rows[0]!);
          const { token } = await insertRefreshToken(client, user.id);
          return { user, refreshToken: token };
        });
        return reply.status(201).send({ user, ...(await tokensFor(user.id, refreshToken)) });
      } catch (err) {
        if (isUniqueViolation(err, 'app_user_username_key')) {
          throw new HttpError(409, 'USERNAME_TAKEN', 'That username is taken');
        }
        if (isUniqueViolation(err, 'app_user_email_key')) {
          throw new HttpError(409, 'EMAIL_TAKEN', 'An account with that email already exists');
        }
        throw err;
      }
    },
  );

  app.post(
    '/auth/login',
    {
      config: { rateLimit },
      schema: {
        tags: ['auth'],
        summary: 'Sign in with a username or email and a password',
        body: z.object({
          identifier: z.string().min(1).max(254).describe('Username or email'),
          password: z.string().min(1).max(128),
        }),
        response: { 200: sessionSchema, 400: errorSchema, 401: errorSchema },
      },
    },
    async (request) => {
      const { identifier, password } = request.body;

      // Usernames cannot contain "@" and emails must, so this matches at most one user.
      const { rows } = await app.db.query<UserRow & { password_hash: string }>(
        `SELECT ${USER_COLUMNS}, password_hash
         FROM app_user
         WHERE username = $1 OR email = $1`,
        [identifier],
      );
      const row = rows[0];
      const valid = row ? await verifyPassword(row.password_hash, password) : await verifyDummyPassword(password);
      if (!row || !valid) {
        throw new HttpError(401, 'INVALID_CREDENTIALS', 'Wrong username, email or password');
      }

      const { token } = await insertRefreshToken(app.db, row.id);
      return { user: toUser(row), ...(await tokensFor(row.id, token)) };
    },
  );

  app.post(
    '/auth/refresh',
    {
      config: { rateLimit },
      schema: {
        tags: ['auth'],
        summary: 'Trade a refresh token for a new token pair',
        description:
          'The refresh token is single use. Presenting one that was already used signs the user out on every device.',
        body: z.object({ refreshToken: z.string().min(1).max(128) }),
        response: { 200: tokensSchema, 400: errorSchema, 401: errorSchema },
      },
    },
    async (request) => {
      const result = await withTransaction(app.db, async (client) => {
        const { rows } = await client.query<{
          id: string;
          user_id: string;
          replaced_by_id: string | null;
          revoked_at: Date | null;
          expired: boolean;
        }>(
          `SELECT id, user_id, replaced_by_id, revoked_at, expires_at <= now() AS expired
           FROM refresh_token
           WHERE token_hash = $1
           FOR UPDATE`,
          [hashRefreshToken(request.body.refreshToken)],
        );
        const current = rows[0];
        if (!current) return { status: 'invalid' } as const;

        if (current.replaced_by_id) {
          // A rotated token came back, so it has probably been copied. Revoke every session for the user.
          await client.query(
            `UPDATE refresh_token SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
            [current.user_id],
          );
          return { status: 'reused', userId: current.user_id } as const;
        }
        if (current.revoked_at || current.expired) return { status: 'invalid' } as const;

        const next = await insertRefreshToken(client, current.user_id);
        await client.query(`UPDATE refresh_token SET replaced_by_id = $2, revoked_at = now() WHERE id = $1`, [
          current.id,
          next.id,
        ]);
        return { status: 'rotated', userId: current.user_id, refreshToken: next.token } as const;
      });

      if (result.status === 'reused') {
        request.log.warn({ userId: result.userId }, 'refresh token reused, revoked all sessions');
      }
      if (result.status !== 'rotated') {
        throw new HttpError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired; sign in again');
      }
      return tokensFor(result.userId, result.refreshToken);
    },
  );

  app.post(
    '/auth/logout',
    {
      schema: {
        tags: ['auth'],
        summary: 'Revoke a refresh token',
        description: 'Always succeeds, so it is safe to call with a token that is already invalid.',
        body: z.object({ refreshToken: z.string().min(1).max(128) }),
        response: { 204: z.null(), 400: errorSchema },
      },
    },
    async (request, reply) => {
      await app.db.query(`UPDATE refresh_token SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [
        hashRefreshToken(request.body.refreshToken),
      ]);
      return reply.status(204).send(null);
    },
  );
};

export default authRoutes;
