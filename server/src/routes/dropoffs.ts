import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, HttpError } from '../lib/errors.ts';
import { withTransaction } from '../lib/db.ts';

const security = [{ bearerAuth: [] }];

const SEARCH_RADIUS_METERS = 25_000;
const MAX_DROPOFFS = 5;

const hazardSchema = z.object({
  code: z.string(),
  label: z.string(),
  warning: z.string(),
  requiresDropoff: z.boolean(),
});

const dropoffSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  address: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  acceptsSharps: z.boolean(),
  verifiedAt: z.iso.datetime().nullable(),
  notes: z.string().nullable(),
  distanceM: z.number().int().nonnegative(),
  rank: z.number().int().positive(),
});

const responseSchema = z.object({
  questId: z.uuid(),
  required: z.boolean(),
  fetchedAt: z.iso.datetime().nullable(),
  hazards: z.array(hazardSchema),
  locations: z.array(dropoffSchema),
  escalationRecommended: z.boolean(),
  guidance: z.array(z.string()),
});

interface QuestRow {
  report_id: string;
  dropoffs_fetched_at: Date | null;
}

interface HazardRow {
  code: string;
  label: string;
  warning: string;
  requiresDropoff: boolean;
}

interface DropoffRow {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  acceptsSharps: boolean;
  verifiedAt: Date | null;
  notes: string | null;
  distanceM: number;
  rank: number;
}

const dropoffRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/quests/:id/dropoffs',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['dropoffs'],
        summary: 'Get nearby drop-off locations for a hazardous quest',
        security,
        params: z.object({ id: z.uuid() }),
        response: {
          200: responseSchema,
          400: errorSchema,
          401: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (request) =>
      withTransaction(app.db, async (client) => {
        const questResult = await client.query<QuestRow>(
          `SELECT report_id, dropoffs_fetched_at
           FROM quest
           WHERE id = $1
           FOR UPDATE`,
          [request.params.id],
        );

        const quest = questResult.rows[0];
        if (!quest) {
          throw new HttpError(404, 'QUEST_NOT_FOUND', 'Quest not found');
        }

        const hazardResult = await client.query<HazardRow>(
          `SELECT h.code, h.label,
                  h.warning_text AS warning,
                  h.requires_dropoff AS "requiresDropoff"
           FROM report_hazard rh
           JOIN hazard h ON h.code = rh.hazard_code
           WHERE rh.report_id = $1
           ORDER BY h.code`,
          [quest.report_id],
        );

        const hazards = hazardResult.rows;
        const required = hazards.some((hazard) => hazard.requiresDropoff);

        if (!required) {
          return {
            questId: request.params.id,
            required: false,
            fetchedAt: null,
            hazards,
            locations: [],
            escalationRecommended: false,
            guidance: [],
          };
        }

        const hasSharps = hazards.some((hazard) => hazard.code === 'sharps');

        // Cache the nearest verified locations once, including an empty result.
        // Use only columns present in the checked-in database migrations.
        if (quest.dropoffs_fetched_at === null) {
          await client.query(
            `WITH candidates AS (
               SELECT
                 dl.id,
                 round(ST_Distance(dl.location, r.location))::integer AS distance_m
               FROM report r
               CROSS JOIN dropoff_location dl
               WHERE r.id = $1
                 AND dl.location IS NOT NULL
                 AND dl.name IS NOT NULL
                 AND dl.address IS NOT NULL
                 AND dl.verified_at IS NOT NULL
                 AND ST_DWithin(dl.location, r.location, $2)
                 AND (NOT $3::boolean OR dl.accepts_sharps)
               ORDER BY dl.location <-> r.location, dl.id
               LIMIT $4
             ),
             ranked AS (
               SELECT
                 id,
                 distance_m,
                 row_number() OVER (ORDER BY distance_m, id)::smallint AS rank
               FROM candidates
             )
             INSERT INTO quest_dropoff (quest_id, dropoff_location_id, distance_m, rank)
             SELECT $5, id, distance_m, rank
             FROM ranked
             ON CONFLICT (quest_id, dropoff_location_id) DO NOTHING`,
            [
              quest.report_id,
              SEARCH_RADIUS_METERS,
              hasSharps,
              MAX_DROPOFFS,
              request.params.id,
            ],
          );

          // Record that lookup ran even if it found no nearby locations.
          await client.query(
            `UPDATE quest
             SET dropoffs_fetched_at = now()
             WHERE id = $1 AND dropoffs_fetched_at IS NULL`,
            [request.params.id],
          );
        }

        const fetchedResult = await client.query<{ fetched_at: Date | null }>(
          'SELECT dropoffs_fetched_at AS fetched_at FROM quest WHERE id = $1',
          [request.params.id],
        );

        const locationsResult = await client.query<DropoffRow>(
          `SELECT
             dl.id,
             dl.name,
             dl.address,
             ST_Y(dl.location::geometry)::float8 AS latitude,
             ST_X(dl.location::geometry)::float8 AS longitude,
             dl.accepts_sharps AS "acceptsSharps",
             dl.verified_at AS "verifiedAt",
             dl.notes,
             qd.distance_m AS "distanceM",
             qd.rank
           FROM quest_dropoff qd
           JOIN dropoff_location dl ON dl.id = qd.dropoff_location_id
           WHERE qd.quest_id = $1
           ORDER BY qd.rank`,
          [request.params.id],
        );

        const locations = locationsResult.rows.map((location) => ({
          ...location,
          verifiedAt: location.verifiedAt?.toISOString() ?? null,
        }));

        const guidance: string[] = [];

        if (hasSharps) {
          guidance.push(
            'Do not pick up or transport exposed needles. Follow the hazard warning and contact local sanitation services for safe instructions.',
          );
        }

        if (hazards.some((hazard) => hazard.code === 'biohazard') && locations.length > 0) {
          guidance.push(
            'Confirm directly with a facility that it accepts the reported biological material before travelling.',
          );
        }

        const escalationRecommended = locations.length === 0;
        if (escalationRecommended) {
          guidance.push(
            'No nearby eligible drop-off locations were found within 25 km. Do not handle hazardous material; use local sanitation or the appropriate escalation channel.',
          );
        }

        return {
          questId: request.params.id,
          required,
          fetchedAt: fetchedResult.rows[0]?.fetched_at?.toISOString() ?? null,
          hazards,
          locations,
          escalationRecommended,
          guidance,
        };
      }),
  );
};

export default dropoffRoutes;
