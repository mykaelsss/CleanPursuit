import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/lib/db.ts';
import { fakeAnalyzer, fakePlaces, fakeStorage, PNG_BYTES, testEnv as env } from './helpers.ts';

const skip = process.env.DATABASE_URL ? false : 'needs DATABASE_URL';
const users: string[] = [];
const files: string[] = [];
const reports: string[] = [];
const quests: string[] = [];
const locations: string[] = [];

after(async () => {
  if (!users.length && !locations.length) return;
  const pool = createPool(env.DATABASE_URL);
  try {
    await pool.query('DELETE FROM activity_event WHERE user_id = ANY($1::uuid[])', [users]);
    await pool.query('DELETE FROM quest WHERE id = ANY($1::uuid[])', [quests]);
    await pool.query('DELETE FROM report WHERE id = ANY($1::uuid[])', [reports]);
    await pool.query('DELETE FROM file WHERE id = ANY($1::uuid[])', [files]);
    await pool.query('DELETE FROM dropoff_location WHERE id = ANY($1::uuid[])', [locations]);
    await pool.query('DELETE FROM app_user WHERE id = ANY($1::uuid[])', [users]);
  } finally {
    await pool.end();
  }
});

test('drop-offs are ranked, cached, and gated by hazard requirements', { skip }, async (t) => {
  const storage = fakeStorage();
  const places = fakePlaces();
  const app = await buildApp({ env, pool: createPool(env.DATABASE_URL), storage, analyzer: fakeAnalyzer(), places });
  t.after(() => app.close());

  const suffix = randomBytes(5).toString('hex');
  const username = `drop_${suffix}`;
  const signup = await app.inject({
    method: 'POST', url: '/auth/register',
    payload: { username, email: `${username}@example.com`, password: 'correct horse battery staple' },
  });
  assert.equal(signup.statusCode, 201);
  const { user, accessToken } = signup.json();
  users.push(user.id);
  const authorization = `Bearer ${accessToken}`;

  async function makeQuest(
    hazards: string[],
    location = { latitude: -55.5, longitude: -130.5 },
  ) {
    const upload = await app.inject({
      method: 'POST', url: '/uploads', headers: { authorization },
      payload: { contentType: 'image/png', sizeBytes: PNG_BYTES.length },
    });
    assert.equal(upload.statusCode, 200);
    const { key } = upload.json();
    storage.put(key, 'image/png', PNG_BYTES);
    const confirmed = await app.inject({
      method: 'POST', url: '/files', headers: { authorization }, payload: { key },
    });
    assert.equal(confirmed.statusCode, 201);
    const fileId = confirmed.json().id as string;
    files.push(fileId);

    const report = await app.inject({
      method: 'POST', url: '/reports', headers: { authorization },
      payload: {
        photoFileId: fileId,
        description: 'Drop-off integration test',
        location,
        categories: ['mixed'],
        hazards,
      },
    });
    assert.equal(report.statusCode, 201);
    const reportId = report.json().id as string;
    reports.push(reportId);

    const quest = await app.inject({
      method: 'POST', url: `/reports/${reportId}/quest`, headers: { authorization },
      payload: { title: `Drop-off ${suffix}` },
    });
    assert.equal(quest.statusCode, 201);
    const questId = quest.json().id as string;
    quests.push(questId);
    return questId;
  }

  async function addLocation(name: string, longitudeOffset: number, acceptsSharps: boolean) {
    const result = await app.db.query<{ id: string }>(
      `INSERT INTO dropoff_location
         (source, name, address, location, accepts_sharps, verified_at)
       VALUES ('seed', $1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5, now())
       RETURNING id`,
      [name, `${name} test address`, -130.5 + longitudeOffset, -55.5, acceptsSharps],
    );
    locations.push(result.rows[0]!.id);
  }

  await addLocation(`Reject ${suffix}`, 0.0005, false);
  const nearest = `Near ${suffix}`;
  const farther = `Far ${suffix}`;
  await addLocation(nearest, 0.002, true);
  await addLocation(farther, 0.004, true);

  const questId = await makeQuest(['sharps']);

  const url = `/quests/${questId}/dropoffs`;
  const first = await app.inject({ method: 'GET', url, headers: { authorization } });
  assert.equal(first.statusCode, 200);
  const result = first.json();
  assert.equal(result.requiresDropoff, true);
  assert.equal(result.escalation.phone, '311');
  // The nearest site does not accept sharps, so it is left out.
  assert.deepEqual(result.dropoffs.map((item: { name: string }) => item.name), [nearest, farther]);
  assert.ok(result.dropoffs.every((item: { verified: boolean }) => item.verified));
  // Listed sites were found, so Google Places is not searched.
  assert.equal(places.searches.length, 0);

  await addLocation(`Later ${suffix}`, 0.0001, true);
  const second = await app.inject({ method: 'GET', url, headers: { authorization } });
  assert.equal(second.statusCode, 200);
  assert.deepEqual(second.json().dropoffs, result.dropoffs, 'the saved list is reused');

  // Keep this report more than 25 m away to avoid duplicate-report detection.
  const ordinaryId = await makeQuest(
    ['broken_glass'],
    { latitude: -55.49, longitude: -130.5 },
  );
  const ordinary = await app.inject({
    method: 'GET', url: `/quests/${ordinaryId}/dropoffs`, headers: { authorization },
  });
  assert.equal(ordinary.statusCode, 200);
  assert.equal(ordinary.json().requiresDropoff, false);
  assert.deepEqual(ordinary.json().dropoffs, []);

  const anonymous = await app.inject({ method: 'GET', url });
  assert.equal(anonymous.statusCode, 401);
});
