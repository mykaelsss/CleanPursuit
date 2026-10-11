import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema } from '../lib/errors.ts';

const HOTSPOT_REPORTER_THRESHOLD = 3;

const hotspotSchema = z.object({
  areaId: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  distinctReporters: z.number().int().nonnegative(),
  reports: z.number().int().nonnegative(),
  lastReportedDay: z.iso.datetime(),
  isHotspot: z.boolean(),
});

const hotspotsResponseSchema = z.object({
  areas: z.array(hotspotSchema),
  limit: z.number().int().min(1).max(250),
  reporterThreshold: z.number().int().positive(),
});

interface HotspotRow {
  areaId: string;
  latitude: number;
  longitude: number;
  distinctReporters: number;
  reports: number;
  lastReportedDay: Date;
}

const hotspotRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/hotspots',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['hotspots'],
        summary: 'List recent cleanup hotspots by H3 area',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(250).default(100),
        }),
        response: {
          200: hotspotsResponseSchema,
          400: errorSchema,
          401: errorSchema,
        },
      },
    },
    async (request) => {
      const { limit } = request.query;

      const { rows } = await app.db.query<HotspotRow>(
        `SELECT
           area_id::text AS "areaId",
           ST_Y(ST_Centroid(h3_cell_to_geometry(area_id)))::float8 AS latitude,
           ST_X(ST_Centroid(h3_cell_to_geometry(area_id)))::float8 AS longitude,
           distinct_reporters::int AS "distinctReporters",
           reports::int AS reports,
           last_reported_day AS "lastReportedDay"
         FROM area_hotspot_30d
         ORDER BY distinct_reporters DESC, reports DESC, area_id::text ASC
         LIMIT $1`,
        [limit],
      );

      return {
        areas: rows.map((row) => ({
          ...row,
          lastReportedDay: row.lastReportedDay.toISOString(),
          isHotspot: row.distinctReporters >= HOTSPOT_REPORTER_THRESHOLD,
        })),
        limit,
        reporterThreshold: HOTSPOT_REPORTER_THRESHOLD,
      };
    },
  );
};

export default hotspotRoutes;
