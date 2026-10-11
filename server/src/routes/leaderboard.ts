import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, HttpError } from '../lib/errors.ts';
import { userSummarySchema } from '../lib/users.ts';

const rankSchema = z.number().int().describe('1 is the most XP. Users with equal XP share a rank.');

const leaderboardEntrySchema = z.object({
  rank: rankSchema,
  user: userSummarySchema,
  totalXp: z.number().int(),
});

const leaderboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/leaderboard',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['leaderboard'],
        summary: 'Rank users by all-time XP, most first',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(100).default(50),
        }),
        response: {
          200: z.object({
            entries: z.array(leaderboardEntrySchema),
            me: z.object({ rank: rankSchema, totalXp: z.number().int() }).describe("The signed-in user's place"),
          }),
          400: errorSchema,
          401: errorSchema,
        },
      },
    },
    async (request) => {
      // username breaks ties so the order is stable; it matches app_user_total_xp_idx.
      const { rows } = await app.db.query<{ id: string; username: string; total_xp: number; rank: number }>(
        `SELECT id, username, total_xp, (rank() OVER (ORDER BY total_xp DESC))::integer AS rank
         FROM app_user
         ORDER BY total_xp DESC, username
         LIMIT $1`,
        [request.query.limit],
      );

      // The caller may be outside the top list, so their rank is counted separately.
      const { rows: meRows } = await app.db.query<{ total_xp: number; rank: number }>(
        `SELECT u.total_xp, (SELECT count(*) FROM app_user o WHERE o.total_xp > u.total_xp)::integer + 1 AS rank
         FROM app_user u
         WHERE u.id = $1`,
        [request.user.id],
      );
      const me = meRows[0];
      // The token is valid but the account was deleted.
      if (!me) throw new HttpError(401, 'INVALID_ACCESS_TOKEN', 'Access token is invalid');

      return {
        entries: rows.map((row) => ({
          rank: row.rank,
          user: { id: row.id, username: row.username },
          totalXp: row.total_xp,
        })),
        me: { rank: me.rank, totalXp: me.total_xp },
      };
    },
  );
};

export default leaderboardRoutes;
