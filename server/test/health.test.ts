import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { fakePool, testEnv as env } from './helpers.ts';

test('GET /health reports ok when the database answers', async (t) => {
  const app = await buildApp({ env, pool: fakePool(async () => ({ rows: [{ '?column?': 1 }] })) });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok', database: 'ok' });
});

test('GET /health reports 503 when the database is unreachable', async (t) => {
  const app = await buildApp({
    env,
    pool: fakePool(async () => {
      throw new Error('connection refused');
    }),
  });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { status: 'degraded', database: 'unreachable' });
});

test('unknown routes return 404', async (t) => {
  const app = await buildApp({ env, pool: fakePool() });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/nope' });

  assert.equal(res.statusCode, 404);
});
