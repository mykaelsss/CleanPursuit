import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/lib/db.ts';
import { type FakeStorage, fakeStorage, PNG_BYTES, testEnv as env } from './helpers.ts';

// These tests run against the real database and clean up everything they create.
// Run them with `infisical run -- npm test`; without DATABASE_URL they are skipped.
const skip = process.env.DATABASE_URL ? false : 'needs DATABASE_URL; run with `infisical run -- npm test`';

const createdUserIds: string[] = [];

type App = Awaited<ReturnType<typeof buildApp>>;

async function startApp(t: { after: (fn: () => Promise<unknown>) => void }) {
  const storage = fakeStorage();
  const app = await buildApp({ env, pool: createPool(env.DATABASE_URL), storage });
  t.after(() => app.close());
  return { app, storage };
}

async function signUp(app: App) {
  const username = `test_${randomBytes(6).toString('hex')}`;
  const res = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: { username, email: `${username}@example.com`, password: 'correct horse battery staple' },
  });
  assert.equal(res.statusCode, 201);
  const { user, accessToken } = res.json();
  createdUserIds.push(user.id);
  return { userId: user.id as string, authorization: `Bearer ${accessToken}` };
}

async function uploadPhoto(app: App, storage: FakeStorage, authorization: string): Promise<string> {
  const upload = await app.inject({
    method: 'POST',
    url: '/uploads',
    headers: { authorization },
    payload: { contentType: 'image/png', sizeBytes: PNG_BYTES.length },
  });
  const { key } = upload.json();
  storage.put(key, 'image/png', PNG_BYTES);
  const file = await app.inject({ method: 'POST', url: '/files', headers: { authorization }, payload: { key } });
  assert.equal(file.statusCode, 201);
  return file.json().id;
}

// A random spot in the Southern Ocean, far from real reports, so runs never see each other's data.
function randomSpot() {
  return { latitude: -56 + Math.random(), longitude: -130 + Math.random() };
}

// About 10 m north of a spot.
function nearby(spot: { latitude: number; longitude: number }) {
  return { latitude: spot.latitude + 0.00009, longitude: spot.longitude };
}

function postReport(app: App, authorization: string, payload: Record<string, unknown>) {
  return app.inject({ method: 'POST', url: '/reports', headers: { authorization }, payload });
}

