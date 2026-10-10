import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { isForeignKeyViolation, isUniqueViolation, withTransaction } from '../lib/db.ts';
import { difficultyTier } from '../lib/difficulty.ts';
import { errorSchema, HttpError } from '../lib/errors.ts';
import { geographyPoint, locationSchema } from '../lib/geo.ts';
import { perUserRateLimit } from '../lib/rate-limit.ts';
import { categorySchema, findReport, hazardSchema, reportSchema } from '../lib/reports.ts';

// A new report this close to an unresolved original is linked to it as a duplicate.
export const DUPLICATE_RADIUS_M = 25;

const security = [{ bearerAuth: [] }];
const tagCode = z.string().regex(/^[a-z_]{1,40}$/);

const reportRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/tags',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['reports'],
        summary: 'List the trash categories and hazards a report can be tagged with',
        security,
        response: {
          200: z.object({ categories: z.array(categorySchema), hazards: z.array(hazardSchema) }),
          401: errorSchema,
        },
      },
    },
    async () => {
      const [categories, hazards] = await Promise.all([
        app.db.query<z.infer<typeof categorySchema>>(`SELECT code, label FROM trash_category ORDER BY code`),
        app.db.query<z.infer<typeof hazardSchema>>(
          `SELECT code, label, warning_text AS warning, requires_dropoff AS "requiresDropoff"
           FROM hazard
           ORDER BY code`,
        ),
      ]);
      return { categories: categories.rows, hazards: hazards.rows };
    },
  );

  app.post(
    '/reports',
    {
      onRequest: app.authenticate,
      config: { rateLimit: perUserRateLimit(20, '1 hour') },
      schema: {
        tags: ['reports'],
        summary: 'Report a spot that needs cleaning up',
        description:
          'The difficulty tier is set from the tags. ' +
          'If the spot is already reported, the report is still saved and `duplicateOf` points at the original.',
        security,
        body: z.object({
          photoFileId: z.uuid().describe('From POST /files'),
          description: z.string().trim().min(1).max(2000),
          location: locationSchema,
          categories: z.array(tagCode).min(1).max(20).describe('Codes from GET /tags'),
          hazards: z.array(tagCode).max(20).default([]).describe('Codes from GET /tags'),
          estimatedBagCount: z.number().int().min(1).max(1000).optional(),
        }),
        response: { 201: reportSchema, 400: errorSchema, 401: errorSchema, 409: errorSchema, 429: errorSchema },
      },
    },
    async (request, reply) => {
      const { photoFileId, description, location, estimatedBagCount } = request.body;
      const categories = [...new Set(request.body.categories)];
      const hazards = [...new Set(request.body.hazards)];
      const userId = request.user.id;

      let reportId: string;
      try {
        reportId = await withTransaction(app.db, async (client) => {
          const photo = await client.query<{ used: boolean }>(
            `SELECT EXISTS (SELECT 1 FROM report WHERE photo_file_id = f.id)
                 OR EXISTS (SELECT 1 FROM party WHERE after_photo_file_id = f.id) AS used
             FROM file f
             WHERE f.id = $1 AND f.uploaded_by_user_id = $2`,
            [photoFileId, userId],
          );
          if (!photo.rows[0]) {
            throw new HttpError(400, 'PHOTO_NOT_FOUND', 'Upload the photo and confirm it with POST /files first');
          }
          if (photo.rows[0].used) {
            throw new HttpError(409, 'PHOTO_ALREADY_USED', 'That photo is already attached to something else');
          }

          // The nearest original that still needs work: no quest yet, or an open one.
          const original = await client.query<{ id: string }>(
            `SELECT r.id
             FROM report r
             LEFT JOIN quest q ON q.report_id = r.id
             WHERE r.duplicate_of_report_id IS NULL
               AND (q.id IS NULL OR q.status = 'open')
               AND ST_DWithin(r.location, ${geographyPoint(1, 2)}, $3)
             ORDER BY ST_Distance(r.location, ${geographyPoint(1, 2)})
             LIMIT 1`,
            [location.longitude, location.latitude, DUPLICATE_RADIUS_M],
          );

          const { rows } = await client.query<{ id: string }>(
            `INSERT INTO report (reporter_user_id, photo_file_id, description, location, duplicate_of_report_id,
                                 difficulty_tier, estimated_bag_count)
             VALUES ($1, $2, $3, ${geographyPoint(4, 5)}, $6, $7, $8)
             RETURNING id`,
            [
              userId,
              photoFileId,
              description,
              location.longitude,
              location.latitude,
              original.rows[0]?.id ?? null,
              difficultyTier({ categories, hazards, estimatedBagCount }),
              estimatedBagCount ?? null,
            ],
          );
          const id = rows[0]!.id;

          await client.query(
            `INSERT INTO report_category (report_id, category_code, source)
             SELECT $1, unnest($2::text[]), 'user'`,
            [id, categories],
          );
          await client.query(
            `INSERT INTO report_hazard (report_id, hazard_code, source)
             SELECT $1, unnest($2::text[]), 'user'`,
            [id, hazards],
          );

          // Feeds the hotspot aggregate. area_id and guild_id are snapshots taken now.
          await client.query(
            `INSERT INTO activity_event (occurred_at, kind, user_id, guild_id, area_id, report_id)
             SELECT r.created_at, 'report_submitted', r.reporter_user_id, gm.guild_id, r.area_id, r.id
             FROM report r
             LEFT JOIN guild_member gm ON gm.user_id = r.reporter_user_id
             WHERE r.id = $1`,
            [id],
          );
          return id;
        });
      } catch (err) {
        if (isForeignKeyViolation(err, 'report_category_category_code_fkey')) {
          throw new HttpError(400, 'UNKNOWN_CATEGORY', 'Use category codes from GET /tags');
        }
        if (isForeignKeyViolation(err, 'report_hazard_hazard_code_fkey')) {
          throw new HttpError(400, 'UNKNOWN_HAZARD', 'Use hazard codes from GET /tags');
        }
        if (isUniqueViolation(err, 'report_photo_file_id_key')) {
          throw new HttpError(409, 'PHOTO_ALREADY_USED', 'That photo is already attached to something else');
        }
        throw err;
      }

      const report = await findReport(app.db, app.storage, reportId);
      return reply.status(201).send(report!);
    },
  );

  app.get(
    '/reports/:id',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['reports'],
        summary: 'Get a report',
        security,
        params: z.object({ id: z.uuid() }),
        response: { 200: reportSchema, 400: errorSchema, 401: errorSchema, 404: errorSchema },
      },
    },
    async (request) => {
      const report = await findReport(app.db, app.storage, request.params.id);
      if (!report) throw new HttpError(404, 'REPORT_NOT_FOUND', 'Report not found');
      return report;
    },
  );
};

export default reportRoutes;
