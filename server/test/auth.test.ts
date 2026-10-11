import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/lib/db.ts';
import { fakeAnalyzer, fakeStorage, testEnv as env } from './helpers.ts';

// These tests run against the real database and clean up the users they create.
// Run them with `infisical run -- npm test`; without DATABASE_URL they are skipped.
const skip = process.env.DATABASE_URL ? false : 'needs DATABASE_URL; run with `infisical run -- npm test`';

const createdUsernames: string[] = [];

function newUser() {
  const username = `test_${randomBytes(6).toString('hex')}`;
  createdUsernames.push(username);
  return { username, email: `${username}@example.com`, password: 'correct horse battery staple' };
}

async function startApp(t: { after: (fn: () => Promise<unknown>) => void }) {
  const app = await buildApp({ env, pool: createPool(env.DATABASE_URL), storage: fakeStorage(), analyzer: fakeAnalyzer() });
  t.after(() => app.close());
  return app;
}

describe('auth', { skip }, () => {
  after(async () => {
    const pool = createPool(env.DATABASE_URL);
    // refresh_token rows go with the user (ON DELETE CASCADE).
    await pool.query('DELETE FROM app_user WHERE username = ANY($1)', [createdUsernames]);
    await pool.end();
  });

  test('register returns a session, and the access token works on /me', async (t) => {
    const app = await startApp(t);
    const user = newUser();

    const res = await app.inject({ method: 'POST', url: '/auth/register', payload: user });
    assert.equal(res.statusCode, 201);
    const body = res.json();
    assert.equal(body.user.username, user.username);
    assert.equal(body.user.totalXp, 0);
    assert.deepEqual(body.user.level, { number: 1, xpIntoLevel: 0, xpForNextLevel: 1000 });
    assert.equal(body.tokenType, 'Bearer');
    assert.equal(body.expiresIn, 900);
    assert.equal('passwordHash' in body.user || 'password_hash' in body.user, false);

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { authorization: `Bearer ${body.accessToken}` },
    });
    assert.equal(me.statusCode, 200);
    assert.deepEqual(me.json(), body.user);
  });

  test('register rejects a taken username or email, ignoring case', async (t) => {
    const app = await startApp(t);
    const user = newUser();
    await app.inject({ method: 'POST', url: '/auth/register', payload: user });

    const sameName = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...newUser(), username: user.username.toUpperCase() },
    });
    assert.equal(sameName.statusCode, 409);
    assert.equal(sameName.json().code, 'USERNAME_TAKEN');

    const sameEmail = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...newUser(), email: user.email.toUpperCase() },
    });
    assert.equal(sameEmail.statusCode, 409);
    assert.equal(sameEmail.json().code, 'EMAIL_TAKEN');
  });

  test('register rejects a short password', async (t) => {
    const app = await startApp(t);
    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { ...newUser(), password: 'short' },
    });
    assert.equal(res.statusCode, 400);
  });

  test('login accepts a username or an email, and rejects bad credentials the same way', async (t) => {
    const app = await startApp(t);
    const user = newUser();
    await app.inject({ method: 'POST', url: '/auth/register', payload: user });

    for (const identifier of [user.username, user.email]) {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/login',
        payload: { identifier, password: user.password },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().user.username, user.username);
    }

    const wrongPassword = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: user.username, password: 'wrong password' },
    });
    const unknownUser = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { identifier: 'nobody_by_this_name', password: user.password },
    });
    assert.equal(wrongPassword.statusCode, 401);
    assert.deepEqual(wrongPassword.json(), unknownUser.json());
  });

  test('refresh rotates the token, and reusing an old one revokes every session', async (t) => {
    const app = await startApp(t);
    const user = newUser();
    const session = (await app.inject({ method: 'POST', url: '/auth/register', payload: user })).json();

    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    assert.equal(refreshed.statusCode, 200);
    const next = refreshed.json();
    assert.notEqual(next.refreshToken, session.refreshToken);

    const reused = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    assert.equal(reused.statusCode, 401);
    assert.equal(reused.json().code, 'INVALID_REFRESH_TOKEN');

    // The newest token was revoked too, because the reuse looked like theft.
    const afterReuse = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: next.refreshToken },
    });
    assert.equal(afterReuse.statusCode, 401);
  });

  test('logout revokes the refresh token', async (t) => {
    const app = await startApp(t);
    const session = (await app.inject({ method: 'POST', url: '/auth/register', payload: newUser() })).json();

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      payload: { refreshToken: session.refreshToken },
    });
    assert.equal(logout.statusCode, 204);

    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    assert.equal(refreshed.statusCode, 401);
  });
});
