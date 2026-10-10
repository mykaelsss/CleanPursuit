// Fills the database with demo users and events around NYC, so the app has something to show.
// Rerunning it replaces the demo content and moves the events back to the same times from now,
// so run it again shortly before a demo. Demo accounts keep their ids, so signed-in apps stay signed in.
//
//   infisical run -- npm run seed:demo
//
// Every demo account signs in with DEMO_PASSWORD. Present as `demo`, which leads one event and has joined another.
// Photos come from db/seed/photos; see CREDITS.md there for their licenses.

import { readFileSync } from 'node:fs';
import type pg from 'pg';
import { loadEnv } from '../src/env.ts';
import { createPool, isUniqueViolation, withTransaction } from '../src/lib/db.ts';
import { difficultyTier } from '../src/lib/difficulty.ts';
import { newUploadKey } from '../src/lib/files.ts';
import { geographyPoint } from '../src/lib/geo.ts';
import { hashPassword } from '../src/lib/password.ts';
import { createR2Storage, type Storage } from '../src/lib/storage.ts';
import type { VolumeRange } from '../src/lib/volume.ts';

const DEMO_PASSWORD = 'cleanpursuit-demo';
// Demo accounts are recognized by this email domain, so the reset never touches real accounts.
const DEMO_EMAIL_DOMAIN = 'demo.example.com';
const PHOTOS_DIR = new URL('../db/seed/photos/', import.meta.url);

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

interface DemoEvent {
  photo: string;
  title: string;
  description: string;
  location: { latitude: number; longitude: number };
  placeName: string;
  categories: string[];
  hazards: string[];
  estimatedVolume: VolumeRange;
  reporter: string;
  reportedDaysAgo: number;
  // Who turned the report into a quest and leads the event; the reporter when left out.
  leader?: string;
  // A day and hour in New York time, or an hour ago so the event is under way.
  starts: { daysFromToday: number; hour: number } | 'an hour ago';
  hours: number;
  // Attendees besides the leader. Checked-in ones are only allowed while the event is under way.
  members: (string | { username: string; checkedIn: true })[];
}

