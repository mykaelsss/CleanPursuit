import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { findQuestDropoffs, questDropoffsSchema } from '../lib/dropoffs.ts';
import { errorSchema, HttpError } from '../lib/errors.ts';
import { perUserRateLimit } from '../lib/rate-limit.ts';

const security = [{ bearerAuth: [] }];

const dropoffRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/quests/:id/dropoffs',
    {
      onRequest: app.authenticate,
      // Google Places results are fetched again on every request, so keep a lid on repeats.
      config: { rateLimit: perUserRateLimit(60, '1 minute') },
      schema: {
        tags: ['dropoffs'],
        summary: 'Get drop-off sites and the escalation path for a quest',
        description:
          'For quests with sharps or biohazard. The first request looks up the nearest sites and saves them for the quest; later requests read the saved list.',
        security,
        params: z.object({ id: z.uuid() }),
        response: {
          200: questDropoffsSchema,
          400: errorSchema,
          401: errorSchema,
          404: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (request) => {
      const dropoffs = await findQuestDropoffs(app.db, app.places, request.log, request.params.id);
      if (!dropoffs) throw new HttpError(404, 'QUEST_NOT_FOUND', 'Quest not found');
      return dropoffs;
    },
  );
};

export default dropoffRoutes;
