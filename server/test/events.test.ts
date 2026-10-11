import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/lib/db.ts';
import { maxXpForSchedule, xpFor } from '../src/lib/xp.ts';
import { type FakeStorage, fakeAnalyzer, fakePlaces, fakePool, fakeStorage, PNG_BYTES, testEnv as env } from './helpers.ts';

test('XP is 100 per hour on site, scaled by tier and capped at 3 hours', () => {
  assert.equal(xpFor('easy', 60), 100);
  assert.equal(xpFor('medium', 60), 150);
  assert.equal(xpFor('hard', 90), 300);
  assert.equal(xpFor('legendary', 30), 150);
  assert.equal(xpFor('easy', 600), 300);
  assert.equal(xpFor('easy', -5), 0);
  assert.equal(maxXpForSchedule('hard', new Date('2026-01-01T10:00Z'), new Date('2026-01-01T12:00Z')), 400);
});

test('GET /events without a token returns 401', async () => {
  const app = await buildApp({ env, pool: fakePool(), storage: fakeStorage(), analyzer: fakeAnalyzer(), places: fakePlaces() });
  try {
    const res = await app.inject({ method: 'GET', url: '/events?latitude=40.7&longitude=-74' });
    assert.equal(res.statusCode, 401);
  } finally {
    await app.close();
  }
});

// These tests run against the real database and clean up everything they create.
// Run them with `infisical run -- npm test`; without DATABASE_URL they are skipped.
const skip = process.env.DATABASE_URL ? false : 'needs DATABASE_URL; run with `infisical run -- npm test`';

type App = Awaited<ReturnType<typeof buildApp>>;