const EVENTS: DemoEvent[] = [
  {
    photo: 'hudson-shoreline.jpg',
    title: 'Hudson River shoreline sweep',
    description:
      'Plastic bottles, bags and food wrappers have washed up on the rocks north of Pier 84. Most of it is light plastic that bags easily.',
    location: { latitude: 40.7637, longitude: -73.999 },
    placeName: 'Pier 84, Hudson River Park',
    categories: ['plastic', 'mixed'],
    hazards: [],
    estimatedVolume: { minGallons: 20, maxGallons: 30 },
    reporter: 'riverkeeper_ana',
    reportedDaysAgo: 3,
    starts: { daysFromToday: 1, hour: 10 },
    hours: 2,
    members: ['jmorales', 'greenstreets', 'tobi_cleans'],
  },
  {
    photo: 'tompkins-square.jpg',
    title: 'Tompkins Square litter pickup',
    description:
      'Cans, bottles and takeout trash have piled up under the shrubs along the Avenue A side of the park after a busy weekend.',
    location: { latitude: 40.7265, longitude: -73.9815 },
    placeName: 'Tompkins Square Park, East Village',
    categories: ['plastic', 'metal', 'glass', 'paper'],
    hazards: [],
    estimatedVolume: { minGallons: 50, maxGallons: 70 },
    reporter: 'sam_k',
    reportedDaysAgo: 2,
    leader: 'east_village_eli',
    starts: { daysFromToday: 2, hour: 11 },
    hours: 2.5,
    members: ['sam_k', 'priya_p'],
  },
  {
    photo: 'prospect-park-ravine.jpg',
    title: 'Prospect Park Ravine bottle cleanup',
    description:
      'Bottles, cans and plastic are scattered down the wooded slope of the Ravine below the Long Meadow. Some of the bottles are broken.',
    location: { latitude: 40.6655, longitude: -73.9705 },
    placeName: 'The Ravine, Prospect Park',
    categories: ['glass', 'metal', 'plastic'],
    hazards: ['broken_glass'],
    estimatedVolume: { minGallons: 30, maxGallons: 40 },
    reporter: 'demo',
    reportedDaysAgo: 4,
    starts: { daysFromToday: 3, hour: 9 },
    hours: 3,
    members: ['bk_dana', 'wburg_walks', 'lee_h'],
  },
  {
    photo: 'meadow-lake.jpg',
    title: 'Meadow Lake shoreline cleanup',
    description: 'Cans, cups and glass bottles are caught between the rocks along the path around Meadow Lake.',
    location: { latitude: 40.74, longitude: -73.8407 },
    placeName: 'Meadow Lake, Flushing Meadows Corona Park',
    categories: ['metal', 'plastic', 'glass'],
    hazards: [],
    estimatedVolume: { minGallons: 8, maxGallons: 12 },
    reporter: 'queens_qiu',
    reportedDaysAgo: 1,
    starts: { daysFromToday: 1, hour: 15 },
    hours: 1.5,
    members: ['mateo_r', 'demo'],
  },
  {
    photo: 'bronx-river-dumping.jpg',
    title: 'Bronx River dumping cleanup',
    description:
      'Someone dumped a fridge, a washer, furniture and bags of trash on the river bank beside the footpath. ' +
      'Syringes were also seen near the outfall and have been reported to 311 for the city to collect.',
    location: { latitude: 40.8406, longitude: -73.874 },
    placeName: 'Bronx River at West Farms',
    categories: ['mixed', 'metal', 'plastic'],
    hazards: ['bulky_items', 'sharps'],
    estimatedVolume: { minGallons: 300, maxGallons: 420 },
    reporter: 'bronx_river_ray',
    reportedDaysAgo: 5,
    starts: { daysFromToday: 4, hour: 10 },
    hours: 4,
    members: ['kayla_b', 'dev_o', 'nina_w', 'paolo_g'],
  },
  {
    photo: 'coney-island-beach.jpg',
    title: 'Coney Island beach sweep',
    description:
      'A long line of bottles, cups and plastic washed up along the tide line between the pier and the aquarium. ' +
      'Meet at the boardwalk by Stillwell Avenue.',
    location: { latitude: 40.5735, longitude: -73.982 },
    placeName: 'Coney Island Beach at Stillwell Ave',
    categories: ['plastic', 'mixed'],
    hazards: [],
    estimatedVolume: { minGallons: 60, maxGallons: 90 },
    reporter: 'coney_cleanup',
    reportedDaysAgo: 2,
    starts: 'an hour ago',
    hours: 3,
    members: [{ username: 'surfside_sue', checkedIn: true }, 'mike_t'],
  },
  {
    photo: 'newtown-creek.jpg',
    title: 'Newtown Creek shoreline cleanup',
    description: 'Plastic bottles and jugs are piled up on the rocks along the creek at the end of Manhattan Avenue.',
    location: { latitude: 40.7372, longitude: -73.9472 },
    placeName: 'Manhattan Ave at Newtown Creek, Greenpoint',
    categories: ['plastic'],
    hazards: [],
    estimatedVolume: { minGallons: 130, maxGallons: 180 },
    reporter: 'greenpoint_gus',
    reportedDaysAgo: 6,
    starts: { daysFromToday: 6, hour: 13 },
    hours: 3,
    members: ['greenstreets', 'priya_p'],
  },
  {
    photo: 'washington-heights-tv.jpg',
    title: 'Washington Heights e-waste haul',
    description:
      'A broken TV and a crate of electronics were left on the corner of Fort Washington Avenue, with loose trash around them. ' +
      'We will carry the electronics to the e-waste drop-off and bag the rest.',
    location: { latitude: 40.851, longitude: -73.937 },
    placeName: 'Fort Washington Ave & W 181st St',
    categories: ['electronics', 'plastic', 'paper'],
    hazards: [],
    estimatedVolume: { minGallons: 15, maxGallons: 25 },
    reporter: 'heights_hector',
    reportedDaysAgo: 1,
    starts: { daysFromToday: 2, hour: 16 },
    hours: 2,
    members: ['lee_h', 'jmorales'],
  },
  {
    photo: 'rockaway-shoreline.jpg',
    title: 'Rockaway Beach plastic pickup',
    description:
      'Bottle caps, straws and plastic fragments are scattered along the beach near Beach 90th Street after the last storm.',
    location: { latitude: 40.583, longitude: -73.816 },
    placeName: 'Beach 90th St, Rockaway Beach',
    categories: ['plastic'],
    hazards: [],
    estimatedVolume: { minGallons: 30, maxGallons: 45 },
    reporter: 'rockaway_rosa',
    reportedDaysAgo: 3,
    starts: { daysFromToday: 5, hour: 9 },
    hours: 3,
    members: ['surfside_sue', 'mike_t', 'tobi_cleans'],
  },
  {
    photo: 'clove-lakes-fence.jpg',
    title: 'Clove Lakes Park fence line cleanup',
    description: 'Wrappers, cups and bottles are caught in the hedge and along the old fence at the edge of the park.',
    location: { latitude: 40.6195, longitude: -74.1135 },
    placeName: 'Clove Lakes Park, Staten Island',
    categories: ['plastic', 'paper', 'mixed'],
    hazards: [],
    estimatedVolume: { minGallons: 20, maxGallons: 30 },
    reporter: 'si_steph',
    reportedDaysAgo: 2,
    starts: { daysFromToday: 3, hour: 13 },
    hours: 2,
    members: ['nina_w'],
  },
  {
    photo: 'jamaica-avenue.jpg',
    title: 'Jamaica Avenue sidewalk sweep',
    description: 'Receipts, cups and cigarette packs line the sidewalk and curb outside the shops near Parsons Boulevard.',
    location: { latitude: 40.7025, longitude: -73.801 },
    placeName: 'Jamaica Ave & Parsons Blvd, Jamaica',
    categories: ['paper', 'plastic'],
    hazards: [],
    estimatedVolume: { minGallons: 10, maxGallons: 15 },
    reporter: 'jamaica_jay',
    reportedDaysAgo: 1,
    starts: { daysFromToday: 1, hour: 12 },
    hours: 1.5,
    members: ['mateo_r', 'dev_o', 'demo'],
  },
];

