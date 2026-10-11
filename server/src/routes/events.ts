import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from '../lib/db.ts';
import { type DifficultyTier, difficultyTierSchema } from '../lib/difficulty.ts';
import { errorSchema, HttpError } from '../lib/errors.ts';
import { photoSchema } from '../lib/files.ts';
import { geographyPoint, locationSchema, placeNameSchema, selectLocation } from '../lib/geo.ts';
import { perUserRateLimit } from '../lib/rate-limit.ts';
import type { Storage } from '../lib/storage.ts';
import { userSummarySchema } from '../lib/users.ts';
import { toWalkUp, WALK_UP_COLUMNS, WALK_UP_JOIN, type WalkUpRow, walkUpSchema } from '../lib/walk-ups.ts';
import { TIER_MAX_XP } from '../lib/xp.ts';

// An event is a scheduled party: one attempt at a quest, with a time slot and an organizer (the leader).

const security = [{ bearerAuth: [] }];
const MAX_EVENT_HOURS = 12;

const eventSchema = z.object({
  id: z.uuid(),
  questId: z.uuid(),
  title: z.string().describe("The quest's title"),
  description: z.string().describe("The report's description of the site"),
  location: locationSchema,
  placeName: placeNameSchema.nullable(),
  areaId: z.string().describe('H3 area of the report, to match against /hotspots'),
  difficultyTier: difficultyTierSchema,
  status: z.enum(['scheduled', 'active']).describe('active once someone has checked in'),
  scheduledStart: z.iso.datetime(),
  scheduledEnd: z.iso.datetime(),
  organizer: userSummarySchema,
  maxXp: z.number().int().describe('XP for an attendee on site for the whole time slot'),
  photo: photoSchema,
  attendeeCount: z.number().int().describe('Signed-up and checked-in members, including the organizer'),
  joined: z.boolean().describe('Whether the signed-in user is attending'),
  isOrganizer: z.boolean(),
  walkUp: walkUpSchema.describe("A walk-up cleanup under way on the event's quest, which anyone at the spot can join now"),
});

const eventSummarySchema = eventSchema.extend({
  distanceM: z.number().int().describe('Meters from the requested location'),
});

const attendeeSchema = z.object({
  user: userSummarySchema,
  email: z.string().optional().describe('Only included when the signed-in user is the organizer'),
  isOrganizer: z.boolean(),
  status: z.enum(['signed_up', 'checked_in']),
});

const eventDetailSchema = eventSchema.extend({ attendees: z.array(attendeeSchema) });

type Event = z.infer<typeof eventSchema>;
type EventDetail = z.infer<typeof eventDetailSchema>;

// Members who are coming or there now; `left` and `no_show` members are not attendees.
const ATTENDING = `('signed_up', 'checked_in')`;
// Events that can still be joined: scheduled or under way, and not over yet.
const OPEN_EVENT = `p.scheduled_start IS NOT NULL AND p.status IN ('scheduled', 'active') AND p.scheduled_end > now()`;

// $1 is the signed-in user's id.
const EVENT_COLUMNS = `
  p.id, p.quest_id, p.leader_user_id, p.status, p.scheduled_start, p.scheduled_end,
  q.title, r.description, ${selectLocation('r.location')}, r.place_name, r.area_id::text, r.difficulty_tier,
  u.username AS organizer_username, r.photo_file_id, f.key AS photo_key,
  (SELECT count(*)::integer FROM party_member m
   WHERE m.party_id = p.id AND m.status IN ${ATTENDING}) AS attendee_count,
  EXISTS (SELECT 1 FROM party_member m
          WHERE m.party_id = p.id AND m.user_id = $1 AND m.status IN ${ATTENDING}) AS joined,
  ${WALK_UP_COLUMNS}`;

const EVENT_FROM = `
  FROM party p
  JOIN quest q ON q.id = p.quest_id
  JOIN report r ON r.id = q.report_id
  JOIN file f ON f.id = r.photo_file_id
  JOIN app_user u ON u.id = p.leader_user_id
  ${WALK_UP_JOIN}`;

interface EventRow extends WalkUpRow {
  id: string;
  quest_id: string;
  leader_user_id: string;
  status: Event['status'];
  scheduled_start: Date;
  scheduled_end: Date;
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  place_name: string | null;
  area_id: string;
  difficulty_tier: DifficultyTier;
  organizer_username: string;
  photo_file_id: string;
  photo_key: string;
  attendee_count: number;
  joined: boolean;
}

async function toEvent(row: EventRow, userId: string, storage: Storage): Promise<Event> {
  return {
    id: row.id,
    questId: row.quest_id,
    title: row.title,
    description: row.description,
    location: { latitude: row.latitude, longitude: row.longitude },
    placeName: row.place_name,
    areaId: row.area_id,
    difficultyTier: row.difficulty_tier,
    status: row.status,
    scheduledStart: row.scheduled_start.toISOString(),
    scheduledEnd: row.scheduled_end.toISOString(),
    organizer: { id: row.leader_user_id, username: row.organizer_username },
    maxXp: TIER_MAX_XP[row.difficulty_tier],
    photo: { id: row.photo_file_id, url: await storage.presignDownload(row.photo_key) },
    attendeeCount: row.attendee_count,
    joined: row.joined,
    isOrganizer: row.leader_user_id === userId,
    walkUp: toWalkUp(row),
  };
}

