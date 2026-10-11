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
        'DELETE FROM app_user WHERE id = ANY($1::uuid[])',
        [createdUserIds],
      );
    } finally {
      await pool.end();
    }
  });

  test('ranks XP, handles ties and limits, and requires authentication', async (t) => {
    const app = await startApp(t);
    const suffix = randomBytes(6).toString('hex');

    async function signUp(label: string) {
      const username = `lb_${label}_${suffix}`;
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

    const first = await signUp('a');
    const second = await signUp('b');
    const third = await signUp('c');

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

    assert.equal(result.limit, 20);
    assert.ok(result.entries.length >= 3);
    assert.deepEqual(
      result.entries.slice(0, 3).map(
        (entry: {
          rank: number;
          userId: string;
          username: string;
          totalXp: number;
        }) => ({
          rank: entry.rank,
          userId: entry.userId,
          username: entry.username,
          totalXp: entry.totalXp,
        }),
      ),
      [
        { rank: 1, userId: first.id, username: first.username, totalXp: 2_000_000_000 },
        { rank: 1, userId: second.id, username: second.username, totalXp: 2_000_000_000 },
        { rank: 3, userId: third.id, username: third.username, totalXp: 1_999_999_999 },
      ],
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
});