const NYC_TIME_ZONE = 'America/New_York';

// The UTC offset in New York at `instant`, such as `-04:00`.
function nycOffset(instant: Date): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: NYC_TIME_ZONE, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')!.value;
  return name === 'GMT' ? '+00:00' : name.slice(3);
}

// Events start on the hour, like a person would schedule them.
function startTime(starts: DemoEvent['starts'], now: Date): Date {
  if (starts === 'an hour ago') {
    const hour = new Date(now);
    hour.setMinutes(0, 0, 0);
    return new Date(hour.getTime() - HOUR_MS);
  }
  // Noon on the day, in UTC, is the same calendar day in New York.
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: NYC_TIME_ZONE }).format(now);
  const day = new Date(Date.parse(`${today}T12:00:00Z`) + starts.daysFromToday * DAY_MS).toISOString().slice(0, 10);
  const time = `${day}T${String(starts.hour).padStart(2, '0')}:00:00`;
  // Take the offset at that time, not now, in case daylight saving time changes in between.
  return new Date(`${time}${nycOffset(new Date(`${time}Z`))}`);
}

const usernameOf = (member: DemoEvent['members'][number]) => (typeof member === 'string' ? member : member.username);

const USERNAMES = [
  ...new Set(
    EVENTS.flatMap((event) => [event.reporter, event.leader ?? event.reporter, ...event.members.map(usernameOf)]),
  ),
].sort();

// Creates any missing demo accounts and resets their passwords. Returns user ids by username.
async function upsertUsers(pool: pg.Pool): Promise<Map<string, string>> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  try {
    const { rows } = await pool.query<{ id: string; username: string }>(
      `INSERT INTO app_user (username, email, password_hash)
       SELECT username, username || '@' || $3, $2
       FROM unnest($1::text[]) AS username
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash
       RETURNING id, username`,
      [USERNAMES, passwordHash, DEMO_EMAIL_DOMAIN],
    );
    return new Map(rows.map((row) => [row.username, row.id]));
  } catch (err) {
    if (isUniqueViolation(err, 'app_user_username_key')) {
      throw new Error('A real account already uses one of the demo usernames; rename it in scripts/seed-demo.ts');
    }
    throw err;
  }
}

interface Upload {
  key: string;
  sizeBytes: number;
}

async function uploadPhoto(storage: Storage, userId: string, photo: string): Promise<Upload> {
  const body = readFileSync(new URL(photo, PHOTOS_DIR));
  const key = newUploadKey(userId, 'image/jpeg');
  const url = await storage.presignUpload(key, 'image/jpeg', body.length);
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body });
  if (!response.ok) throw new Error(`Uploading ${photo} to R2 failed with ${response.status}`);
  return { key, sizeBytes: body.length };
}

