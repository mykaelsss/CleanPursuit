import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { fakeAnalyzer, fakePlaces, fakePool, fakeStorage, testEnv as env } from './helpers.ts';

test('GET /health reports ok when the database answers', async (t) => {
  const app = await buildApp({
    env,
    pool: fakePool(async () => ({ rows: [{ '?column?': 1 }] })),
    storage: fakeStorage(),
    analyzer: fakeAnalyzer(),
    places: fakePlaces(),
  });
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
    storage: fakeStorage(),
    analyzer: fakeAnalyzer(),
    places: fakePlaces(),
  });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/health' });

  assert.equal(res.statusCode, 503);
  assert.deepEqual(res.json(), { status: 'degraded', database: 'unreachable' });
});

test('unknown routes return 404', async (t) => {
  const app = await buildApp({
    env,
    pool: fakePool(),
    storage: fakeStorage(),
    analyzer: fakeAnalyzer(),
    places: fakePlaces(),
  });
  t.after(() => app.close());

  const res = await app.inject({ method: 'GET', url: '/nope' });

  assert.equal(res.statusCode, 404);
});

test('browsers may send every method the API uses from another origin', async (t) => {
  const app = await buildApp({ env, pool: fakePool(), storage: fakeStorage(), analyzer: fakeAnalyzer(), places: fakePlaces() });
  t.after(() => app.close());

  const res = await app.inject({
    method: 'OPTIONS',
    url: '/events/01a12823-1641-70c1-ab2e-967f10759ae0/join',
    headers: {
      origin: 'http://localhost:8081',
      'access-control-request-method': 'DELETE',
      'access-control-request-headers': 'authorization',
    },
  });

  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.ok(String(res.headers['access-control-allow-methods']).split(/,\s*/).includes('DELETE'));
});
