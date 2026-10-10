import { createHash, randomBytes } from 'node:crypto';
import { errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;

const ISSUER = 'cleanpursuit-api';
const AUDIENCE = 'cleanpursuit-app';

export type AccessTokenResult =
  | { ok: true; userId: string }
  | { ok: false; reason: 'expired' | 'invalid' };

// Signs and checks short-lived HS256 access tokens. Only this API creates and checks them,
// so a shared secret is enough; the algorithm is pinned so tokens claiming another one are rejected.
export function createAccessTokens(secret: string) {
  const key = new TextEncoder().encode(secret);

  return {
    sign(userId: string): Promise<string> {
      return new SignJWT()
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setIssuedAt()
        .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
        .sign(key);
    },

    async verify(token: string): Promise<AccessTokenResult> {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          issuer: ISSUER,
          audience: AUDIENCE,
          requiredClaims: ['sub', 'iat', 'exp'],
        });
        const userId = z.uuid().safeParse(payload.sub);
        return userId.success ? { ok: true, userId: userId.data } : { ok: false, reason: 'invalid' };
      } catch (err) {
        return { ok: false, reason: err instanceof errors.JWTExpired ? 'expired' : 'invalid' };
      }
    },
  };
}

export type AccessTokens = ReturnType<typeof createAccessTokens>;

// Refresh tokens are opaque random strings. Only a SHA-256 hash is stored, which is safe
// because the token is 256 random bits, unlike a password.
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
