import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/lib/db.ts';
import { fakeAnalyzer, fakeStorage, testEnv as env } from './helpers.ts';

const skip = process.env.DATABASE_URL
  ? false
  : 'needs DATABASE_URL; run with `infisical run -- npm test`';

const createdUserIds: string[] = [];

type App = Awaited<ReturnType<typeof buildApp>>;

async function startApp(t: {
  after: (fn: () => Promise<unknown>) => void;
}) {
  const app = await buildApp({
    env,
    pool: createPool(env.DATABASE_URL),
    storage: fakeStorage(),
    analyzer: fakeAnalyzer(),
  });

  t.after(() => app.close());
  return app;
}

describe('leaderboards', { skip }, () => {
  after(async () => {
    if (createdUserIds.length === 0) return;

    const pool = createPool(env.DATABASE_URL);

    try {
      await pool.query(
        'DELETE FROM activity_event WHERE user_id = ANY($1::uuid[])',
        [createdUserIds],
      );
      await pool.query(
        'DELETE FROM app_user WHERE id = ANY($1::uuid[])',
        [createdUserIds],
      );
    } finally {
      await pool.end();
    }
  });

  async function signUp(app: App, label: string) {
    const username = `lb_${label}_${randomBytes(6).toString('hex')}`;
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
    createdUserIds.push(user.id);

    return {
      id: user.id as string,
      username: user.username as string,
      authorization: `Bearer ${accessToken}`,
    };
  }

  test('ranks all-time XP, handles ties and limits, and requires authentication', async (t) => {
    const app = await startApp(t);

    const first = await signUp(app, 'a');
    const second = await signUp(app, 'b');
    const third = await signUp(app, 'c');

    // Controlled values make ordering and rank ties deterministic.
    await app.db.query(
      'UPDATE app_user SET total_xp = $2 WHERE id = $1',
      [first.id, 2_000_000_000],
    );
    await app.db.query(
      'UPDATE app_user SET total_xp = $2 WHERE id = $1',
      [second.id, 2_000_000_000],
    );
    await app.db.query(
      'UPDATE app_user SET total_xp = $2 WHERE id = $1',
      [third.id, 1_999_999_999],
    );

    const anonymous = await app.inject({
      method: 'GET',
      url: '/leaderboards',
    });
    assert.equal(anonymous.statusCode, 401);

    const response = await app.inject({
      method: 'GET',
      url: '/leaderboards',
      headers: { authorization: first.authorization },
    });

    assert.equal(response.statusCode, 200);
    const result = response.json();

    assert.equal(result.period, 'all');
    assert.equal(result.periodStart, null);
    assert.equal(result.limit, 20);
    assert.ok(result.entries.length >= 3);
    assert.deepEqual(result.entries.slice(0, 3), [
      { rank: 1, userId: first.id, username: first.username, xp: 2_000_000_000, totalXp: 2_000_000_000 },
      { rank: 1, userId: second.id, username: second.username, xp: 2_000_000_000, totalXp: 2_000_000_000 },
      { rank: 3, userId: third.id, username: third.username, xp: 1_999_999_999, totalXp: 1_999_999_999 },
    ]);
    assert.ok(
      result.entries.every((entry: { totalXp: number }) => entry.totalXp > 0),
      'users without XP are left off the board',
    );

    const limited = await app.inject({
      method: 'GET',
      url: '/leaderboards?limit=2',
      headers: { authorization: first.authorization },
    });

    assert.equal(limited.statusCode, 200);
    assert.equal(limited.json().limit, 2);
    assert.equal(limited.json().entries.length, 2);

    const invalidLimit = await app.inject({
      method: 'GET',
      url: '/leaderboards?limit=101',
      headers: { authorization: first.authorization },
    });
    assert.equal(invalidLimit.statusCode, 400);
  });

  test('ranks XP earned today, this week and this month from the aggregates', async (t) => {
    const app = await startApp(t);

    const first = await signUp(app, 'd');
    const second = await signUp(app, 'e');
    const third = await signUp(app, 'f');
    const negative = await signUp(app, 'g');

    // Large values keep these users above anyone else on the shared DEV database.
    // The aggregates are real-time, so rows written now show up without a refresh.
    await app.db.query(
      `INSERT INTO activity_event (kind, user_id, xp)
       VALUES ('xp_adjustment', $1, 1000000000),
              ('xp_adjustment', $1, 1000000000),
              ('xp_adjustment', $2, 2000000000),
              ('xp_adjustment', $3, 1999999999),
              ('xp_adjustment', $4, -5)`,
      [first.id, second.id, third.id, negative.id],
    );
    await app.db.query(
      `UPDATE app_user SET total_xp = 7 WHERE id = $1`,
      [first.id],
    );

    const now = new Date();
    const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    const expectedStarts = {
      day: new Date(today),
      week: new Date(today - ((now.getUTCDay() + 6) % 7) * 86_400_000),
      month: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    };

    for (const period of ['day', 'week', 'month'] as const) {
      const response = await app.inject({
        method: 'GET',
        url: `/leaderboards?period=${period}&limit=100`,
        headers: { authorization: first.authorization },
      });

      assert.equal(response.statusCode, 200, period);
      const result = response.json();

      assert.equal(result.period, period);
      assert.equal(result.periodStart, expectedStarts[period].toISOString(), period);
      assert.deepEqual(
        result.entries.slice(0, 3),
        [
          { rank: 1, userId: first.id, username: first.username, xp: 2_000_000_000, totalXp: 7 },
          { rank: 1, userId: second.id, username: second.username, xp: 2_000_000_000, totalXp: 0 },
          { rank: 3, userId: third.id, username: third.username, xp: 1_999_999_999, totalXp: 0 },
        ],
        period,
      );
      assert.ok(
        !result.entries.some((entry: { userId: string }) => entry.userId === negative.id),
        `${period}: XP that nets to zero or less is left off the board`,
      );
    }

    const invalidPeriod = await app.inject({
      method: 'GET',
      url: '/leaderboards?period=year',
      headers: { authorization: first.authorization },
    });
    assert.equal(invalidPeriod.statusCode, 400);
  });
});
