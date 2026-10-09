import assert from 'node:assert/strict';
import { test } from 'node:test';
import type pg from 'pg';
import { buildApp } from '../src/app.ts';
import type { Env } from '../src/env.ts';

const env: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  DATABASE_URL: 'postgres://unused',
};

function fakePool(query: () => Promise<unknown>): pg.Pool {
  return { query, on: () => {}, end: async () => {} } as unknown as pg.Pool;
}

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
  const app = await buildApp({ env, pool: fakePool(async () => ({ rows: [] })) });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/nope' });

  assert.equal(res.statusCode, 404);
});