// Deletes everything the demo accounts created: their reports, the quests and parties on them, parties they
// lead, their memberships and their activity. Real users' parties on demo quests go too. Returns the R2 keys
// of the deleted photos, to remove once the transaction commits.
async function deleteDemoContent(client: pg.PoolClient, userIds: string[]): Promise<string[]> {
  const { rows } = await client.query<{ reports: string[]; quests: string[]; parties: string[] }>(
    `WITH reports AS (SELECT id FROM report WHERE reporter_user_id = ANY($1)),
          quests AS (SELECT id FROM quest WHERE report_id IN (SELECT id FROM reports) OR created_by_user_id = ANY($1)),
          parties AS (SELECT id FROM party WHERE quest_id IN (SELECT id FROM quests) OR leader_user_id = ANY($1))
     SELECT ARRAY(SELECT id FROM reports) AS reports,
            ARRAY(SELECT id FROM quests) AS quests,
            ARRAY(SELECT id FROM parties) AS parties`,
    [userIds],
  );
  const { reports, quests, parties } = rows[0]!;

  // Report photos and after photos; avatars and other uploads stay.
  const files = await client.query<{ id: string; key: string }>(
    `SELECT f.id, f.key FROM file f
     WHERE f.id IN (SELECT photo_file_id FROM report WHERE id = ANY($1)
                    UNION SELECT after_photo_file_id FROM party WHERE id = ANY($2))`,
    [reports, parties],
  );

  await client.query(
    `DELETE FROM activity_event
     WHERE user_id = ANY($1) OR report_id = ANY($2) OR quest_id = ANY($3) OR party_id = ANY($4)`,
    [userIds, reports, quests, parties],
  );
  await client.query(`DELETE FROM party_member WHERE user_id = ANY($1)`, [userIds]);
  await client.query(`DELETE FROM party WHERE id = ANY($1)`, [parties]);
  await client.query(`DELETE FROM quest WHERE id = ANY($1)`, [quests]);
  // Real reports of the same spot become originals instead of pointing at a deleted report.
  await client.query(`UPDATE report SET duplicate_of_report_id = NULL WHERE duplicate_of_report_id = ANY($1)`, [
    reports,
  ]);
  await client.query(`DELETE FROM report WHERE id = ANY($1)`, [reports]);
  await client.query(`DELETE FROM file WHERE id = ANY($1)`, [files.rows.map((f) => f.id)]);
  return files.rows.map((f) => f.key);
}

