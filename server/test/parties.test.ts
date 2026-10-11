import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, describe, test } from 'node:test';
import { buildApp } from '../src/app.ts';
import { createPool } from '../src/lib/db.ts';
import {
  type FakeStorage,
  fakeAnalyzer,
  fakePlaces,
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
    analyzer: fakeAnalyzer(),
    places: fakePlaces(),
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

// Replaces a member's pings with ones the given number of minutes ago and backdates
// their check-in to the first ping, so time on site is deterministic without waiting.
async function setPings(
  pool: ReturnType<typeof createPool>,
  partyId: string,
  userId: string,
  spot: { latitude: number; longitude: number },
  pings: Array<{ minutesAgo: number; onSite: boolean }>,
) {
  await pool.query(
    'DELETE FROM presence_ping WHERE party_id = $1 AND user_id = $2',
    [partyId, userId],
  );
  await pool.query(
    `WITH anchor AS (SELECT clock_timestamp() AS now),
     inserted AS (
       INSERT INTO presence_ping (party_id, user_id, recorded_at, location, on_site)
       SELECT $1, $2, anchor.now - make_interval(mins => p.minutes_ago),
              ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, p.on_site
       FROM anchor, unnest($5::int[], $6::boolean[]) AS p(minutes_ago, on_site)
       RETURNING recorded_at, on_site
     )
     UPDATE party_member
     SET checked_in_at = (SELECT min(recorded_at) FROM inserted),
         last_on_site_at = (SELECT max(recorded_at) FROM inserted WHERE on_site)
     WHERE party_id = $1 AND user_id = $2`,
    [
      partyId,
      userId,
      spot.longitude,
      spot.latitude,
      pings.map((ping) => ping.minutesAgo),
      pings.map((ping) => ping.onSite),
    ],
  );
}

async function createQuest(
  app: App,
  storage: FakeStorage,
  authorization: string,
  spot: { latitude: number; longitude: number },
  hazards: string[] = [],
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
      hazards,
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

async function walkUp(
  app: App,
  authorization: string,
  questId: string,
  location: { latitude: number; longitude: number },
) {
  const response = await app.inject({
    method: 'POST',
    url: `/quests/${questId}/walk-up`,
    headers: { authorization },
    payload: { location },
  });
  if (response.statusCode === 200) createdPartyIds.push(response.json().id);
  return response;
}

function memberOf(party: { members: Array<{ userId: string; status: string }> }, userId: string) {
  return party.members.find((member) => member.userId === userId);
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

    // 1 minute between two on-site pings in a 10-minute scheduled event earns 10 XP.
    await setPings(pool, partyId, leader.userId, spot, [
      { minutesAgo: 2, onSite: true },
      { minutesAgo: 1, onSite: true },
    ]);

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


  test('awards a capped hotspot bonus once when three distinct reporters qualify', async (t) => {
    const { app, storage } = await startApp(t);
    const leader = await signUp(app);
    const reporterA = await signUp(app);
    const reporterB = await signUp(app);
    const spot = randomSpot();

    const questId = await createQuest(
      app,
      storage,
      leader.authorization,
      spot,
    );

    const pool = createPool(env.DATABASE_URL);
    t.after(() => pool.end());

    const reportFacts = await pool.query<{
      report_id: string;
      area_id: string;
    }>(
      `SELECT q.report_id, e.area_id::text AS area_id
       FROM quest q
       JOIN activity_event e
         ON e.report_id = q.report_id
        AND e.kind = 'report_submitted'
       WHERE q.id = $1
         AND e.area_id IS NOT NULL
       ORDER BY e.occurred_at ASC
       LIMIT 1`,
      [questId],
    );

    assert.equal(reportFacts.rowCount, 1);
    const reportFact = reportFacts.rows[0];
    assert.ok(reportFact, 'expected the quest report and area');
    const { report_id: reportId, area_id: areaId } = reportFact;

    // The quest creator is the first reporter. Add two distinct reporters
    // in the same area to exercise the three-reporter hotspot threshold.
    await pool.query(
      `INSERT INTO activity_event (kind, user_id, area_id, report_id)
       VALUES
         ('report_submitted', $1, $3::h3index, $2),
         ('report_submitted', $4, $3::h3index, $2)`,
      [reporterA.userId, reportId, areaId, reporterB.userId],
    );

    const hotspot = await pool.query<{ distinct_reporters: number | string }>(
      `SELECT distinct_reporters
       FROM area_hotspot_30d
       WHERE area_id = $1::h3index`,
      [areaId],
    );

    assert.ok(
      Number(hotspot.rows[0]?.distinct_reporters ?? 0) >= 3,
      'the test area should meet the three-distinct-reporter threshold',
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

    const afterPhotoFileId = await uploadPhoto(
      app,
      storage,
      leader.authorization,
    );

    // 9 minutes between two on-site pings earns a 90 XP base award.
    await setPings(pool, partyId, leader.userId, spot, [
      { minutesAgo: 9, onSite: true },
      { minutesAgo: 0, onSite: true },
    ]);

    const end = await app.inject({
      method: 'POST',
      url: `/parties/${partyId}/end`,
      headers: { authorization: leader.authorization },
      payload: {
        afterPhotoFileId,
        bagCount: 2,
        outcome: 'completed',
      },
    });

    assert.equal(end.statusCode, 200);
    assert.equal(end.json().status, 'completed');

    const awards = await pool.query(
      `SELECT
         u.total_xp,
         (SELECT xp FROM activity_event
          WHERE party_id = $1 AND user_id = $2
            AND kind = 'party_xp_awarded'
          ORDER BY occurred_at DESC LIMIT 1) AS base_xp,
         (SELECT xp FROM activity_event
          WHERE party_id = $1 AND user_id = $2
            AND kind = 'hotspot_bonus'
          ORDER BY occurred_at DESC LIMIT 1) AS bonus_xp,
         (SELECT count(*)::int FROM activity_event
          WHERE party_id = $1 AND user_id = $2
            AND kind = 'hotspot_bonus') AS bonus_events
       FROM app_user u
       WHERE u.id = $2`,
      [partyId, leader.userId],
    );

    assert.equal(awards.rows[0].base_xp, 90);
    assert.equal(awards.rows[0].bonus_xp, 10);
    assert.equal(awards.rows[0].bonus_events, 1);
    assert.equal(awards.rows[0].total_xp, 100);

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

    const afterDuplicate = await pool.query(
      `SELECT
         u.total_xp,
         (SELECT count(*)::int FROM activity_event
          WHERE party_id = $1 AND user_id = $2
            AND kind = 'hotspot_bonus') AS bonus_events
       FROM app_user u
       WHERE u.id = $2`,
      [partyId, leader.userId],
    );

    assert.equal(afterDuplicate.rows[0].total_xp, 100);
    assert.equal(afterDuplicate.rows[0].bonus_events, 1);
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

    // 1 minute between two on-site pings in a 10-minute scheduled event earns 10 XP.
    await setPings(pool, partyId, leader.userId, spot, [
      { minutesAgo: 2, onSite: true },
      { minutesAgo: 1, onSite: true },
    ]);

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


  test('time on site counts only gaps between on-site pings, each up to 10 minutes', async (t) => {
    const { app, storage } = await startApp(t);
    const leader = await signUp(app);
    const spot = randomSpot();

    const questId = await createQuest(app, storage, leader.authorization, spot);
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

    const afterPhotoFileId = await uploadPhoto(app, storage, leader.authorization);

    const pool = createPool(env.DATABASE_URL);
    t.after(() => pool.end());

    // 24 -> 12: a 12-minute gap between on-site pings counts as 10.
    // 12 -> 11 -> 10: the member was off site at 11, so neither gap counts.
    // 10 -> 9: 1 minute. 9 is the last ping, so nothing after it counts.
    await setPings(pool, partyId, leader.userId, spot, [
      { minutesAgo: 24, onSite: true },
      { minutesAgo: 12, onSite: true },
      { minutesAgo: 11, onSite: false },
      { minutesAgo: 10, onSite: true },
      { minutesAgo: 9, onSite: true },
    ]);

    const end = await app.inject({
      method: 'POST',
      url: `/parties/${partyId}/end`,
      headers: { authorization: leader.authorization },
      payload: { afterPhotoFileId, bagCount: 1, outcome: 'partial' },
    });
    assert.equal(end.statusCode, 200);

    const award = await pool.query(
      `SELECT xp, minutes_on_site FROM activity_event
       WHERE party_id = $1 AND user_id = $2 AND kind = 'party_xp_awarded'`,
      [partyId, leader.userId],
    );

    assert.equal(award.rowCount, 1);
    assert.equal(award.rows[0].minutes_on_site, 11);
    // XP counts at most the 10-minute time slot.
    assert.equal(award.rows[0].xp, 100);
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

  test('a walk-up starts on the first check-in, others join it, and the leader hands off on leaving', async (t) => {
    const { app, storage } = await startApp(t);
    const first = await signUp(app);
    const second = await signUp(app);
    const spot = randomSpot();
    // Bulky items make the quest medium, so a full share of the slot is worth 150 XP.
    const questId = await createQuest(app, storage, first.authorization, spot, ['bulky_items']);

    const pool = createPool(env.DATABASE_URL);
    t.after(() => pool.end());

    const outside = await walkUp(app, first.authorization, questId, {
      latitude: spot.latitude + 1,
      longitude: spot.longitude,
    });
    assert.equal(outside.statusCode, 403);
    assert.equal(outside.json().code, 'CHECK_IN_OUTSIDE_GEOFENCE');

    const started = await walkUp(app, first.authorization, questId, spot);
    assert.equal(started.statusCode, 200);
    const party = started.json();
    assert.equal(party.status, 'active');
    assert.equal(party.scheduledStart, null);
    assert.equal(party.leader.id, first.userId);
    assert.equal(memberOf(party, first.userId)?.status, 'checked_in');

    const joined = await walkUp(app, second.authorization, questId, spot);
    assert.equal(joined.statusCode, 200);
    assert.equal(joined.json().id, party.id);
    assert.equal(joined.json().leader.id, first.userId);
    assert.equal(memberOf(joined.json(), second.userId)?.status, 'checked_in');

    // Checking in again refreshes presence without a second check-in event.
    const again = await walkUp(app, second.authorization, questId, spot);
    assert.equal(again.json().id, party.id);
    const checkIns = await pool.query(
      `SELECT count(*)::int AS count FROM activity_event
       WHERE party_id = $1 AND user_id = $2 AND kind = 'party_checked_in'`,
      [party.id, second.userId],
    );
    assert.equal(checkIns.rows[0].count, 1);

    const quest = await app.inject({
      method: 'GET',
      url: `/quests/${questId}`,
      headers: { authorization: second.authorization },
    });
    assert.equal(quest.statusCode, 200);
    assert.equal(quest.json().maxXp, 150);
    assert.equal(quest.json().walkUp.partyId, party.id);
    assert.equal(quest.json().walkUp.checkedInCount, 2);

    // A scheduled party that has not started is cancelled when the walk-up completes the quest.
    const later = await createScheduledParty(app, second.authorization, questId);

    const afterPhotoFileId = await uploadPhoto(app, storage, second.authorization);
    const endRequest = (authorization: string) =>
      app.inject({
        method: 'POST',
        url: `/parties/${party.id}/end`,
        headers: { authorization },
        payload: { afterPhotoFileId, bagCount: 3, outcome: 'completed' },
      });

    const notLeader = await endRequest(second.authorization);
    assert.equal(notLeader.statusCode, 403);
    assert.equal(notLeader.json().code, 'PARTY_LEADER_REQUIRED');

    const left = await app.inject({
      method: 'POST',
      url: `/parties/${party.id}/leave`,
      headers: { authorization: first.authorization },
    });
    assert.equal(left.statusCode, 200);
    assert.equal(left.json().status, 'active');
    assert.equal(left.json().leader.id, second.userId);
    assert.equal(memberOf(left.json(), first.userId)?.status, 'left');

    const leftAgain = await app.inject({
      method: 'POST',
      url: `/parties/${party.id}/leave`,
      headers: { authorization: first.authorization },
    });
    assert.equal(leftAgain.statusCode, 409);
    assert.equal(leftAgain.json().code, 'MEMBER_NOT_CHECKED_IN');

    // 30 minutes on site is half of the 60-minute walk-up slot; 20 minutes is a third.
    await setPings(pool, party.id, second.userId, spot, [
      { minutesAgo: 31, onSite: true },
      { minutesAgo: 21, onSite: true },
      { minutesAgo: 11, onSite: true },
      { minutesAgo: 1, onSite: true },
    ]);
    await setPings(pool, party.id, first.userId, spot, [
      { minutesAgo: 25, onSite: true },
      { minutesAgo: 15, onSite: true },
      { minutesAgo: 5, onSite: true },
    ]);

    const end = await endRequest(second.authorization);
    assert.equal(end.statusCode, 200);
    assert.equal(end.json().status, 'completed');

    const awards = await pool.query(
      `SELECT user_id, xp, minutes_on_site FROM activity_event
       WHERE party_id = $1 AND kind = 'party_xp_awarded'`,
      [party.id],
    );
    const xpByUser = new Map(awards.rows.map((row) => [row.user_id, row]));
    assert.equal(xpByUser.get(second.userId)?.minutes_on_site, 30);
    assert.equal(xpByUser.get(second.userId)?.xp, 75);
    assert.equal(xpByUser.get(first.userId)?.minutes_on_site, 20);
    assert.equal(xpByUser.get(first.userId)?.xp, 50);

    const after = await pool.query(
      `SELECT
         (SELECT status FROM quest WHERE id = $1) AS quest_status,
         (SELECT status FROM party WHERE id = $2) AS later_status`,
      [questId, later.partyId],
    );
    assert.equal(after.rows[0].quest_status, 'completed');
    assert.equal(after.rows[0].later_status, 'cancelled');
  });

  test('walk-up members time out, an empty walk-up is abandoned, and the next check-in starts a new one', async (t) => {
    const { app, storage } = await startApp(t);
    const first = await signUp(app);
    const second = await signUp(app);
    const spot = randomSpot();
    const questId = await createQuest(app, storage, first.authorization, spot);

    const pool = createPool(env.DATABASE_URL);
    t.after(() => pool.end());

    const started = await walkUp(app, first.authorization, questId, spot);
    assert.equal(started.statusCode, 200);
    const stale = started.json();

    // The leader's last on-site ping was longer ago than the 30-minute timeout.
    await setPings(pool, stale.id, first.userId, spot, [
      { minutesAgo: 45, onSite: true },
      { minutesAgo: 31, onSite: true },
    ]);

    const quest = await app.inject({
      method: 'GET',
      url: `/quests/${questId}`,
      headers: { authorization: second.authorization },
    });
    assert.equal(quest.json().walkUp, null);

    const presence = await app.inject({
      method: 'POST',
      url: `/parties/${stale.id}/presence`,
      headers: { authorization: first.authorization },
      payload: { location: spot },
    });
    assert.equal(presence.statusCode, 409);

    const fresh = await walkUp(app, second.authorization, questId, spot);
    assert.equal(fresh.statusCode, 200);
    assert.notEqual(fresh.json().id, stale.id);
    assert.equal(fresh.json().leader.id, second.userId);

    const old = await pool.query(
      `SELECT p.status, p.ended_at, m.status AS member_status, m.left_reason
       FROM party p
       JOIN party_member m ON m.party_id = p.id AND m.user_id = $2
       WHERE p.id = $1`,
      [stale.id, first.userId],
    );
    assert.equal(old.rows[0].status, 'abandoned');
    assert.ok(old.rows[0].ended_at);
    assert.equal(old.rows[0].member_status, 'left');
    assert.equal(old.rows[0].left_reason, 'geofence_timeout');

    const noXp = await pool.query(
      `SELECT count(*)::int AS count FROM activity_event
       WHERE party_id = $1 AND kind = 'party_xp_awarded'`,
      [stale.id],
    );
    assert.equal(noXp.rows[0].count, 0);

    // A member who left can check in again while the walk-up is under way.
    const joined = await walkUp(app, first.authorization, questId, spot);
    assert.equal(joined.json().id, fresh.json().id);
    const left = await app.inject({
      method: 'POST',
      url: `/parties/${fresh.json().id}/leave`,
      headers: { authorization: first.authorization },
    });
    assert.equal(left.statusCode, 200);
    const back = await walkUp(app, first.authorization, questId, spot);
    assert.equal(back.statusCode, 200);
    assert.equal(back.json().id, fresh.json().id);
    assert.equal(memberOf(back.json(), first.userId)?.status, 'checked_in');
    assert.equal(back.json().leader.id, second.userId);

    // The last member leaving abandons the walk-up.
    for (const member of [first, second]) {
      const response = await app.inject({
        method: 'POST',
        url: `/parties/${fresh.json().id}/leave`,
        headers: { authorization: member.authorization },
      });
      assert.equal(response.statusCode, 200);
    }
    const abandoned = await app.inject({
      method: 'GET',
      url: `/parties/${fresh.json().id}`,
      headers: { authorization: first.authorization },
    });
    assert.equal(abandoned.json().status, 'abandoned');
  });

  test('leaving a scheduled party is refused', async (t) => {
    const { app, storage } = await startApp(t);
    const leader = await signUp(app);
    const spot = randomSpot();
    const questId = await createQuest(app, storage, leader.authorization, spot);
    const { partyId } = await createScheduledParty(app, leader.authorization, questId);

    const leave = await app.inject({
      method: 'POST',
      url: `/parties/${partyId}/leave`,
      headers: { authorization: leader.authorization },
    });
    assert.equal(leave.statusCode, 409);
    assert.equal(leave.json().code, 'PARTY_NOT_WALK_UP');
  });

});
