import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/lib/db.ts';
import {
  type FakeStorage,
  fakeStorage,
  PNG_BYTES,
  testEnv as env,
} from './helpers.ts';

const skip = process.env.DATABASE_URL
  ? false
  : 'needs DATABASE_URL; run with `infisical run -- npm test`';

const createdUserIds: string[] = [];
const createdFileIds: string[] = [];
const createdReportIds: string[] = [];
const createdQuestIds: string[] = [];
const createdPartyIds: string[] = [];

type App = Awaited<ReturnType<typeof buildApp>>;

async function startApp(t: {
  after: (fn: () => Promise<unknown>) => void;
}) {
  const storage = fakeStorage();
  const app = await buildApp({
    env,
    pool: createPool(env.DATABASE_URL),
    storage,
  });
  t.after(() => app.close());
  return { app, storage };
}

async function signUp(app: App) {
  const username = `party_${randomBytes(6).toString('hex')}`;
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
    userId: user.id as string,
    authorization: `Bearer ${accessToken}`,
  };
}

async function uploadPhoto(
  app: App,
  storage: FakeStorage,
  authorization: string,
) {
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
  const fileId = confirmation.json().id as string;
  createdFileIds.push(fileId);
  return fileId;
}

// Test locations are isolated from normal reports in the development database.
function randomSpot() {
  return {
    latitude: -56 + Math.random(),
    longitude: -130 + Math.random(),
  };
}

async function createQuest(
  app: App,
  storage: FakeStorage,
  authorization: string,
  spot: { latitude: number; longitude: number },
) {
  const report = await app.inject({
    method: 'POST',
    url: '/reports',
    headers: { authorization },
    payload: {
      photoFileId: await uploadPhoto(app, storage, authorization),
      description: 'Integration test litter report',
      location: spot,
      categories: ['mixed'],
      hazards: [],
    },
  });

  assert.equal(report.statusCode, 201);
  const reportId = report.json().id as string;
  createdReportIds.push(reportId);

  const quest = await app.inject({
    method: 'POST',
    url: `/reports/${reportId}/quest`,
    headers: { authorization },
    payload: { title: 'Test party cleanup' },
  });

  assert.equal(quest.statusCode, 201);
  const questId = quest.json().id as string;
  createdQuestIds.push(questId);

  return questId;
}

async function createScheduledParty(
  app: App,
  authorization: string,
  questId: string,
) {
  // Leave enough lead time for the creation request to finish.
  const start = new Date(Date.now() + 3000);
  const end = new Date(start.getTime() + 10 * 60 * 1000);

  const response = await app.inject({
    method: 'POST',
    url: `/quests/${questId}/parties`,
    headers: { authorization },
    payload: {
      scheduledStart: start.toISOString(),
      scheduledEnd: end.toISOString(),
    },
  });

  assert.equal(response.statusCode, 201);
  const partyId = response.json().id as string;
  createdPartyIds.push(partyId);

  return { partyId, scheduledStart: start };
}

