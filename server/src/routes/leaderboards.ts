import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { errorSchema } from '../lib/errors.ts';

const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  userId: z.uuid(),
  username: z.string(),
  totalXp: z.number().int().nonnegative(),
});

const leaderboardResponseSchema = z.object({
  entries: z.array(leaderboardEntrySchema),
  limit: z.number().int().min(1).max(100),
});

interface LeaderboardRow {
  id: string;
  username: string;
  total_xp: number;
  rank: number;
}

const leaderboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/leaderboards',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['leaderboards'],
        summary: 'Get the all-time XP leaderboard',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(20),
        }),
        response: {
          200: leaderboardResponseSchema,
          400: errorSchema,
          401: errorSchema,
        },
      },
    },
    async (request) => {
      const { limit } = request.query;

      const { rows } = await app.db.query<LeaderboardRow>(
        `SELECT
           id,
           username,
           total_xp,
           RANK() OVER (ORDER BY total_xp DESC)::int AS rank
         FROM app_user
         ORDER BY total_xp DESC, username ASC, id ASC
         LIMIT $1`,
        [limit],
      );

      return {
        entries: rows.map((row) => ({
          rank: row.rank,
          userId: row.id,
          username: row.username,
          totalXp: row.total_xp,
        })),
        limit,
      };
    },
  );
};

export default leaderboardRoutes;
