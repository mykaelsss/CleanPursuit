import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SignJWT } from 'jose';
import { buildApp } from '../src/app.ts';
import { fakePool, fakeStorage, testEnv as env } from './helpers.ts';

// These cases are rejected before any query runs, so they need no database.

const userId = '01990000-0000-7000-8000-000000000000';

function sign(secret: string, expiresAt: number) {
  return new SignJWT()
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer('cleanpursuit-api')
    .setAudience('cleanpursuit-app')
    .setIssuedAt(expiresAt - 900)
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(secret));
}

async function getMe(authorization?: string) {
  const app = await buildApp({ env, pool: fakePool(), storage: fakeStorage() });
  try {
    return await app.inject({ method: 'GET', url: '/me', headers: authorization ? { authorization } : {} });
  } finally {
    await app.close();
  }
}

test('GET /me without a token returns 401 MISSING_ACCESS_TOKEN', async () => {
  const res = await getMe();
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().code, 'MISSING_ACCESS_TOKEN');
  assert.equal(res.headers['www-authenticate'], 'Bearer');
});

test('GET /me with a garbage token returns 401 INVALID_ACCESS_TOKEN', async () => {
  const res = await getMe('Bearer not-a-jwt');
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().code, 'INVALID_ACCESS_TOKEN');
});

test('GET /me with a token signed by another secret returns 401 INVALID_ACCESS_TOKEN', async () => {
  const token = await sign('some-other-secret-that-is-long-enough', Math.floor(Date.now() / 1000) + 600);
  const res = await getMe(`Bearer ${token}`);
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().code, 'INVALID_ACCESS_TOKEN');
});

test('GET /me with an expired token returns 401 ACCESS_TOKEN_EXPIRED', async () => {
  const token = await sign(env.JWT_SECRET, Math.floor(Date.now() / 1000) - 60);
  const res = await getMe(`Bearer ${token}`);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.json(), {
    statusCode: 401,
    code: 'ACCESS_TOKEN_EXPIRED',
    error: 'Unauthorized',
    message: 'Access token has expired',
  });
});

test('login is rate limited per IP', async (t) => {
  const app = await buildApp({ env, pool: fakePool(), storage: fakeStorage() });
  t.after(() => app.close());

  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) {
    const res = await app.inject({ method: 'POST', url: '/auth/login', payload: {} });
    statuses.push(res.statusCode);
  }

  assert.deepEqual(statuses, [...Array(10).fill(400), 429]);
});