async function insertEvent(
  client: pg.PoolClient,
  event: DemoEvent,
  users: Map<string, string>,
  upload: Upload,
  now: Date,
): Promise<void> {
  const id = (username: string) => {
    const userId = users.get(username);
    if (!userId) throw new Error(`Unknown demo user ${username}`);
    return userId;
  };
  const reporterId = id(event.reporter);
  const leaderId = id(event.leader ?? event.reporter);

  const start = startTime(event.starts, now);
  const end = new Date(start.getTime() + event.hours * HOUR_MS);
  const underWay = start <= now;
  if (!underWay && event.members.some((m) => typeof m !== 'string')) {
    throw new Error(`${event.title}: members can only be checked in once the event has started`);
  }
  const reportedAt = new Date(now.getTime() - event.reportedDaysAgo * DAY_MS);
  const questAt = new Date(reportedAt.getTime() + 2 * HOUR_MS);
  const partyAt = new Date(questAt.getTime() + HOUR_MS);
  const startedAt = new Date(start.getTime() + 5 * 60_000);

  const file = await client.query<{ id: string }>(
    `INSERT INTO file (key, content_type, size_bytes, uploaded_by_user_id, created_at)
     VALUES ($1, 'image/jpeg', $2, $3, $4)
     RETURNING id`,
    [upload.key, upload.sizeBytes, reporterId, reportedAt],
  );

  const report = await client.query<{ id: string }>(
    `INSERT INTO report (reporter_user_id, photo_file_id, description, location, place_name, difficulty_tier,
                         estimated_volume_min_gallons, estimated_volume_max_gallons, created_at)
     VALUES ($1, $2, $3, ${geographyPoint(4, 5)}, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      reporterId,
      file.rows[0]!.id,
      event.description,
      event.location.longitude,
      event.location.latitude,
      event.placeName,
      difficultyTier(event),
      event.estimatedVolume.minGallons,
      event.estimatedVolume.maxGallons,
      reportedAt,
    ],
  );
  const reportId = report.rows[0]!.id;
  await client.query(
    `INSERT INTO report_category (report_id, category_code, source, created_at)
     SELECT $1, code, 'user', $3 FROM unnest($2::text[]) AS code`,
    [reportId, event.categories, reportedAt],
  );
  await client.query(
    `INSERT INTO report_hazard (report_id, hazard_code, source, created_at)
     SELECT $1, code, 'user', $3 FROM unnest($2::text[]) AS code`,
    [reportId, event.hazards, reportedAt],
  );
  // Like POST /reports, so the report counts toward hotspots.
  await client.query(
    `INSERT INTO activity_event (occurred_at, kind, user_id, area_id, report_id)
     SELECT created_at, 'report_submitted', reporter_user_id, area_id, id FROM report WHERE id = $1`,
    [reportId],
  );

  const quest = await client.query<{ id: string }>(
    `INSERT INTO quest (report_id, created_by_user_id, title, created_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [reportId, leaderId, event.title, questAt],
  );
  const questId = quest.rows[0]!.id;

  const party = await client.query<{ id: string }>(
    `INSERT INTO party (quest_id, leader_user_id, status, scheduled_start, scheduled_end, started_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [questId, leaderId, underWay ? 'active' : 'scheduled', start, end, underWay ? startedAt : null, partyAt],
  );
  const partyId = party.rows[0]!.id;

  // The leader signs up when scheduling and checks in first once the event is under way.
  const members = [
    { userId: leaderId, checkedIn: underWay },
    ...event.members.map((m) => ({ userId: id(usernameOf(m)), checkedIn: typeof m !== 'string' })),
  ];
  for (const [i, member] of members.entries()) {
    const signedUpAt = new Date(partyAt.getTime() + i * HOUR_MS);
    const checkedInAt = member.checkedIn ? new Date(startedAt.getTime() + i * 60_000) : null;
    await client.query(
      `INSERT INTO party_member (party_id, user_id, status, signed_up_at, checked_in_at, last_on_site_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        partyId,
        member.userId,
        checkedInAt ? 'checked_in' : 'signed_up',
        signedUpAt,
        checkedInAt,
        checkedInAt ? new Date(now.getTime() - 2 * 60_000) : null,
      ],
    );
    if (checkedInAt) {
      await client.query(
        `INSERT INTO activity_event (occurred_at, kind, user_id, area_id, quest_id, party_id)
         SELECT $1, 'party_checked_in', $2, area_id, $3, $4 FROM report WHERE id = $5`,
        [checkedInAt, member.userId, questId, partyId, reportId],
      );
    }
  }
}

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);
const storage = createR2Storage({
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucket: env.R2_BUCKET,
});

try {
  const users = await upsertUsers(pool);
  console.log(`${users.size} demo users ready`);

  // Upload first, so a failed upload leaves the current demo content in place.
  const uploads = await Promise.all(
    EVENTS.map((event) => uploadPhoto(storage, users.get(event.reporter)!, event.photo)),
  );
  console.log(`${uploads.length} photos uploaded`);

  const now = new Date();
  let oldKeys: string[];
  try {
    oldKeys = await withTransaction(pool, async (client) => {
      const keys = await deleteDemoContent(client, [...users.values()]);
      for (const [i, event] of EVENTS.entries()) await insertEvent(client, event, users, uploads[i]!, now);
      return keys;
    });
  } catch (err) {
    await Promise.allSettled(uploads.map(({ key }) => storage.remove(key)));
    throw err;
  }

  // Best effort: a leftover object only costs storage.
  const removed = await Promise.allSettled(oldKeys.map((key) => storage.remove(key)));
  const failed = removed.filter((result) => result.status === 'rejected').length;
  console.log(`${EVENTS.length} demo events created, ${oldKeys.length - failed} old photos removed`);
  if (failed) console.warn(`${failed} old photos could not be removed from R2`);
  console.log(`Sign in as \`demo\` (or any demo user) with the password \`${DEMO_PASSWORD}\`.`);
} finally {
  await pool.end();
}
