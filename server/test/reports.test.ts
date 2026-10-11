import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/lib/db.ts';
import { PlacesFailedError } from '../src/lib/places.ts';
import {
  type FakeAnalyzer,
  type FakePlaces,
  type FakeStorage,
  fakeAnalyzer,
  fakePlaces,
  fakeStorage,
  PNG_BYTES,
  testEnv as env,
} from './helpers.ts';

// These tests run against the real database and clean up everything they create.
// Run them with `infisical run -- npm test`; without DATABASE_URL they are skipped.
const skip = process.env.DATABASE_URL ? false : 'needs DATABASE_URL; run with `infisical run -- npm test`';

const createdUserIds: string[] = [];
const createdDropoffIds: string[] = [];

type App = Awaited<ReturnType<typeof buildApp>>;

async function startApp(
  t: { after: (fn: () => Promise<unknown>) => void },
  analyzer: FakeAnalyzer = fakeAnalyzer(),
  places: FakePlaces = fakePlaces(),
) {
  const storage = fakeStorage();
  const app = await buildApp({ env, pool: createPool(env.DATABASE_URL), storage, analyzer, places });
  t.after(() => app.close());
  return { app, storage, analyzer, places };
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

async function createQuest(
  app: App,
  storage: FakeStorage,
  authorization: string,
  report: { location: { latitude: number; longitude: number }; hazards: string[] },
): Promise<string> {
  const created = await postReport(app, authorization, {
    photoFileId: await uploadPhoto(app, storage, authorization),
    description: 'Trash pile',
    categories: ['mixed'],
    ...report,
  });
  assert.equal(created.statusCode, 201);
  const quest = await app.inject({
    method: 'POST',
    url: `/reports/${created.json().id}/quest`,
    headers: { authorization },
    payload: { title: 'Trash pile' },
  });
  assert.equal(quest.statusCode, 201);
  return quest.json().id;
}

function getDropoffs(app: App, authorization: string, questId: string) {
  return app.inject({ method: 'GET', url: `/quests/${questId}/dropoffs`, headers: { authorization } });
}

// A fake Places result `latitudeOffset` degrees north of a spot (0.001 degrees is about 111 m).
function placeNear(spot: { latitude: number; longitude: number }, latitudeOffset: number, name: string) {
  return {
    id: `test_${randomBytes(6).toString('hex')}`,
    name,
    address: `${name} Street`,
    location: { latitude: spot.latitude + latitudeOffset, longitude: spot.longitude },
  };
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
    // Saved drop-off lists went with the quests (ON DELETE CASCADE).
    await pool.query(
      `DELETE FROM dropoff_location WHERE id = ANY($1) OR google_place_id LIKE 'test\\_%'`,
      [createdDropoffIds],
    );
    // Tags go with the report, and photo analyses with the file (ON DELETE CASCADE).
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

  test('photo-to-report recovery returns null before submission and only permits the uploader', async (t) => {
    const { app, storage } = await startApp(t);
    const owner = await signUp(app);
    const other = await signUp(app);
    const photoFileId = await uploadPhoto(app, storage, owner.authorization);
    const lookup = (authorization: string) => app.inject({
      method: 'GET', url: `/files/${photoFileId}/report`, headers: { authorization },
    });
    const unused = await lookup(owner.authorization);
    assert.equal(unused.statusCode, 200);
    assert.equal(unused.json(), null);
    const submitted = await postReport(app, owner.authorization, {
      photoFileId, description: 'Bottles by the gate', location: randomSpot(), categories: ['plastic'],
    });
    assert.equal(submitted.statusCode, 201);
    const recovered = await lookup(owner.authorization);
    assert.equal(recovered.statusCode, 200);
    assert.equal(recovered.json().id, submitted.json().id);
    assert.equal(recovered.json().photo.id, photoFileId);
    const denied = await lookup(other.authorization);
    assert.equal(denied.statusCode, 404);
    assert.equal(denied.json().code, 'FILE_NOT_FOUND');
    const unsigned = await app.inject({ method: 'GET', url: `/files/${photoFileId}/report` });
    assert.equal(unsigned.statusCode, 401);
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
      placeName: '  Tompkins Square Park, East Village  ',
      categories: ['glass', 'plastic', 'glass'],
      hazards: ['broken_glass'],
      estimatedVolume: { minGallons: 20, maxGallons: 30 },
    });
    assert.equal(res.statusCode, 201);
    const report = res.json();
    assert.equal(report.description, 'Bottles and a broken mirror by the bench');
    assert.equal(report.placeName, 'Tompkins Square Park, East Village');
    assert.equal(report.difficultyTier, 'hard');
    assert.deepEqual(
      report.categories.map((c: { code: string }) => c.code),
      ['glass', 'plastic'],
    );
    assert.equal(report.hazards[0].code, 'broken_glass');
    assert.equal(report.estimatedVolume.minGallons, 20);
    assert.deepEqual(report.estimatedVolume.bags[0], { size: 'kitchen', gallons: 13, min: 2, max: 3 });
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
        ...(offset < 0.001 ? { placeName: 'By the bench' } : {}),
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
    assert.equal(quests[0].placeName, 'By the bench');
    assert.match(quests[0].areaId, /^[0-9a-f]{15}$/);
    assert.equal(quests[1].placeName, null);

    const narrow = await list(500);
    assert.deepEqual(
      narrow.json().quests.map((q: { id: string }) => q.id),
      [questIds[0]],
    );

    const detail = await app.inject({ method: 'GET', url: `/quests/${questIds[0]}`, headers: { authorization } });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().report.hazards[0].requiresDropoff, true);
  });

  test('a photo is analyzed once, and only by its uploader', async (t) => {
    const { app, storage, analyzer } = await startApp(
      t,
      fakeAnalyzer({
        categories: ['glass', 'plastic'],
        hazards: ['broken_glass'],
        estimatedVolume: { minGallons: 104, maxGallons: 156 },
      }),
    );
    const owner = await signUp(app);
    const other = await signUp(app);
    const fileId = await uploadPhoto(app, storage, owner.authorization);
    const analyze = (authorization: string, id = fileId) =>
      app.inject({ method: 'POST', url: `/files/${id}/analysis`, headers: { authorization } });

    const first = await analyze(owner.authorization);
    assert.equal(first.statusCode, 200);
    const analysis = first.json();
    assert.equal(analysis.fileId, fileId);
    assert.equal(analysis.showsLitter, true);
    assert.equal(analysis.title, 'Clear bottles by the bench');
    assert.deepEqual(analysis.categories, ['glass', 'plastic']);
    assert.deepEqual(analysis.hazards, ['broken_glass']);
    assert.deepEqual(analysis.estimatedVolume, {
      minGallons: 104,
      maxGallons: 156,
      bags: [
        { size: 'kitchen', gallons: 13, min: 8, max: 12 },
        { size: 'large', gallons: 33, min: 4, max: 5 },
        { size: 'contractor', gallons: 42, min: 3, max: 4 },
      ],
    });
    assert.equal(analysis.terrain, 'grass');
    assert.equal(analysis.model, 'test-model');

    // Gemini sees the photo and picks from the tag lists in the database.
    assert.equal(analyzer.calls.length, 1);
    assert.deepEqual(analyzer.calls[0]!.image, PNG_BYTES);
    assert.equal(analyzer.calls[0]!.contentType, 'image/png');
    assert.ok(analyzer.calls[0]!.categories.some((tag) => tag.code === 'plastic'));
    assert.ok(analyzer.calls[0]!.hazards.some((tag) => tag.code === 'sharps'));

    const again = await analyze(owner.authorization);
    assert.equal(again.statusCode, 200);
    assert.deepEqual(again.json(), analysis);
    assert.equal(analyzer.calls.length, 1);

    const someoneElses = await analyze(other.authorization);
    assert.equal(someoneElses.statusCode, 404);
    assert.equal(someoneElses.json().code, 'FILE_NOT_FOUND');

    const missing = await analyze(owner.authorization, randomUUID());
    assert.equal(missing.statusCode, 404);
  });

  test('when Gemini fails, analysis returns 503 and saves nothing', async (t) => {
    const { app, storage } = await startApp(t, fakeAnalyzer({}, new Error('quota exceeded')));
    const { authorization } = await signUp(app);
    const fileId = await uploadPhoto(app, storage, authorization);

    const res = await app.inject({ method: 'POST', url: `/files/${fileId}/analysis`, headers: { authorization } });
    assert.equal(res.statusCode, 503);
    assert.equal(res.json().code, 'ANALYSIS_UNAVAILABLE');

    const pool = createPool(env.DATABASE_URL);
    t.after(() => pool.end());
    const saved = await pool.query('SELECT 1 FROM photo_analysis WHERE file_id = $1', [fileId]);
    assert.equal(saved.rowCount, 0);
  });

  test("tags Gemini suggested and the reporter kept are recorded as Gemini's", async (t) => {
    const { app, storage } = await startApp(
      t,
      fakeAnalyzer({ categories: ['glass', 'plastic'], hazards: ['broken_glass'] }),
    );
    const { authorization } = await signUp(app);
    const photoFileId = await uploadPhoto(app, storage, authorization);
    await app.inject({ method: 'POST', url: `/files/${photoFileId}/analysis`, headers: { authorization } });

    // The reporter drops glass, adds metal and sharps.
    const res = await postReport(app, authorization, {
      photoFileId,
      description: 'Bottles, cans and a needle by the bench',
      location: randomSpot(),
      categories: ['plastic', 'metal'],
      hazards: ['broken_glass', 'sharps'],
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.json().difficultyTier, 'legendary');

    const pool = createPool(env.DATABASE_URL);
    t.after(() => pool.end());
    const tags = await pool.query(
      `SELECT category_code AS code, source::text FROM report_category WHERE report_id = $1
       UNION ALL
       SELECT hazard_code, source::text FROM report_hazard WHERE report_id = $1
       ORDER BY code`,
      [res.json().id],
    );
    assert.deepEqual(tags.rows, [
      { code: 'broken_glass', source: 'gemini' },
      { code: 'metal', source: 'user' },
      { code: 'plastic', source: 'gemini' },
      { code: 'sharps', source: 'user' },
    ]);
  });

  test('with no listed site nearby, drop-offs come from Places, looked up once per quest', async (t) => {
    const spot = randomSpot();
    const near = placeNear(spot, 0.003, 'Harm Reduction Center');
    const far = placeNear(spot, 0.2, 'Too Far Clinic');
    const { app, storage, places } = await startApp(t, fakeAnalyzer(), fakePlaces([far, near]));
    const { authorization } = await signUp(app);
    const questId = await createQuest(app, storage, authorization, { location: spot, hazards: ['sharps'] });

    const res = await getDropoffs(app, authorization, questId);
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.requiresDropoff, true);
    assert.equal(body.escalation.phone, '311');
    assert.equal(body.dropoffs.length, 1, 'the site 22 km away is dropped');
    const [dropoff] = body.dropoffs;
    assert.equal(dropoff.name, 'Harm Reduction Center');
    assert.equal(dropoff.googlePlaceId, near.id);
    assert.equal(dropoff.verified, false);
    assert.ok(dropoff.distanceM >= 325 && dropoff.distanceM <= 345, `distance ${dropoff.distanceM}`);
    assert.equal(places.searches.length, 1);
    assert.equal(places.searches[0]!.query, 'syringe service program');

    // Later requests read the saved list and only refetch the place's details.
    const again = await getDropoffs(app, authorization, questId);
    assert.deepEqual(again.json().dropoffs, body.dropoffs);
    assert.equal(places.searches.length, 1);
    assert.deepEqual(places.detailLookups, [near.id, near.id]);
  });

  test('listed drop-off sites come before Places', async (t) => {
    const spot = randomSpot();
    const pool = createPool(env.DATABASE_URL);
    t.after(() => pool.end());
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO dropoff_location (source, name, address, location, phone, hours, notes, verified_at)
       VALUES ('seed', 'Test Hospital', '1 Test Ave', ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography,
               '555-0100', '9am-5pm', 'Lobby', now())
       RETURNING id`,
      [spot.longitude, spot.latitude + 0.002],
    );
    createdDropoffIds.push(rows[0]!.id);

    const { app, storage, places } = await startApp(t, fakeAnalyzer(), fakePlaces([placeNear(spot, 0.001, 'Nope')]));
    const { authorization } = await signUp(app);
    const questId = await createQuest(app, storage, authorization, { location: spot, hazards: ['biohazard'] });

    const res = await getDropoffs(app, authorization, questId);
    assert.equal(res.statusCode, 200);
    const [dropoff] = res.json().dropoffs;
    assert.equal(dropoff.id, rows[0]!.id);
    assert.equal(dropoff.name, 'Test Hospital');
    assert.equal(dropoff.notes, 'Lobby');
    assert.equal(dropoff.verified, true);
    assert.equal(dropoff.googlePlaceId, null);
    assert.equal(places.searches.length, 0);
  });

  test('quests without sharps or biohazard skip the lookup', async (t) => {
    const { app, storage, places } = await startApp(t);
    const { authorization } = await signUp(app);
    const questId = await createQuest(app, storage, authorization, {
      location: randomSpot(),
      hazards: ['broken_glass'],
    });

    const res = await getDropoffs(app, authorization, questId);
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().requiresDropoff, false);
    assert.deepEqual(res.json().dropoffs, []);
    assert.equal(places.searches.length, 0);
  });

  test('when Places fails, nothing is saved so the next request tries again', async (t) => {
    const { app, storage } = await startApp(t, fakeAnalyzer(), fakePlaces([], new PlacesFailedError('down')));
    const { authorization } = await signUp(app);
    const questId = await createQuest(app, storage, authorization, { location: randomSpot(), hazards: ['sharps'] });

    const res = await getDropoffs(app, authorization, questId);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json().dropoffs, []);
    assert.equal(res.json().escalation.phone, '311');

    const pool = createPool(env.DATABASE_URL);
    t.after(() => pool.end());
    const { rows } = await pool.query(`SELECT dropoffs_fetched_at FROM quest WHERE id = $1`, [questId]);
    assert.equal(rows[0].dropoffs_fetched_at, null);
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

    const tooWide = await postReport(app, owner.authorization, {
      ...base,
      photoFileId,
      estimatedVolume: { minGallons: 50, maxGallons: 150 },
    });
    assert.equal(tooWide.statusCode, 400);
    assert.equal(tooWide.json().code, 'INVALID_VOLUME_RANGE');

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

    const missingDropoffs = await getDropoffs(app, owner.authorization, randomUUID());
    assert.equal(missingDropoffs.statusCode, 404);
    assert.equal(missingDropoffs.json().code, 'QUEST_NOT_FOUND');
  });
});
