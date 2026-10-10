import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { newUploadKey } from '../src/lib/files.ts';
import { fakePool, fakeStorage, PNG_BYTES, testEnv as env } from './helpers.ts';

// The upload checks that run before any file row is written, so they need no database.

async function startApp(t: { after: (fn: () => Promise<unknown>) => void }) {
  const storage = fakeStorage();
  const app = await buildApp({ env, pool: fakePool(), storage });
  t.after(() => app.close());
  const userId = randomUUID();
  const authorization = `Bearer ${await app.accessTokens.sign(userId)}`;
  return { app, storage, userId, authorization };
}

test('POST /uploads needs a signed-in user', async (t) => {
  const { app } = await startApp(t);
  const res = await app.inject({ method: 'POST', url: '/uploads', payload: { contentType: 'image/png', sizeBytes: 100 } });
  assert.equal(res.statusCode, 401);
});

test('POST /uploads returns an upload URL under the user', async (t) => {
  const { app, userId, authorization } = await startApp(t);
  const res = await app.inject({
    method: 'POST',
    url: '/uploads',
    headers: { authorization },
    payload: { contentType: 'image/png', sizeBytes: 100 },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.key.startsWith(`users/${userId}/`));
  assert.ok(body.key.endsWith('.png'));
  assert.equal(body.method, 'PUT');
  assert.deepEqual(body.headers, { 'Content-Type': 'image/png' });
});

test('POST /uploads rejects other formats and oversized photos', async (t) => {
  const { app, authorization } = await startApp(t);
  for (const payload of [
    { contentType: 'image/gif', sizeBytes: 100 },
    { contentType: 'image/svg+xml', sizeBytes: 100 },
    { contentType: 'image/jpeg', sizeBytes: 11 * 1024 * 1024 },
    { contentType: 'image/jpeg', sizeBytes: 0 },
  ]) {
    const res = await app.inject({ method: 'POST', url: '/uploads', headers: { authorization }, payload });
    assert.equal(res.statusCode, 400, JSON.stringify(payload));
  }
});

test("POST /files rejects another user's key", async (t) => {
  const { app, authorization } = await startApp(t);
  const res = await app.inject({
    method: 'POST',
    url: '/files',
    headers: { authorization },
    payload: { key: newUploadKey(randomUUID(), 'image/png') },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'INVALID_UPLOAD_KEY');
});

test('POST /files before uploading returns UPLOAD_NOT_FOUND', async (t) => {
  const { app, userId, authorization } = await startApp(t);
  const res = await app.inject({
    method: 'POST',
    url: '/files',
    headers: { authorization },
    payload: { key: newUploadKey(userId, 'image/png') },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'UPLOAD_NOT_FOUND');
});

test('POST /files deletes an upload whose bytes are not the declared format', async (t) => {
  const { app, storage, userId, authorization } = await startApp(t);
  const key = newUploadKey(userId, 'image/jpeg');
  // PNG bytes uploaded under a JPEG key.
  storage.put(key, 'image/jpeg', PNG_BYTES);

  const res = await app.inject({ method: 'POST', url: '/files', headers: { authorization }, payload: { key } });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'INVALID_IMAGE');
  assert.equal(storage.has(key), false);
});
