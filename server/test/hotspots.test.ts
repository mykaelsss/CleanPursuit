import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/lib/db.ts';
import { fakeAnalyzer, fakePlaces, fakeStorage, testEnv as env } from './helpers.ts';

const skip = process.env.DATABASE_URL
  ? false
  : 'needs DATABASE_URL; run with `infisical run -- npm test`';

let userId: string | undefined;

after(async () => {
  if (!userId) return;

  const pool = createPool(env.DATABASE_URL);
  try {
    await pool.query(
      'DELETE FROM activity_event WHERE user_id = $1',
      [userId],
    );
    await pool.query('DELETE FROM app_user WHERE id = $1', [userId]);
  } finally {
    await pool.end();
  }
});

test('hotspots return map-ready areas, order by activity, enforce limits and require auth', { skip }, async (t) => {
  const app = await buildApp({
    env,
    pool: createPool(env.DATABASE_URL),
    storage: fakeStorage(),
    analyzer: fakeAnalyzer(),
    places: fakePlaces(),
  });
  t.after(() => app.close());

  const username = `hotspots_${randomBytes(6).toString('hex')}`;
  const signup = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      username,
      email: `${username}@example.com`,
      password: 'correct horse battery staple',
    },
  });

  assert.equal(signup.statusCode, 201);
  const { user, accessToken } = signup.json();
  userId = user.id as string;
  const authorization = `Bearer ${accessToken}`;

  const anonymous = await app.inject({
    method: 'GET',
    url: '/hotspots',
  });
  assert.equal(anonymous.statusCode, 401);

  const response = await app.inject({
    method: 'GET',
    url: '/hotspots?limit=5',
    headers: { authorization },
  });

  assert.equal(response.statusCode, 200);
  const result = response.json();
  assert.equal(result.limit, 5);
  assert.equal(result.reporterThreshold, 3);
  assert.ok(Array.isArray(result.areas));
  assert.ok(result.areas.length <= 5);

  for (const area of result.areas) {
    assert.equal(typeof area.areaId, 'string');
    assert.ok(Number.isFinite(area.latitude));
    assert.ok(Number.isFinite(area.longitude));
    assert.ok(area.latitude >= -90 && area.latitude <= 90);
    assert.ok(area.longitude >= -180 && area.longitude <= 180);
    // A hexagon, or one of H3's twelve pentagons, with no repeated closing corner.
    assert.ok(area.boundary.length === 6 || area.boundary.length === 5);
    assert.notDeepEqual(area.boundary[0], area.boundary.at(-1));
    for (const corner of area.boundary) {
      assert.ok(Math.abs(corner.latitude - area.latitude) < 0.01);
      assert.ok(Math.abs(corner.longitude - area.longitude) < 0.01);
    }
    assert.ok(Number.isInteger(area.distinctReporters));
    assert.ok(Number.isInteger(area.reports));
    assert.ok(!Number.isNaN(Date.parse(area.lastReportedDay)));
    assert.equal(area.isHotspot, area.distinctReporters >= result.reporterThreshold);
  }

  for (let i = 1; i < result.areas.length; i++) {
    const previous = result.areas[i - 1];
    const current = result.areas[i];

    assert.ok(
      previous.distinctReporters > current.distinctReporters ||
      (
        previous.distinctReporters === current.distinctReporters &&
        previous.reports >= current.reports
      ),
      'areas should be ordered by distinct reporters, then report count',
    );
  }

  const limited = await app.inject({
    method: 'GET',
    url: '/hotspots?limit=2',
    headers: { authorization },
  });
  assert.equal(limited.statusCode, 200);
  assert.equal(limited.json().limit, 2);
  assert.ok(limited.json().areas.length <= 2);

  const invalidLimit = await app.inject({
    method: 'GET',
    url: '/hotspots?limit=251',
    headers: { authorization },
  });
  assert.equal(invalidLimit.statusCode, 400);

  // Near an area, only areas whose center is within the radius come back.
  const [busiest] = result.areas;
  if (busiest) {
    const near = await app.inject({
      method: 'GET',
      url: `/hotspots?latitude=${busiest.latitude}&longitude=${busiest.longitude}&radiusM=1`,
      headers: { authorization },
    });
    assert.equal(near.statusCode, 200);
    assert.deepEqual(near.json().areas.map((a: { areaId: string }) => a.areaId), [busiest.areaId]);
  }

  const partialNear = await app.inject({
    method: 'GET',
    url: '/hotspots?latitude=40.7&longitude=-74',
    headers: { authorization },
  });
  assert.equal(partialNear.statusCode, 400);
  assert.equal(partialNear.json().code, 'INVALID_NEAR_FILTER');
});
