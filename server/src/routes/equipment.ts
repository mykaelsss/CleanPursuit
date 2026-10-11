import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, HttpError } from '../lib/errors.ts';

const security = [{ bearerAuth: [] }];

const equipmentItemSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  required: z.boolean().describe('Volunteers must bring it, such as a sharps container for sharps'),
});

const equipmentHazardSchema = z.object({
  code: z.string(),
  label: z.string(),
  warning: z.string(),
  requiresDropoff: z.boolean(),
});

const equipmentResponseSchema = z.object({
  questId: z.uuid(),
  items: z.array(equipmentItemSchema),
  hazards: z.array(equipmentHazardSchema),
});

interface QuestRow {
  report_id: string;
}

interface HazardRow {
  code: string;
  label: string;
  warning: string;
  requiresDropoff: boolean;
}

interface ItemRow {
  id: string;
  name: string;
  description: string | null;
  required: boolean;
}

const equipmentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/quests/:id/equipment',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['equipment'],
        summary: 'Get safe equipment recommendations for a quest',
        security,
        params: z.object({ id: z.uuid() }),
        response: {
          200: equipmentResponseSchema,
          400: errorSchema,
          401: errorSchema,
          404: errorSchema,
        },
      },
    },
    async (request) => {
      const questResult = await app.db.query<QuestRow>(
        'SELECT report_id FROM quest WHERE id = $1',
        [request.params.id],
      );

      const quest = questResult.rows[0];
      if (!quest) {
        throw new HttpError(404, 'QUEST_NOT_FOUND', 'Quest not found');
      }

      const hazardResult = await app.db.query<HazardRow>(
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
      const hazardCodes = hazards.map((hazard) => hazard.code);

      // Gear a hazard requires, such as the sharps container drop-off sites insist on, is always listed.
      const requiredResult = await app.db.query<ItemRow>(
        `SELECT DISTINCT i.id, i.name, i.description, true AS required
         FROM hazard_item hi
         JOIN item i ON i.id = hi.item_id
         WHERE hi.hazard_code = ANY($1::text[]) AND hi.required
         ORDER BY i.name, i.id`,
        [hazardCodes],
      );
      let items: ItemRow[] = [];

      // Beyond required gear, never recommend equipment for hazards that
      // require drop-off or escalation.
      if (!hazards.some((hazard) => hazard.requiresDropoff)) {
        if (hazards.length > 0) {
          // When hazards are present, use only hazard-specific mappings.
          // If any reported hazard has no mapping, return no guessed gear.
          const result = await app.db.query<ItemRow>(
            `SELECT DISTINCT i.id, i.name, i.description, false AS required
             FROM hazard_item hi
             JOIN item i ON i.id = hi.item_id
             WHERE hi.hazard_code = ANY($1::text[]) AND NOT hi.required
               AND NOT EXISTS (
                 SELECT 1
                 FROM unnest($1::text[]) AS reported(code)
                 WHERE NOT EXISTS (
                   SELECT 1
                   FROM hazard_item mapped
                   WHERE mapped.hazard_code = reported.code
                 )
               )
             ORDER BY i.name, i.id`,
            [hazardCodes],
          );
          items = result.rows;
        } else {
          // With no reported hazards, use the ordinary category mappings.
          const result = await app.db.query<ItemRow>(
            `SELECT DISTINCT i.id, i.name, i.description, false AS required
             FROM report_category rc
             JOIN category_item ci ON ci.category_code = rc.category_code
             JOIN item i ON i.id = ci.item_id
             WHERE rc.report_id = $1
             ORDER BY i.name, i.id`,
            [quest.report_id],
          );
          items = result.rows;
        }
      }

      // Required gear first, and listed once.
      const requiredIds = new Set(requiredResult.rows.map((item) => item.id));
      return {
        questId: request.params.id,
        items: [...requiredResult.rows, ...items.filter((item) => !requiredIds.has(item.id))],
        hazards,
      };
    },
  );
};

export default equipmentRoutes;