describe('reports and quests', { skip }, () => {
  after(async () => {
    const pool = createPool(env.DATABASE_URL);
    const users = [createdUserIds];
    await pool.query('DELETE FROM activity_event WHERE user_id = ANY($1)', users);
    await pool.query(
      `DELETE FROM quest
       WHERE created_by_user_id = ANY($1)
          OR report_id IN (SELECT id FROM report WHERE reporter_user_id = ANY($1))`,
      users,
    );
    // Tags go with the report (ON DELETE CASCADE).
    await pool.query('DELETE FROM report WHERE reporter_user_id = ANY($1)', users);
    await pool.query('DELETE FROM file WHERE uploaded_by_user_id = ANY($1)', users);
    await pool.query('DELETE FROM app_user WHERE id = ANY($1)', users);
    await pool.end();
  });

  test('GET /tags lists the seeded categories and hazards', async (t) => {
    const { app } = await startApp(t);
    const { authorization } = await signUp(app);
    const res = await app.inject({ method: 'GET', url: '/tags', headers: { authorization } });
    assert.equal(res.statusCode, 200);
    const { categories, hazards } = res.json();
    assert.ok(categories.some((c: { code: string }) => c.code === 'plastic'));
    const sharps = hazards.find((h: { code: string }) => h.code === 'sharps');
    assert.equal(sharps.requiresDropoff, true);
    assert.ok(sharps.warning.length > 0);
  });

  test('confirming the same upload twice returns the same file', async (t) => {
    const { app, storage } = await startApp(t);
    const { authorization } = await signUp(app);
    const upload = await app.inject({
      method: 'POST',
      url: '/uploads',
      headers: { authorization },
      payload: { contentType: 'image/png', sizeBytes: PNG_BYTES.length },
    });
    const { key } = upload.json();
    storage.put(key, 'image/png', PNG_BYTES);

    const confirm = () => app.inject({ method: 'POST', url: '/files', headers: { authorization }, payload: { key } });
    const [first, second] = [await confirm(), await confirm()];
    assert.equal(first.statusCode, 201);
    assert.equal(second.statusCode, 201);
    assert.equal(first.json().id, second.json().id);
    assert.equal(first.json().sizeBytes, PNG_BYTES.length);
  });

  test('a report gets its tier from its tags and logs a report_submitted event', async (t) => {
    const { app, storage } = await startApp(t);
    const { userId, authorization } = await signUp(app);
    const spot = randomSpot();

    const res = await postReport(app, authorization, {
      photoFileId: await uploadPhoto(app, storage, authorization),
      description: '  Bottles and a broken mirror by the bench  ',
      location: spot,
      categories: ['glass', 'plastic', 'glass'],
      hazards: ['broken_glass'],
      estimatedBagCount: 2,
    });
    assert.equal(res.statusCode, 201);
    const report = res.json();
    assert.equal(report.description, 'Bottles and a broken mirror by the bench');
    assert.equal(report.difficultyTier, 'hard');
    assert.deepEqual(
      report.categories.map((c: { code: string }) => c.code),
      ['glass', 'plastic'],
    );
    assert.equal(report.hazards[0].code, 'broken_glass');
    assert.equal(report.reporter.id, userId);
    assert.equal(report.duplicateOf, null);
    assert.equal(report.questId, null);
    assert.ok(Math.abs(report.location.latitude - spot.latitude) < 1e-9);
    assert.ok(report.photo.url.startsWith('https://storage.test/users/'));

    const pool = createPool(env.DATABASE_URL);
    t.after(() => pool.end());
    const events = await pool.query(
      `SELECT kind, area_id IS NOT NULL AS has_area FROM activity_event WHERE report_id = $1`,
      [report.id],
    );
    assert.deepEqual(events.rows, [{ kind: 'report_submitted', has_area: true }]);

    const fetched = await app.inject({ method: 'GET', url: `/reports/${report.id}`, headers: { authorization } });
    assert.equal(fetched.statusCode, 200);
    assert.equal(fetched.json().id, report.id);
  });

  test('re-reporting a spot links to the original, which alone can become a quest', async (t) => {
    const { app, storage } = await startApp(t);
    const first = await signUp(app);
    const second = await signUp(app);
    const spot = randomSpot();

    const original = await postReport(app, first.authorization, {
      photoFileId: await uploadPhoto(app, storage, first.authorization),
      description: 'Litter along the fence',
      location: spot,
      categories: ['mixed'],
    });
    assert.equal(original.statusCode, 201);
    const originalId = original.json().id;

    const duplicate = await postReport(app, second.authorization, {
      photoFileId: await uploadPhoto(app, storage, second.authorization),
      description: 'Same fence, still messy',
      location: nearby(spot),
      categories: ['plastic'],
    });
    assert.equal(duplicate.statusCode, 201);
    assert.deepEqual(duplicate.json().duplicateOf, { reportId: originalId, questId: null });

    const fromDuplicate = await app.inject({
      method: 'POST',
      url: `/reports/${duplicate.json().id}/quest`,
      headers: { authorization: second.authorization },
      payload: { title: 'Clean the fence' },
    });
    assert.equal(fromDuplicate.statusCode, 409);
    assert.equal(fromDuplicate.json().code, 'REPORT_IS_DUPLICATE');

    // Anyone can raise a quest, not only the reporter.
    const quest = await app.inject({
      method: 'POST',
      url: `/reports/${originalId}/quest`,
      headers: { authorization: second.authorization },
      payload: { title: 'Clean the fence' },
    });
    assert.equal(quest.statusCode, 201);
    const body = quest.json();
    assert.equal(body.status, 'open');
    assert.equal(body.creator.id, second.userId);
    assert.equal(body.report.id, originalId);
    assert.equal(body.report.questId, body.id);

    const again = await app.inject({
      method: 'POST',
      url: `/reports/${originalId}/quest`,
      headers: { authorization: first.authorization },
      payload: { title: 'Clean the fence again' },
    });
    assert.equal(again.statusCode, 409);
    assert.equal(again.json().code, 'QUEST_EXISTS');

    // A later duplicate points at the original's quest.
    const third = await postReport(app, first.authorization, {
      photoFileId: await uploadPhoto(app, storage, first.authorization),
      description: 'Still there',
      location: nearby(spot),
      categories: ['mixed'],
    });
    assert.deepEqual(third.json().duplicateOf, { reportId: originalId, questId: body.id });
  });

  test('GET /quests lists open quests near a location, nearest first', async (t) => {
    const { app, storage } = await startApp(t);
    const { authorization } = await signUp(app);
    const spot = randomSpot();

    const questIds: string[] = [];
    // About 100 m and 1 km north of the spot.
    for (const offset of [0.0009, 0.009]) {
      const report = await postReport(app, authorization, {
        photoFileId: await uploadPhoto(app, storage, authorization),
        description: 'Trash pile',
        location: { latitude: spot.latitude + offset, longitude: spot.longitude },
        categories: ['mixed'],
        hazards: ['sharps'],
      });
      const quest = await app.inject({
        method: 'POST',
        url: `/reports/${report.json().id}/quest`,
        headers: { authorization },
        payload: { title: 'Trash pile' },
      });
      questIds.push(quest.json().id);
    }

    const list = (radiusM: number) =>
      app.inject({
        method: 'GET',
        url: `/quests?latitude=${spot.latitude}&longitude=${spot.longitude}&radiusM=${radiusM}`,
        headers: { authorization },
      });

    const wide = await list(5000);
    assert.equal(wide.statusCode, 200);
    const quests = wide.json().quests;
    assert.deepEqual(
      quests.map((q: { id: string }) => q.id),
      questIds,
    );
    assert.ok(quests[0].distanceM >= 95 && quests[0].distanceM <= 105, `distance ${quests[0].distanceM}`);
    assert.equal(quests[0].difficultyTier, 'legendary');
    assert.deepEqual(quests[0].hazards, ['sharps']);

    const narrow = await list(500);
    assert.deepEqual(
      narrow.json().quests.map((q: { id: string }) => q.id),
      [questIds[0]],
    );

    const detail = await app.inject({ method: 'GET', url: `/quests/${questIds[0]}`, headers: { authorization } });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().report.hazards[0].requiresDropoff, true);
  });

  test('report and quest errors', async (t) => {
    const { app, storage } = await startApp(t);
    const owner = await signUp(app);
    const other = await signUp(app);
    const photoFileId = await uploadPhoto(app, storage, owner.authorization);
    const base = { description: 'Cans', location: randomSpot(), categories: ['metal'] };

    const unknownCategory = await postReport(app, owner.authorization, { ...base, photoFileId, categories: ['lava'] });
    assert.equal(unknownCategory.statusCode, 400);
    assert.equal(unknownCategory.json().code, 'UNKNOWN_CATEGORY');

    const unknownHazard = await postReport(app, owner.authorization, { ...base, photoFileId, hazards: ['lava'] });
    assert.equal(unknownHazard.statusCode, 400);
    assert.equal(unknownHazard.json().code, 'UNKNOWN_HAZARD');

    const someoneElsesPhoto = await postReport(app, other.authorization, { ...base, photoFileId });
    assert.equal(someoneElsesPhoto.statusCode, 400);
    assert.equal(someoneElsesPhoto.json().code, 'PHOTO_NOT_FOUND');

    assert.equal((await postReport(app, owner.authorization, { ...base, photoFileId })).statusCode, 201);
    const reused = await postReport(app, owner.authorization, { ...base, photoFileId, location: randomSpot() });
    assert.equal(reused.statusCode, 409);
    assert.equal(reused.json().code, 'PHOTO_ALREADY_USED');

    const missingReport = await app.inject({
      method: 'GET',
      url: `/reports/${randomUUID()}`,
      headers: { authorization: owner.authorization },
    });
    assert.equal(missingReport.statusCode, 404);
    assert.equal(missingReport.json().code, 'REPORT_NOT_FOUND');

    const missingQuest = await app.inject({
      method: 'GET',
      url: `/quests/${randomUUID()}`,
      headers: { authorization: owner.authorization },
    });
    assert.equal(missingQuest.statusCode, 404);
    assert.equal(missingQuest.json().code, 'QUEST_NOT_FOUND');
  });
});
