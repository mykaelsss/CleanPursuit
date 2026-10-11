import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { z } from 'zod';
import { isUniqueViolation } from '../lib/db.ts';
import { type DifficultyTier, difficultyTierSchema } from '../lib/difficulty.ts';
import { errorSchema, HttpError } from '../lib/errors.ts';
import { photoSchema } from '../lib/files.ts';
import { geographyPoint, locationSchema, placeNameSchema, selectLocation } from '../lib/geo.ts';
import { perUserRateLimit } from '../lib/rate-limit.ts';
import { findReport, reportSchema } from '../lib/reports.ts';
import type { Storage } from '../lib/storage.ts';
import { userSummarySchema } from '../lib/users.ts';

const security = [{ bearerAuth: [] }];

// Matches the quest_status enum in the database.
const questStatusSchema = z.enum(['open', 'completed', 'cancelled', 'expired']);
type QuestStatus = z.infer<typeof questStatusSchema>;

const questSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: questStatusSchema,
  creator: userSummarySchema,
  report: reportSchema,
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});

type Quest = z.infer<typeof questSchema>;

// A quest as it appears on the map and in lists.
const questSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: questStatusSchema,
  difficultyTier: difficultyTierSchema,
  location: locationSchema,
  placeName: placeNameSchema.nullable(),
  distanceM: z.number().int().describe('Meters from the requested location'),
  hazards: z.array(z.string()).describe('Hazard codes, for map icons and warnings'),
  photo: photoSchema,
  createdAt: z.iso.datetime(),
});

async function findQuest(db: pg.Pool | pg.PoolClient, storage: Storage, id: string): Promise<Quest | null> {
  const { rows } = await db.query<{
    id: string;
    title: string;
    status: QuestStatus;
    report_id: string;
    creator_id: string;
    creator_username: string;
    created_at: Date;
    completed_at: Date | null;
  }>(
    `SELECT q.id, q.title, q.status, q.report_id, u.id AS creator_id, u.username AS creator_username,
            q.created_at, q.completed_at
     FROM quest q
     JOIN app_user u ON u.id = q.created_by_user_id
     WHERE q.id = $1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;

  const report = await findReport(db, storage, row.report_id);
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    creator: { id: row.creator_id, username: row.creator_username },
    report: report!,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at?.toISOString() ?? null,
  };
}

const questRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/reports/:id/quest',
    {
      onRequest: app.authenticate,
      config: { rateLimit: perUserRateLimit(20, '1 hour') },
      schema: {
        tags: ['quests'],
        summary: 'Turn a report into a quest',
        description: 'Any signed-in user can do this; creating a quest raises awareness and does not mean organizing it.',
        security,
        params: z.object({ id: z.uuid() }),
        body: z.object({ title: z.string().trim().min(3).max(80) }),
        response: {
          201: questSchema,
          400: errorSchema,
          401: errorSchema,
          404: errorSchema,
          409: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (request, reply) => {
      const reportId = request.params.id;
      const { rows } = await app.db.query<{ duplicate_of_report_id: string | null }>(
        `SELECT duplicate_of_report_id FROM report WHERE id = $1`,
        [reportId],
      );
      if (!rows[0]) throw new HttpError(404, 'REPORT_NOT_FOUND', 'Report not found');
      if (rows[0].duplicate_of_report_id) {
        throw new HttpError(409, 'REPORT_IS_DUPLICATE', 'This spot was already reported; use the original report');
      }

      let questId: string;
      try {
        const inserted = await app.db.query<{ id: string }>(
          `INSERT INTO quest (report_id, created_by_user_id, title) VALUES ($1, $2, $3) RETURNING id`,
          [reportId, request.user.id, request.body.title],
        );
        questId = inserted.rows[0]!.id;
      } catch (err) {
        if (isUniqueViolation(err, 'quest_report_id_key')) {
          throw new HttpError(409, 'QUEST_EXISTS', 'This report already has a quest');
        }
        throw err;
      }

      const quest = await findQuest(app.db, app.storage, questId);
      return reply.status(201).send(quest!);
    },
  );

  app.get(
    '/quests',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['quests'],
        summary: 'List quests near a location, nearest first',
        security,
        querystring: z.object({
          latitude: z.coerce.number().min(-90).max(90),
          longitude: z.coerce.number().min(-180).max(180),
          radiusM: z.coerce.number().int().min(1).max(50_000).default(5000),
          status: questStatusSchema.default('open'),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: { 200: z.object({ quests: z.array(questSummarySchema) }), 400: errorSchema, 401: errorSchema },
      },
    },
    async (request) => {
      const { latitude, longitude, radiusM, status, limit } = request.query;
      const { rows } = await app.db.query<{
        id: string;
        title: string;
        status: QuestStatus;
        difficulty_tier: DifficultyTier;
        latitude: number;
        longitude: number;
        place_name: string | null;
        distance_m: number;
        hazards: string[];
        photo_file_id: string;
        photo_key: string;
        created_at: Date;
      }>(
        `SELECT q.id, q.title, q.status, r.difficulty_tier, ${selectLocation('r.location')}, r.place_name,
                round(ST_Distance(r.location, ${geographyPoint(2, 1)}))::integer AS distance_m,
                ARRAY(SELECT hazard_code FROM report_hazard WHERE report_id = r.id ORDER BY hazard_code) AS hazards,
                r.photo_file_id, f.key AS photo_key, q.created_at
         FROM quest q
         JOIN report r ON r.id = q.report_id
         JOIN file f ON f.id = r.photo_file_id
         WHERE q.status = $3
           AND ST_DWithin(r.location, ${geographyPoint(2, 1)}, $4)
         ORDER BY distance_m, q.id
         LIMIT $5`,
        [latitude, longitude, status, radiusM, limit],
      );

      const quests = await Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          difficultyTier: row.difficulty_tier,
          location: { latitude: row.latitude, longitude: row.longitude },
          placeName: row.place_name,
          distanceM: row.distance_m,
          hazards: row.hazards,
          photo: { id: row.photo_file_id, url: await app.storage.presignDownload(row.photo_key) },
          createdAt: row.created_at.toISOString(),
        })),
      );
      return { quests };
    },
  );

  app.get(
    '/quests/:id',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['quests'],
        summary: 'Get a quest with its report',
        security,
        params: z.object({ id: z.uuid() }),
        response: { 200: questSchema, 400: errorSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const quest = await findQuest(app.db, app.storage, request.params.id);
      if (!quest) throw new HttpError(404, 'QUEST_NOT_FOUND', 'Quest not found');
      return quest;
    },
  );
};

export default questRoutes;