async function findEvent(
  db: pg.Pool | pg.PoolClient,
  storage: Storage,
  id: string,
  userId: string,
): Promise<EventDetail | null> {
  const { rows } = await db.query<EventRow>(
    `SELECT ${EVENT_COLUMNS} ${EVENT_FROM}
     WHERE p.id = $2 AND p.scheduled_start IS NOT NULL AND p.status IN ('scheduled', 'active')`,
    [userId, id],
  );
  const row = rows[0];
  if (!row) return null;

  const event = await toEvent(row, userId, storage);
  const { rows: members } = await db.query<{
    id: string;
    username: string;
    email: string;
    status: 'signed_up' | 'checked_in';
  }>(
    `SELECT u.id, u.username, u.email, m.status
     FROM party_member m
     JOIN app_user u ON u.id = m.user_id
     WHERE m.party_id = $1 AND m.status IN ${ATTENDING}
     ORDER BY m.signed_up_at, u.username`,
    [id],
  );
  return {
    ...event,
    // Attendees' contact details are for the organizer only.
    attendees: members.map((m) => ({
      user: { id: m.id, username: m.username },
      ...(event.isOrganizer ? { email: m.email } : {}),
      isOrganizer: m.id === row.leader_user_id,
      status: m.status,
    })),
  };
}

