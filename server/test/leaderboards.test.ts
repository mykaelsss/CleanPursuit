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
    assert.deepEqual(result.me, { rank: 1, xp: 2_000_000_000, totalXp: 2_000_000_000 });
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
      headers: { authorization: third.authorization },
    });

    assert.equal(limited.statusCode, 200);
    assert.equal(limited.json().limit, 2);
    assert.equal(limited.json().entries.length, 2);
    assert.deepEqual(limited.json().me, { rank: 3, xp: 1_999_999_999, totalXp: 1_999_999_999 });

    const unranked = await signUp(app, 'zero');
    const zero = await app.inject({
      method: 'GET',
      url: '/leaderboards',
      headers: { authorization: unranked.authorization },
    });
    assert.equal(zero.statusCode, 200);
    assert.deepEqual(zero.json().me, { rank: null, xp: 0, totalXp: 0 });

    await app.db.query('DELETE FROM app_user WHERE id = $1', [unranked.id]);
    const deleted = await app.inject({
      method: 'GET',
      url: '/leaderboards',
      headers: { authorization: unranked.authorization },
    });
    assert.equal(deleted.statusCode, 401);
    assert.equal(deleted.json().code, 'INVALID_ACCESS_TOKEN');

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
    const inactive = await signUp(app, 'inactive');

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
    await app.db.query('UPDATE app_user SET total_xp = 42 WHERE id = $1', [inactive.id]);

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
      assert.deepEqual(result.me, { rank: 1, xp: 2_000_000_000, totalXp: 7 }, period);
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

      const limited = await app.inject({
        method: 'GET',
        url: `/leaderboards?period=${period}&limit=1`,
        headers: { authorization: second.authorization },
      });
      assert.equal(limited.statusCode, 200);
      assert.equal(limited.json().entries.length, 1);
      assert.equal(limited.json().entries[0].userId, first.id);
      assert.deepEqual(limited.json().me, { rank: 1, xp: 2_000_000_000, totalXp: 0 }, period);

      const outside = await app.inject({
        method: 'GET',
        url: `/leaderboards?period=${period}&limit=1`,
        headers: { authorization: third.authorization },
      });
      assert.equal(outside.statusCode, 200);
      assert.deepEqual(outside.json().me, { rank: 3, xp: 1_999_999_999, totalXp: 0 }, period);

      for (const [user, xp, totalXp] of [[negative, -5, 0], [inactive, 0, 42]] as const) {
        const unranked = await app.inject({
          method: 'GET',
          url: `/leaderboards?period=${period}`,
          headers: { authorization: user.authorization },
        });
        assert.equal(unranked.statusCode, 200);
        assert.deepEqual(unranked.json().me, { rank: null, xp, totalXp }, period);
      }
    }

    const invalidPeriod = await app.inject({
      method: 'GET',
      url: '/leaderboards?period=year',
      headers: { authorization: first.authorization },
    });
    assert.equal(invalidPeriod.statusCode, 400);
  });

  test('personal period XP excludes previous buckets and treats net-zero XP as unranked', async (t) => {
    const app = await startApp(t);

    for (const [period, bucket] of [['day', '1 day'], ['week', '1 week'], ['month', '1 month']] as const) {
      const user = await signUp(app, `boundary_${period}`);
      await app.db.query(
        `INSERT INTO activity_event (kind, user_id, xp, occurred_at)
         VALUES ('xp_adjustment', $1, 100, time_bucket($2::interval, now()) - interval '1 millisecond'),
                ('xp_adjustment', $1, 5, now()),
                ('xp_adjustment', $1, -5, now())`,
        [user.id, bucket],
      );
      await app.db.query('UPDATE app_user SET total_xp = 100 WHERE id = $1', [user.id]);

      const response = await app.inject({
        method: 'GET',
        url: `/leaderboards?period=${period}&limit=100`,
        headers: { authorization: user.authorization },
      });
      assert.equal(response.statusCode, 200, period);
      assert.deepEqual(response.json().me, { rank: null, xp: 0, totalXp: 100 }, period);
      assert.ok(!response.json().entries.some((entry: { userId: string }) => entry.userId === user.id), period);

      const allTime = await app.inject({
        method: 'GET',
        url: '/leaderboards?period=all',
        headers: { authorization: user.authorization },
      });
      assert.equal(allTime.statusCode, 200);
      assert.equal(allTime.json().me.xp, 100);
      assert.ok(allTime.json().me.rank > 0);
    }
  });
});
