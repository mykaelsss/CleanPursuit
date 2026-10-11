import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/lib/db.ts';
import { fakeAnalyzer, fakePool, fakeStorage, testEnv as env } from './helpers.ts';

test('GET /leaderboard without a token returns 401', async () => {
  const app = await buildApp({ env, pool: fakePool(), storage: fakeStorage(), analyzer: fakeAnalyzer() });
  try {
    const res = await app.inject({ method: 'GET', url: '/leaderboard' });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().code, 'MISSING_ACCESS_TOKEN');
  } finally {
    await app.close();
  }
});

// These tests run against the real database and clean up the users they create.
// Run them with `infisical run -- npm test`; without DATABASE_URL they are skipped.
const skip = process.env.DATABASE_URL ? false : 'needs DATABASE_URL; run with `infisical run -- npm test`';

describe('leaderboard', { skip }, () => {
  const createdUsernames: string[] = [];

  after(async () => {
    const pool = createPool(env.DATABASE_URL);
    await pool.query('DELETE FROM app_user WHERE username = ANY($1)', [createdUsernames]);
    await pool.end();
  });

  test('ranks users by XP, most first, with ties sharing a rank', async (t) => {
    const pool = createPool(env.DATABASE_URL);
    const app = await buildApp({ env, pool, storage: fakeStorage(), analyzer: fakeAnalyzer() });
    t.after(() => app.close());

    // XP far above demo users. The period leaderboard tests may create higher
    // scores concurrently on the shared DEV database, so these need not rank first.
    const base = 1_000_000_000 + Math.floor(Math.random() * 1_000_000);
    const players = [
      { xp: base + 2, accessToken: '', username: '' },
      { xp: base, accessToken: '', username: '' },
      { xp: base, accessToken: '', username: '' },
    ];
    for (const player of players) {
      player.username = `test_${randomBytes(6).toString('hex')}`;
      createdUsernames.push(player.username);
      const res = await app.inject({
        method: 'POST',
        url: '/auth/register',
        payload: { username: player.username, email: `${player.username}@example.com`, password: 'correct horse battery staple' },
      });
      player.accessToken = res.json().accessToken;
      await pool.query('UPDATE app_user SET total_xp = $2 WHERE username = $1', [player.username, player.xp]);
    }

    const res = await app.inject({
      method: 'GET',
      url: '/leaderboard?limit=100',
      headers: { authorization: `Bearer ${players[2]!.accessToken}` },
    });
    assert.equal(res.statusCode, 200);
    const { entries, me } = res.json();

    const ownEntries = entries.filter((entry: { user: { username: string } }) =>
      players.some((player) => player.username === entry.user.username),
    );
    assert.equal(ownEntries.length, 3);
    const firstRank = ownEntries[0].rank;
    assert.ok(firstRank >= 1);
    const tied = [players[1]!.username, players[2]!.username].sort();
    assert.deepEqual(
      ownEntries.map((e: { rank: number; user: { username: string }; totalXp: number }) => [e.rank, e.user.username, e.totalXp]),
      [
        [firstRank, players[0]!.username, base + 2],
        [firstRank + 1, tied[0], base],
        [firstRank + 1, tied[1], base],
      ],
    );
    assert.deepEqual(me, { rank: firstRank + 1, totalXp: base });
    // Only the summary leaves the API: no email.
    assert.deepEqual(Object.keys(entries[0].user).sort(), ['id', 'username']);
  });
});
