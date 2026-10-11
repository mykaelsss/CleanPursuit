import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/lib/db.ts';
import { fakeAnalyzer, fakeStorage, PNG_BYTES, testEnv as env } from './helpers.ts';

const skip = process.env.DATABASE_URL
  ? false
  : 'needs DATABASE_URL; run with `infisical run -- npm test`';

const userIds: string[] = [];
const fileIds: string[] = [];
const reportIds: string[] = [];
const questIds: string[] = [];
const itemIds: string[] = [];

type App = Awaited<ReturnType<typeof buildApp>>;
type Storage = ReturnType<typeof fakeStorage>;

async function startApp(t: { after: (fn: () => Promise<unknown>) => void }) {
  const storage = fakeStorage();
  const app = await buildApp({ env, pool: createPool(env.DATABASE_URL), storage, analyzer: fakeAnalyzer() });
  t.after(() => app.close());
  return { app, storage };
}

async function signUp(app: App) {
  const username = `equipment_${randomBytes(6).toString('hex')}`;
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      username,
      email: `${username}@example.com`,
      password: 'correct horse battery staple',
    },
  });
  assert.equal(response.statusCode, 201);
  const { user, accessToken } = response.json();
  userIds.push(user.id);
  return { authorization: `Bearer ${accessToken}` };
}

async function uploadPhoto(app: App, storage: Storage, authorization: string) {
  const upload = await app.inject({
    method: 'POST',
    url: '/uploads',
    headers: { authorization },
    payload: { contentType: 'image/png', sizeBytes: PNG_BYTES.length },
  });
  assert.equal(upload.statusCode, 200);
  const { key } = upload.json();
  storage.put(key, 'image/png', PNG_BYTES);

  const confirmation = await app.inject({
    method: 'POST',
    url: '/files',
    headers: { authorization },
    payload: { key },
  });
  assert.equal(confirmation.statusCode, 201);
  const id = confirmation.json().id as string;
  fileIds.push(id);
  return id;
}

async function createQuest(
  app: App,
  storage: Storage,
  authorization: string,
  hazards: string[],
) {
  const usernameSuffix = randomBytes(4).toString('hex');
  const report = await app.inject({
    method: 'POST',
    url: '/reports',
    headers: { authorization },
    payload: {
      photoFileId: await uploadPhoto(app, storage, authorization),
      description: 'Equipment lookup integration test',
      location: {
        latitude: -56 + Math.random(),
        longitude: -130 + Math.random(),
      },
      categories: ['mixed'],
      hazards,
    },
  });
  assert.equal(report.statusCode, 201);
  const reportId = report.json().id as string;
  reportIds.push(reportId);

  const quest = await app.inject({
    method: 'POST',
    url: `/reports/${reportId}/quest`,
    headers: { authorization },
    payload: { title: `Equipment test ${usernameSuffix}` },
  });
  assert.equal(quest.statusCode, 201);
  const questId = quest.json().id as string;
  questIds.push(questId);
  return questId;
}

describe('equipment lookup', { skip }, () => {
  after(async () => {
    if (userIds.length === 0 && itemIds.length === 0) return;
    const pool = createPool(env.DATABASE_URL);
    try {
      await pool.query(
        'DELETE FROM activity_event WHERE user_id = ANY($1::uuid[])',
        [userIds],
      );
      await pool.query('DELETE FROM quest WHERE id = ANY($1::uuid[])', [questIds]);
      await pool.query('DELETE FROM report WHERE id = ANY($1::uuid[])', [reportIds]);
      await pool.query('DELETE FROM file WHERE id = ANY($1::uuid[])', [fileIds]);
      await pool.query('DELETE FROM item WHERE id = ANY($1::uuid[])', [itemIds]);
      await pool.query('DELETE FROM app_user WHERE id = ANY($1::uuid[])', [userIds]);
    } finally {
      await pool.end();
    }
  });

  test('recommends mapped gear, returns hazard warnings, and blocks drop-off gear advice', async (t) => {
    const { app, storage } = await startApp(t);
    const { authorization } = await signUp(app);
    const suffix = randomBytes(5).toString('hex');
    const itemName = `Equipment test ${suffix}`;

    const inserted = await app.db.query<{ id: string }>(
      'INSERT INTO item (name, description) VALUES ($1, $2) RETURNING id',
      [itemName, 'Temporary equipment item for integration testing'],
    );
    const itemId = inserted.rows[0]!.id;
    itemIds.push(itemId);

    await app.db.query(
      "INSERT INTO category_item (category_code, item_id) VALUES ('mixed', $1)",
      [itemId],
    );
    await app.db.query(
      "INSERT INTO hazard_item (hazard_code, item_id) VALUES ('broken_glass', $1)",
      [itemId],
    );

    const ordinaryQuest = await createQuest(app, storage, authorization, []);
    const ordinary = await app.inject({
      method: 'GET',
      url: `/quests/${ordinaryQuest}/equipment`,
      headers: { authorization },
    });
    assert.equal(ordinary.statusCode, 200);
    assert.ok(ordinary.json().items.some((item: { name: string }) => item.name === itemName));

    const glassQuest = await createQuest(app, storage, authorization, ['broken_glass']);
    const glass = await app.inject({
      method: 'GET',
      url: `/quests/${glassQuest}/equipment`,
      headers: { authorization },
    });
    assert.equal(glass.statusCode, 200);
    assert.ok(glass.json().items.some((item: { name: string }) => item.name === itemName));
    assert.ok(glass.json().hazards.some((hazard: { code: string }) => hazard.code === 'broken_glass'));

    const sharpsQuest = await createQuest(app, storage, authorization, ['sharps']);
    const sharps = await app.inject({
      method: 'GET',
      url: `/quests/${sharpsQuest}/equipment`,
      headers: { authorization },
    });
    assert.equal(sharps.statusCode, 200);
    assert.deepEqual(sharps.json().items, []);
    assert.ok(sharps.json().hazards.some(
      (hazard: { code: string; requiresDropoff: boolean }) =>
        hazard.code === 'sharps' && hazard.requiresDropoff,
    ));

    const anonymous = await app.inject({
      method: 'GET',
      url: `/quests/${ordinaryQuest}/equipment`,
    });
    assert.equal(anonymous.statusCode, 401);

    const missing = await app.inject({
      method: 'GET',
      url: '/quests/00000000-0000-7000-8000-000000000001/equipment',
      headers: { authorization },
    });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().code, 'QUEST_NOT_FOUND');
  });
});
