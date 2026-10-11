import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { createAccessTokens } from '../src/lib/tokens.ts';
import { fakeAnalyzer, fakePlaces, fakePool, fakeStorage, testEnv as env } from './helpers.ts';

const userId = '01990000-0000-7000-8000-000000000000';
const fileId = '01990000-0000-7000-8000-000000000001';

async function recover(rows: { report_id: string | null }[], authorization?: string) {
  const app = await buildApp({ env, pool: fakePool(async () => ({ rows })), storage: fakeStorage(), analyzer: fakeAnalyzer(), places: fakePlaces() });
  try {
    return await app.inject({ method: 'GET', url: `/files/${fileId}/report`, headers: authorization ? { authorization } : {} });
  } finally { await app.close(); }
}

test('report recovery requires authentication before looking up a photo', async () => {
  const response = await recover([]);
  assert.equal(response.statusCode, 401);
  assert.equal(response.json().code, 'MISSING_ACCESS_TOKEN');
});

test('report recovery serializes an unused owned photo as JSON null', async () => {
  const authorization = `Bearer ${await createAccessTokens(env.JWT_SECRET).sign(userId)}`;
  const response = await recover([{ report_id: null }], authorization);
  assert.equal(response.statusCode, 200);
  assert.equal(response.json(), null);
});

test('report recovery returns the same error for missing and inaccessible uploads', async () => {
  const authorization = `Bearer ${await createAccessTokens(env.JWT_SECRET).sign(userId)}`;
  const response = await recover([], authorization);
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().code, 'FILE_NOT_FOUND');
});