const eventRoutes: FastifyPluginAsyncZod = async (app) => {
  async function requireEvent(id: string, userId: string): Promise<EventDetail> {
    const event = await findEvent(app.db, app.storage, id, userId);
    if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Party not found');
    return event;
  }

  app.get(
    '/events',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['events'],
        summary: 'List upcoming and in-progress events near a location, soonest first',
        security,
        querystring: z.object({
          latitude: z.coerce.number().min(-90).max(90),
          longitude: z.coerce.number().min(-180).max(180),
          radiusM: z.coerce.number().int().min(1).max(50_000).default(10_000),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: { 200: z.object({ events: z.array(eventSummarySchema) }), 400: errorSchema, 401: errorSchema },
      },
    },
    async (request) => {
      const { latitude, longitude, radiusM, limit } = request.query;
      const { rows } = await app.db.query<EventRow & { distance_m: number }>(
        `SELECT ${EVENT_COLUMNS},
                round(ST_Distance(r.location, ${geographyPoint(3, 2)}))::integer AS distance_m
         ${EVENT_FROM}
         WHERE ${OPEN_EVENT}
           AND ST_DWithin(r.location, ${geographyPoint(3, 2)}, $4)
         ORDER BY p.scheduled_start, distance_m, p.id
         LIMIT $5`,
        [request.user.id, latitude, longitude, radiusM, limit],
      );
      const events = await Promise.all(
        rows.map(async (row) => ({
          ...(await toEvent(row, request.user.id, app.storage)),
          distanceM: row.distance_m,
        })),
      );
      return { events };
    },
  );

  app.get(
    '/events/:id',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['events'],
        summary: 'Get an event with its attendees',
        description: "Attendees' emails are included only for the organizer.",
        security,
        params: z.object({ id: z.uuid() }),
        response: { 200: eventDetailSchema, 400: errorSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request) => requireEvent(request.params.id, request.user.id),
  );

  app.post(
    '/events/:id/join',
    {
      onRequest: app.authenticate,
      config: { rateLimit: perUserRateLimit(60, '1 hour') },
      schema: {
        tags: ['events'],
        summary: 'Sign up for an event',
        description: 'Joining an event you already joined does nothing.',
        security,
        params: z.object({ id: z.uuid() }),
        response: {
          200: eventDetailSchema,
          400: errorSchema,
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { rows } = await app.db.query<{ open: boolean }>(
        `SELECT (${OPEN_EVENT}) AS open FROM party p WHERE p.id = $1 AND p.scheduled_start IS NOT NULL`,
        [id],
      );
      if (!rows[0]) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Party not found');
      if (!rows[0].open) throw new HttpError(409, 'EVENT_CLOSED', 'This party has ended or was cancelled');

      await app.db.query(
        `INSERT INTO party_member (party_id, user_id) VALUES ($1, $2) ON CONFLICT (party_id, user_id) DO NOTHING`,
        [id, request.user.id],
      );
      return requireEvent(id, request.user.id);
    },
  );

  app.delete(
    '/events/:id/join',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['events'],
        summary: 'Withdraw from an event before checking in',
        description: 'The organizer cannot withdraw. Withdrawing from an event you are not attending does nothing.',
        security,
        params: z.object({ id: z.uuid() }),
        response: { 200: eventDetailSchema, 400: errorSchema, 401: errorSchema, 404: errorSchema, 409: errorSchema },
      },
    },
    async (request) => {
      const { id } = request.params;
      const event = await requireEvent(id, request.user.id);
      if (event.isOrganizer) {
        throw new HttpError(409, 'ORGANIZER_CANNOT_LEAVE', 'The party leader cannot leave their own party');
      }
      const me = event.attendees.find((a) => a.user.id === request.user.id);
      if (me?.status === 'checked_in') {
        throw new HttpError(409, 'ALREADY_CHECKED_IN', 'You have already checked in to this party');
      }

      await app.db.query(`DELETE FROM party_member WHERE party_id = $1 AND user_id = $2 AND status = 'signed_up'`, [
        id,
        request.user.id,
      ]);
      return requireEvent(id, request.user.id);
    },
  );

  // Call off an event before it starts. Once someone has checked in, the leader ends it instead.
  app.post(
    '/events/:id/cancel',
    {
      onRequest: app.authenticate,
      config: { rateLimit: perUserRateLimit(30, '1 hour') },
      schema: {
        tags: ['events'],
        summary: 'Call off an event before it starts',
        description: 'Only the organizer can call off an event, and only before anyone has checked in.',
        security,
        params: z.object({ id: z.uuid() }),
        response: {
          204: z.null(),
          400: errorSchema,
          401: errorSchema,
          403: errorSchema,
          404: errorSchema,
          409: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      await withTransaction(app.db, async (client) => {
        const { rows } = await client.query<{ leader_user_id: string; status: string }>(
          `SELECT leader_user_id, status FROM party
           WHERE id = $1 AND scheduled_start IS NOT NULL
           FOR UPDATE`,
          [id],
        );
        const event = rows[0];
        if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Party not found');
        if (event.leader_user_id !== request.user.id) {
          throw new HttpError(403, 'PARTY_LEADER_REQUIRED', 'Only the party leader can call off this party');
        }
        if (event.status !== 'scheduled') {
          throw new HttpError(
            409,
            'EVENT_NOT_CANCELLABLE',
            event.status === 'active'
              ? 'Someone has checked in, so end the party instead'
              : 'This party has already ended or was called off',
          );
        }
        await client.query(`UPDATE party SET status = 'cancelled', ended_at = now() WHERE id = $1`, [id]);
      });
      return reply.status(204).send(null);
    },
  );

  app.post(
    '/quests/:id/events',
    {
      onRequest: app.authenticate,
      config: { rateLimit: perUserRateLimit(20, '1 hour') },
      schema: {
        tags: ['events'],
        summary: 'Schedule an event on a quest',
        description: 'The signed-in user becomes the organizer and the first attendee. ' +
          'Retrying the same quest, organizer and time slot returns their existing scheduled or active event.',
        security,
        params: z.object({ id: z.uuid() }),
        body: z.object({
          scheduledStart: z.iso.datetime({ offset: true }),
          scheduledEnd: z.iso.datetime({ offset: true }),
        }),
        response: {
          201: eventDetailSchema,
          400: errorSchema,
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const start = new Date(request.body.scheduledStart);
      const end = new Date(request.body.scheduledEnd);
      if (end <= start) throw new HttpError(400, 'END_BEFORE_START', 'The party must end after it starts');
      if (end.getTime() - start.getTime() > MAX_EVENT_HOURS * 3_600_000) {
        throw new HttpError(400, 'EVENT_TOO_LONG', `Parties can last at most ${MAX_EVENT_HOURS} hours`);
      }

      // The leader must be a member; the foreign key is deferred, so both rows go in one transaction.
      const eventId = await withTransaction(app.db, async (client) => {
        // Serialize scheduling on this quest so concurrent retries cannot create a second event.
        const { rows } = await client.query<{ status: string }>(
          `SELECT status FROM quest WHERE id = $1 FOR UPDATE`, [request.params.id],
        );
        if (!rows[0]) throw new HttpError(404, 'QUEST_NOT_FOUND', 'Quest not found');
        if (rows[0].status !== 'open') throw new HttpError(409, 'QUEST_NOT_OPEN', 'This quest is no longer open');
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM party
           WHERE quest_id = $1 AND leader_user_id = $2 AND scheduled_start = $3 AND scheduled_end = $4
             AND status IN ('scheduled', 'active')
           ORDER BY id LIMIT 1`,
          [request.params.id, request.user.id, start, end],
        );
        if (existing.rows[0]) return existing.rows[0].id;
        if (start.getTime() <= Date.now()) {
          throw new HttpError(400, 'START_IN_PAST', 'The party must start in the future');
        }
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO party (quest_id, leader_user_id, status, scheduled_start, scheduled_end)
           VALUES ($1, $2, 'scheduled', $3, $4)
           RETURNING id`,
          [request.params.id, request.user.id, start, end],
        );
        const id = inserted.rows[0]!.id;
        await client.query(`INSERT INTO party_member (party_id, user_id) VALUES ($1, $2)`, [id, request.user.id]);
        return id;
      });

      return reply.status(201).send(await requireEvent(eventId, request.user.id));
    },
  );
};

export default eventRoutes;
