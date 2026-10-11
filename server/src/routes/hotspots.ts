import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, HttpError } from '../lib/errors.ts';
import { geographyPoint, type Location, locationSchema } from '../lib/geo.ts';

const HOTSPOT_REPORTER_THRESHOLD = 3;

const hotspotSchema = z.object({
  areaId: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  boundary: z.array(locationSchema).describe("The area's hexagon corners, for drawing it on a map"),
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
  boundary: [number, number][];
  distinctReporters: number;
  reports: number;
  lastReportedDay: Date;
}

// PostGIS repeats the first corner to close the ring; a map only needs each corner once.
function toBoundary(ring: [number, number][]): Location[] {
  return ring.slice(0, -1).map(([latitude, longitude]) => ({ latitude, longitude }));
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
          latitude: z.coerce.number().min(-90).max(90).optional(),
          longitude: z.coerce.number().min(-180).max(180).optional(),
          radiusM: z.coerce.number().int().min(1).max(50_000).optional(),
        }),
        response: {
          200: hotspotsResponseSchema,
          400: errorSchema,
          401: errorSchema,
        },
      },
    },
    async (request) => {
      const { limit, latitude, longitude, radiusM } = request.query;
      const near = latitude !== undefined && longitude !== undefined && radiusM !== undefined;
      if (!near && (latitude !== undefined || longitude !== undefined || radiusM !== undefined)) {
        throw new HttpError(400, 'INVALID_NEAR_FILTER', 'Send latitude, longitude and radiusM together, or none of them');
      }

      // With a location, only areas whose center is within radiusM of it.
      const { rows } = await app.db.query<HotspotRow>(
        `SELECT
           area_id::text AS "areaId",
           ST_Y(h3_cell_to_geometry(area_id))::float8 AS latitude,
           ST_X(h3_cell_to_geometry(area_id))::float8 AS longitude,
           (SELECT json_agg(json_build_array(ST_Y(corner.geom), ST_X(corner.geom)) ORDER BY corner.path)
            FROM ST_DumpPoints(h3_cell_to_boundary_geometry(area_id)) AS corner) AS boundary,
           distinct_reporters::int AS "distinctReporters",
           reports::int AS reports,
           last_reported_day AS "lastReportedDay"
         FROM area_hotspot_30d
         WHERE NOT $2::boolean
            OR ST_DWithin(h3_cell_to_geometry(area_id)::geography, ${geographyPoint(4, 3)}, $5)
         ORDER BY distinct_reporters DESC, reports DESC, area_id::text ASC
         LIMIT $1`,
        [limit, near, latitude ?? 0, longitude ?? 0, radiusM ?? 0],
      );

      return {
        areas: rows.map((row) => ({
          ...row,
          boundary: toBoundary(row.boundary),
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