describe('events', { skip }, () => {
  const createdUserIds: string[] = [];

  after(async () => {
    const pool = createPool(env.DATABASE_URL);
    const users = [createdUserIds];
    // party_member rows go with the party (ON DELETE CASCADE).
    await pool.query('DELETE FROM party WHERE leader_user_id = ANY($1)', users);
    await pool.query('DELETE FROM quest WHERE created_by_user_id = ANY($1)', users);
    await pool.query('DELETE FROM activity_event WHERE user_id = ANY($1)', users);
    await pool.query('DELETE FROM report WHERE reporter_user_id = ANY($1)', users);
    await pool.query('DELETE FROM file WHERE uploaded_by_user_id = ANY($1)', users);
    await pool.query('DELETE FROM app_user WHERE id = ANY($1)', users);
    await pool.end();
  });

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
    return { userId: user.id as string, email: user.email as string, authorization: `Bearer ${accessToken}` };
  }

  async function createQuest(app: App, storage: FakeStorage, authorization: string, spot: object) {
    const upload = await app.inject({
      method: 'POST',
      url: '/uploads',
      headers: { authorization },
      payload: { contentType: 'image/png', sizeBytes: PNG_BYTES.length },
    });
    storage.put(upload.json().key, 'image/png', PNG_BYTES);
    const file = await app.inject({
      method: 'POST',
      url: '/files',
      headers: { authorization },
      payload: { key: upload.json().key },
    });
    const report = await app.inject({
      method: 'POST',
      url: '/reports',
      headers: { authorization },
      payload: {
        photoFileId: file.json().id,
        description: 'Bottles under the bench',
        location: spot,
        placeName: 'Bench by the gate',
        categories: ['plastic'],
        hazards: ['broken_glass'],
      },
    });
    assert.equal(report.statusCode, 201);
    const quest = await app.inject({
      method: 'POST',
      url: `/reports/${report.json().id}/quest`,
      headers: { authorization },
      payload: { title: 'Clear the bench' },
    });
    assert.equal(quest.statusCode, 201);
    return quest.json().id as string;
  }

  test('schedule, list, join and leave an event; only the organizer sees emails', async (t) => {
    const storage = fakeStorage();
    const app = await buildApp({ env, pool: createPool(env.DATABASE_URL), storage, analyzer: fakeAnalyzer(), places: fakePlaces() });
    t.after(() => app.close());

    const organizer = await signUp(app);
    const volunteer = await signUp(app);
    // A random spot in the Southern Ocean, so runs never see each other's data.
    const spot = { latitude: -56 + Math.random(), longitude: -130 + Math.random() };
    const questId = await createQuest(app, storage, organizer.authorization, spot);

    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 2 * 3_600_000);
    const created = await app.inject({
      method: 'POST',
      url: `/quests/${questId}/events`,
      headers: { authorization: organizer.authorization },
      payload: { scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() },
    });
    assert.equal(created.statusCode, 201);
    const event = created.json();
    assert.equal(event.title, 'Clear the bench');
    assert.equal(event.placeName, 'Bench by the gate');
    assert.equal(event.organizer.id, organizer.userId);
    assert.equal(event.isOrganizer, true);
    assert.equal(event.difficultyTier, 'hard');
    assert.equal(event.maxXp, 400);
    assert.equal(event.attendeeCount, 1);

    const list = await app.inject({
      method: 'GET',
      url: `/events?latitude=${spot.latitude}&longitude=${spot.longitude}&radiusM=1000`,
      headers: { authorization: volunteer.authorization },
    });
    assert.equal(list.statusCode, 200);
    const listed = list.json().events.find((e: { id: string }) => e.id === event.id);
    assert.equal(listed.distanceM, 0);
    assert.equal(listed.joined, false);

    const joined = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/join`,
      headers: { authorization: volunteer.authorization },
    });
    assert.equal(joined.statusCode, 200);
    assert.equal(joined.json().joined, true);
    assert.equal(joined.json().attendeeCount, 2);
    // A volunteer sees who is coming but not their emails.
    assert.ok(joined.json().attendees.every((a: object) => !('email' in a)));

    const asOrganizer = await app.inject({
      method: 'GET',
      url: `/events/${event.id}`,
      headers: { authorization: organizer.authorization },
    });
    const emails = asOrganizer.json().attendees.map((a: { email: string }) => a.email).sort();
    assert.deepEqual(emails, [organizer.email, volunteer.email].sort());

    const organizerLeaves = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/join`,
      headers: { authorization: organizer.authorization },
    });
    assert.equal(organizerLeaves.statusCode, 409);
    assert.equal(organizerLeaves.json().code, 'ORGANIZER_CANNOT_LEAVE');

    const left = await app.inject({
      method: 'DELETE',
      url: `/events/${event.id}/join`,
      headers: { authorization: volunteer.authorization },
    });
    assert.equal(left.statusCode, 200);
    assert.equal(left.json().joined, false);
    assert.equal(left.json().attendeeCount, 1);
  });

  test('scheduling rejects a start in the past', async (t) => {
    const storage = fakeStorage();
    const app = await buildApp({ env, pool: createPool(env.DATABASE_URL), storage, analyzer: fakeAnalyzer(), places: fakePlaces() });
    t.after(() => app.close());

    const organizer = await signUp(app);
    const spot = { latitude: -56 + Math.random(), longitude: -130 + Math.random() };
    const questId = await createQuest(app, storage, organizer.authorization, spot);
    const res = await app.inject({
      method: 'POST',
      url: `/quests/${questId}/events`,
      headers: { authorization: organizer.authorization },
      payload: { scheduledStart: '2020-01-01T10:00:00Z', scheduledEnd: '2020-01-01T12:00:00Z' },
    });
    assert.equal(res.statusCode, 400);
    assert.equal(res.json().code, 'START_IN_PAST');
  });

  test('concurrent scheduling retries create one party and preserve its organizer membership', async (t) => {
    const storage = fakeStorage();
    const app = await buildApp({ env, pool: createPool(env.DATABASE_URL), storage, analyzer: fakeAnalyzer(), places: fakePlaces() });
    t.after(() => app.close());
    const organizer = await signUp(app);
    const other = await signUp(app);
    const spot = { latitude: -56 + Math.random(), longitude: -130 + Math.random() };
    const questId = await createQuest(app, storage, organizer.authorization, spot);
    const start = new Date(Date.now() + 86_400_000);
    const end = new Date(start.getTime() + 3_600_000);
    const schedule = (authorization: string, scheduledEnd = end.toISOString()) => app.inject({
      method: 'POST', url: `/quests/${questId}/events`, headers: { authorization },
      payload: { scheduledStart: start.toISOString(), scheduledEnd },
    });
    const responses = await Promise.all([schedule(organizer.authorization), schedule(organizer.authorization)]);
    for (const response of responses) assert.equal(response.statusCode, 201);
    const eventId = responses[0]!.json().id;
    assert.equal(responses[1]!.json().id, eventId);
    const retry = await schedule(organizer.authorization);
    assert.equal(retry.statusCode, 201);
    assert.equal(retry.json().id, eventId);
    assert.equal(retry.json().attendeeCount, 1);
    const count = await app.db.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM party WHERE quest_id = $1`, [questId],
    );
    assert.equal(count.rows[0]!.count, 1);
    const membership = await app.db.query<{ count: number }>(
      `SELECT count(*)::integer AS count FROM party_member WHERE party_id = $1`, [eventId],
    );
    assert.equal(membership.rows[0]!.count, 1);
    const anotherOrganizer = await schedule(other.authorization);
    assert.equal(anotherOrganizer.statusCode, 201);
    assert.notEqual(anotherOrganizer.json().id, eventId);
    const anotherTime = await schedule(organizer.authorization, new Date(end.getTime() + 3_600_000).toISOString());
    assert.equal(anotherTime.statusCode, 201);
    assert.notEqual(anotherTime.json().id, eventId);

    // The original request may be retried after its start time has passed.
    start.setTime(Date.now() - 1_800_000);
    end.setTime(Date.now() + 1_800_000);
    await app.db.query(
      `UPDATE party SET scheduled_start = $2, scheduled_end = $3, status = 'active', started_at = $2
       WHERE id = $1`, [eventId, start, end],
    );
    await app.db.query(
      `UPDATE party_member SET status = 'checked_in', checked_in_at = $2 WHERE party_id = $1`, [eventId, start],
    );
    const activeRetry = await schedule(organizer.authorization);
    assert.equal(activeRetry.statusCode, 201);
    assert.equal(activeRetry.json().id, eventId);
    assert.equal(activeRetry.json().status, 'active');
  });
});