describe('parties', { skip }, () => {
  after(async () => {
    if (createdUserIds.length === 0) return;

    const pool = createPool(env.DATABASE_URL);

    try {
      await pool.query(
        `DELETE FROM activity_event
         WHERE user_id = ANY($1::uuid[])
            OR party_id = ANY($2::uuid[])`,
        [createdUserIds, createdPartyIds],
      );

      await pool.query(
        'DELETE FROM party WHERE id = ANY($1::uuid[])',
        [createdPartyIds],
      );

      await pool.query(
        'DELETE FROM quest WHERE id = ANY($1::uuid[])',
        [createdQuestIds],
      );

      await pool.query(
        'DELETE FROM report WHERE id = ANY($1::uuid[])',
        [createdReportIds],
      );

      await pool.query(
        'DELETE FROM file WHERE id = ANY($1::uuid[])',
        [createdFileIds],
      );

      await pool.query(
        'DELETE FROM app_user WHERE id = ANY($1::uuid[])',
        [createdUserIds],
      );
    } finally {
      await pool.end();
    }
  });

  test('scheduled check-in validates membership and location, activates the party, and records presence once per check-in', async (t) => {
    const { app, storage } = await startApp(t);
    const leader = await signUp(app);
    const stranger = await signUp(app);
    const spot = randomSpot();

    const questId = await createQuest(
      app,
      storage,
      leader.authorization,
      spot,
    );

    const { partyId, scheduledStart } = await createScheduledParty(
      app,
      leader.authorization,
      questId,
    );

    // Wait until check-in is permitted by the schedule.
    const waitMs = Math.max(0, scheduledStart.getTime() - Date.now() + 25);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));

    const url = `/parties/${partyId}/check-in`;

    const unsignedUserResponse = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: stranger.authorization },
      payload: { location: spot },
    });

    assert.equal(unsignedUserResponse.statusCode, 409);
    assert.equal(
      unsignedUserResponse.json().code,
      'PARTY_MEMBERSHIP_REQUIRED',
    );

    const outsideLocation = {
      latitude: spot.latitude + 1,
      longitude: spot.longitude,
    };

    const outsideResponse = await app.inject({
      method: 'POST',
      url,
      headers: { authorization: leader.authorization },
      payload: { location: outsideLocation },
    });

    assert.equal(outsideResponse.statusCode, 403);
    assert.equal(
      outsideResponse.json().code,
      'CHECK_IN_OUTSIDE_GEOFENCE',
    );

    const pool = createPool(env.DATABASE_URL);
    t.after(() => pool.end());

    const before = await pool.query(
      `SELECT
         (SELECT status FROM party WHERE id = $1) AS party_status,
         (SELECT status FROM party_member
          WHERE party_id = $1 AND user_id = $2) AS member_status,
         (SELECT count(*)::int FROM presence_ping
          WHERE party_id = $1) AS ping_count,
         (SELECT count(*)::int FROM activity_event
          WHERE party_id = $1 AND kind = 'party_checked_in') AS checkin_events`,
      [partyId, leader.userId],
    );

    assert.equal(before.rows[0].party_status, 'scheduled');
    assert.equal(before.rows[0].member_status, 'signed_up');
    assert.equal(before.rows[0].ping_count, 0);
    assert.equal(before.rows[0].checkin_events, 0);

    const checkIn = () =>
      app.inject({
        method: 'POST',
        url,
        headers: { authorization: leader.authorization },
        payload: { location: spot },
      });

    const first = await checkIn();
    assert.equal(first.statusCode, 200);

    const firstBody = first.json();
    assert.equal(firstBody.status, 'active');
    assert.ok(firstBody.startedAt);

    const leaderMember = firstBody.members.find(
      (member: { userId: string }) => member.userId === leader.userId,
    );

    assert.ok(leaderMember);
    assert.equal(leaderMember.status, 'checked_in');
    assert.ok(leaderMember.checkedInAt);

    const firstCheckInAt = leaderMember.checkedInAt;

    const firstCounts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM presence_ping
          WHERE party_id = $1 AND user_id = $2) AS ping_count,
         (SELECT count(*)::int FROM activity_event
          WHERE party_id = $1
            AND user_id = $2
            AND kind = 'party_checked_in') AS checkin_events,
         (SELECT count(*)::int FROM presence_ping
          WHERE party_id = $1 AND user_id = $2 AND on_site) AS on_site_pings`,
      [partyId, leader.userId],
    );

    assert.equal(firstCounts.rows[0].ping_count, 1);
    assert.equal(firstCounts.rows[0].checkin_events, 1);
    assert.equal(firstCounts.rows[0].on_site_pings, 1);

    // Repeating check-in refreshes the ping, without duplicating the event
    // or resetting the original check-in timestamp.
    const repeated = await checkIn();
    assert.equal(repeated.statusCode, 200);

    const repeatedMember = repeated.json().members.find(
      (member: { userId: string }) => member.userId === leader.userId,
    );

    assert.equal(repeatedMember.checkedInAt, firstCheckInAt);

    const repeatedCounts = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM presence_ping
          WHERE party_id = $1 AND user_id = $2) AS ping_count,
         (SELECT count(*)::int FROM activity_event
          WHERE party_id = $1
            AND user_id = $2
            AND kind = 'party_checked_in') AS checkin_events`,
      [partyId, leader.userId],
    );

    assert.equal(repeatedCounts.rows[0].ping_count, 2);
    assert.equal(repeatedCounts.rows[0].checkin_events, 1);

    // An on-site presence ping should refresh last_on_site_at.
    const presenceUrl = `/parties/${partyId}/presence`;
    const onSitePing = await app.inject({
      method: 'POST',
      url: presenceUrl,
      headers: { authorization: leader.authorization },
      payload: { location: spot },
    });

    assert.equal(onSitePing.statusCode, 200);
    assert.equal(onSitePing.json().onSite, true);

    const beforeOffSite = await pool.query(
      `SELECT last_on_site_at FROM party_member
       WHERE party_id = $1 AND user_id = $2`,
      [partyId, leader.userId],
    );
    const lastOnSiteBefore = beforeOffSite.rows[0].last_on_site_at as Date;

    const offSitePing = await app.inject({
      method: 'POST',
      url: presenceUrl,
      headers: { authorization: leader.authorization },
      payload: { location: outsideLocation },
    });

    assert.equal(offSitePing.statusCode, 200);
    assert.equal(offSitePing.json().onSite, false);

    const afterOffSite = await pool.query(
      `SELECT last_on_site_at,
              (SELECT count(*)::int FROM presence_ping
               WHERE party_id = $1 AND user_id = $2 AND on_site = false) AS off_site_count
       FROM party_member
       WHERE party_id = $1 AND user_id = $2`,
      [partyId, leader.userId],
    );

    assert.equal(
      (afterOffSite.rows[0].last_on_site_at as Date).getTime(),
      lastOnSiteBefore.getTime(),
    );
    assert.equal(afterOffSite.rows[0].off_site_count, 1);

    // Prepare an after photo, then verify only the leader can end the party.
    const afterPhotoFileId = await uploadPhoto(
      app,
      storage,
      leader.authorization,
    );

    const forbiddenEnd = await app.inject({
      method: 'POST',
      url: `/parties/${partyId}/end`,
      headers: { authorization: stranger.authorization },
      payload: {
        afterPhotoFileId,
        bagCount: 2,
        outcome: 'completed',
      },
    });

    assert.equal(forbiddenEnd.statusCode, 403);
    assert.equal(forbiddenEnd.json().code, 'PARTY_LEADER_REQUIRED');

    // Set deterministic on-site timestamps for XP calculation:
    // 1 minute on site in a 10-minute scheduled event should earn 10 XP.
    await pool.query(
      `UPDATE party_member
       SET checked_in_at = statement_timestamp() - interval '2 minutes',
           last_on_site_at = statement_timestamp() - interval '1 minute'
       WHERE party_id = $1 AND user_id = $2`,
      [partyId, leader.userId],
    );

    const endRequest = () =>
      app.inject({
        method: 'POST',
        url: `/parties/${partyId}/end`,
        headers: { authorization: leader.authorization },
        payload: {
          afterPhotoFileId,
          bagCount: 2,
          outcome: 'completed',
        },
      });

    // Race two finish requests. Exactly one must succeed.
    const [attemptA, attemptB] = await Promise.all([
      endRequest(),
      endRequest(),
    ]);

    assert.deepEqual(
      [attemptA.statusCode, attemptB.statusCode].sort((a, b) => a - b),
      [200, 409],
    );

    const rejectedAttempt = [attemptA, attemptB].find(
      (response) => response.statusCode === 409,
    )!;
    assert.equal(rejectedAttempt.json().code, 'PARTY_NOT_ACTIVE');

    const end = [attemptA, attemptB].find(
      (response) => response.statusCode === 200,
    )!;
    const endedParty = end.json();
    assert.equal(endedParty.status, 'completed');
    assert.equal(endedParty.bagCount, 2);
    assert.equal(endedParty.afterPhotoFileId, afterPhotoFileId);
    assert.ok(endedParty.endedAt);

    const finalState = await pool.query(
      `SELECT
         q.status AS quest_status,
         q.completed_at,
         u.total_xp,
         (SELECT count(*)::int FROM activity_event
          WHERE party_id = $1 AND kind = 'party_ended') AS ended_events,
         (SELECT count(*)::int FROM activity_event
          WHERE party_id = $1 AND kind = 'party_xp_awarded') AS xp_events,
         (SELECT xp FROM activity_event
          WHERE party_id = $1
            AND user_id = $2
            AND kind = 'party_xp_awarded'
          ORDER BY occurred_at DESC LIMIT 1) AS awarded_xp,
         (SELECT minutes_on_site FROM activity_event
          WHERE party_id = $1
            AND user_id = $2
            AND kind = 'party_xp_awarded'
          ORDER BY occurred_at DESC LIMIT 1) AS minutes_on_site
       FROM quest q
       JOIN app_user u ON u.id = $2
       WHERE q.id = $3`,
      [partyId, leader.userId, questId],
    );

    assert.equal(finalState.rows[0].quest_status, 'completed');
    assert.ok(finalState.rows[0].completed_at);
    assert.equal(finalState.rows[0].total_xp, 10);
    assert.equal(finalState.rows[0].ended_events, 1);
    assert.equal(finalState.rows[0].xp_events, 1);
    assert.equal(finalState.rows[0].awarded_xp, 10);
    assert.equal(finalState.rows[0].minutes_on_site, 1);

    // A second attempt to end the party must not award XP again.
    const duplicateEnd = await app.inject({
      method: 'POST',
      url: `/parties/${partyId}/end`,
      headers: { authorization: leader.authorization },
      payload: {
        afterPhotoFileId,
        bagCount: 2,
        outcome: 'completed',
      },
    });

    assert.equal(duplicateEnd.statusCode, 409);
    assert.equal(duplicateEnd.json().code, 'PARTY_NOT_ACTIVE');

    const xpAfterDuplicate = await pool.query(
      `SELECT total_xp FROM app_user WHERE id = $1`,
      [leader.userId],
    );
    assert.equal(xpAfterDuplicate.rows[0].total_xp, 10);
  });

  test('a partial cleanup awards XP but leaves the quest open', async (t) => {
    const { app, storage } = await startApp(t);
    const leader = await signUp(app);
    const spot = randomSpot();

    const questId = await createQuest(
      app,
      storage,
      leader.authorization,
      spot,
    );

    const { partyId, scheduledStart } = await createScheduledParty(
      app,
      leader.authorization,
      questId,
    );

    const waitMs = Math.max(0, scheduledStart.getTime() - Date.now() + 25);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));

    const checkIn = await app.inject({
      method: 'POST',
      url: `/parties/${partyId}/check-in`,
      headers: { authorization: leader.authorization },
      payload: { location: spot },
    });

    assert.equal(checkIn.statusCode, 200);
    assert.equal(checkIn.json().status, 'active');

    const afterPhotoFileId = await uploadPhoto(
      app,
      storage,
      leader.authorization,
    );

    const pool = createPool(env.DATABASE_URL);
    t.after(() => pool.end());

    // Make the eligible time deterministic: 1 minute on-site during a
    // 10-minute scheduled event should award 10 XP.
    await pool.query(
      `UPDATE party_member
       SET checked_in_at = statement_timestamp() - interval '2 minutes',
           last_on_site_at = statement_timestamp() - interval '1 minute'
       WHERE party_id = $1 AND user_id = $2`,
      [partyId, leader.userId],
    );

    const end = await app.inject({
      method: 'POST',
      url: `/parties/${partyId}/end`,
      headers: { authorization: leader.authorization },
      payload: {
        afterPhotoFileId,
        bagCount: 1,
        outcome: 'partial',
      },
    });

    assert.equal(end.statusCode, 200);
    assert.equal(end.json().status, 'partial');
    assert.equal(end.json().bagCount, 1);
    assert.equal(end.json().afterPhotoFileId, afterPhotoFileId);

    const state = await pool.query(
      `SELECT
         q.status AS quest_status,
         q.completed_at,
         u.total_xp,
         (SELECT count(*)::int FROM activity_event
          WHERE party_id = $1 AND kind = 'party_ended') AS ended_events,
         (SELECT count(*)::int FROM activity_event
          WHERE party_id = $1 AND kind = 'party_xp_awarded') AS xp_events,
         (SELECT count(*)::int FROM activity_event
          WHERE party_id = $1 AND kind = 'quest_completed') AS quest_completed_events,
         (SELECT xp FROM activity_event
          WHERE party_id = $1
            AND user_id = $2
            AND kind = 'party_xp_awarded'
          ORDER BY occurred_at DESC LIMIT 1) AS awarded_xp
       FROM quest q
       JOIN app_user u ON u.id = $2
       WHERE q.id = $3`,
      [partyId, leader.userId, questId],
    );

    assert.equal(state.rows[0].quest_status, 'open');
    assert.equal(state.rows[0].completed_at, null);
    assert.equal(state.rows[0].total_xp, 10);
    assert.equal(state.rows[0].ended_events, 1);
    assert.equal(state.rows[0].xp_events, 1);
    assert.equal(state.rows[0].quest_completed_events, 0);
    assert.equal(state.rows[0].awarded_xp, 10);
  });


  test('party ending rejects another user’s photo and prevents photo reuse', async (t) => {
    const { app, storage } = await startApp(t);
    const leader = await signUp(app);
    const otherUser = await signUp(app);
    const spot = randomSpot();

    const questId = await createQuest(
      app,
      storage,
      leader.authorization,
      spot,
    );

    const firstParty = await createScheduledParty(
      app,
      leader.authorization,
      questId,
    );

    await new Promise<void>((resolve) =>
      setTimeout(
        resolve,
        Math.max(0, firstParty.scheduledStart.getTime() - Date.now() + 25),
      ),
    );

    const firstCheckIn = await app.inject({
      method: 'POST',
      url: `/parties/${firstParty.partyId}/check-in`,
      headers: { authorization: leader.authorization },
      payload: { location: spot },
    });

    assert.equal(firstCheckIn.statusCode, 200);

    const foreignPhotoId = await uploadPhoto(
      app,
      storage,
      otherUser.authorization,
    );

    const foreignPhotoAttempt = await app.inject({
      method: 'POST',
      url: `/parties/${firstParty.partyId}/end`,
      headers: { authorization: leader.authorization },
      payload: {
        afterPhotoFileId: foreignPhotoId,
        bagCount: 1,
        outcome: 'partial',
      },
    });

    assert.equal(foreignPhotoAttempt.statusCode, 400);
    assert.equal(
      foreignPhotoAttempt.json().code,
      'AFTER_PHOTO_NOT_AVAILABLE',
    );

    const ownPhotoId = await uploadPhoto(
      app,
      storage,
      leader.authorization,
    );

    const firstEnd = await app.inject({
      method: 'POST',
      url: `/parties/${firstParty.partyId}/end`,
      headers: { authorization: leader.authorization },
      payload: {
        afterPhotoFileId: ownPhotoId,
        bagCount: 1,
        outcome: 'partial',
      },
    });

    assert.equal(firstEnd.statusCode, 200);
    assert.equal(firstEnd.json().status, 'partial');

    // The quest stays open after a partial cleanup, so it can have another party.
    const secondParty = await createScheduledParty(
      app,
      leader.authorization,
      questId,
    );

    await new Promise<void>((resolve) =>
      setTimeout(
        resolve,
        Math.max(0, secondParty.scheduledStart.getTime() - Date.now() + 25),
      ),
    );

    const secondCheckIn = await app.inject({
      method: 'POST',
      url: `/parties/${secondParty.partyId}/check-in`,
      headers: { authorization: leader.authorization },
      payload: { location: spot },
    });

    assert.equal(secondCheckIn.statusCode, 200);

    const reuseAttempt = await app.inject({
      method: 'POST',
      url: `/parties/${secondParty.partyId}/end`,
      headers: { authorization: leader.authorization },
      payload: {
        afterPhotoFileId: ownPhotoId,
        bagCount: 1,
        outcome: 'completed',
      },
    });

    assert.equal(reuseAttempt.statusCode, 409);
    assert.equal(reuseAttempt.json().code, 'PHOTO_ALREADY_USED');
  });

});
