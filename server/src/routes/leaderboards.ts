import { z } from 'zod';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { errorSchema, HttpError } from '../lib/errors.ts';

// Each period reads the continuous aggregate for its bucket size. Buckets are in UTC,
// and weeks start on Monday, the way time_bucket aligns them.
const PERIODS = {
  day: { view: 'xp_daily_by_user', bucket: '1 day' },
  week: { view: 'xp_weekly_by_user', bucket: '1 week' },
  month: { view: 'xp_monthly_by_user', bucket: '1 month' },
} as const;

const periodSchema = z.enum(['all', 'day', 'week', 'month']);

const leaderboardEntrySchema = z.object({
  rank: z.number().int().positive(),
  userId: z.uuid(),
  username: z.string(),
  xp: z.number().int().positive().describe('XP earned in the period; ranks the board'),
  totalXp: z.number().int().nonnegative().describe('All-time XP'),
});

const leaderboardResponseSchema = z.object({
  period: periodSchema,
  periodStart: z.iso
    .datetime()
    .nullable()
    .describe('Start of the current UTC day, week or month; null for all time'),
  entries: z.array(leaderboardEntrySchema),
  limit: z.number().int().min(1).max(100),
  me: z.object({
    rank: z.number().int().positive().nullable().describe('Rank across the full period; null without positive XP'),
    xp: z.number().int().describe('Net XP earned in the period'),
    totalXp: z.number().int().nonnegative(),
  }).describe("The signed-in user's place, even outside the returned entries"),
});

interface LeaderboardRow {
  id: string;
  username: string;
  xp: string;
  total_xp: number;
  rank: number;
}

interface PersonalRankRow {
  xp: string;
  total_xp: number;
  rank: number | null;
}

const leaderboardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/leaderboards',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['leaderboards'],
        summary: 'Get the XP leaderboard for today, this week, this month or all time',
        security: [{ bearerAuth: [] }],
        querystring: z.object({
          period: periodSchema.default('all'),
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
      const { period, limit } = request.query;

      let periodStart: Date | null = null;
      let rows: LeaderboardRow[];
      let meRows: PersonalRankRow[];

      if (period === 'all') {
        const [board, personal] = await Promise.all([
          app.db.query<LeaderboardRow>(
            `SELECT id, username, total_xp::bigint AS xp, total_xp,
                    RANK() OVER (ORDER BY total_xp DESC)::int AS rank
             FROM app_user
             WHERE total_xp > 0
             ORDER BY total_xp DESC, username ASC, id ASC
             LIMIT $1`,
            [limit],
          ),
          app.db.query<PersonalRankRow>(
            `SELECT u.total_xp::bigint AS xp, u.total_xp,
                    CASE WHEN u.total_xp > 0 THEN
                      (SELECT count(*) FROM app_user o WHERE o.total_xp > u.total_xp)::int + 1
                    ELSE NULL END AS rank
             FROM app_user u WHERE u.id = $1`,
            [request.user.id],
          ),
        ]);
        rows = board.rows;
        meRows = personal.rows;
      } else {
        const { view, bucket } = PERIODS[period];
        const bounds = await app.db.query<{ start: Date; end: Date }>(
          `SELECT time_bucket($1::interval, now()) AS start,
                  time_bucket($1::interval, now()) + $1::interval AS end`,
          [bucket],
        );
        const { start, end } = bounds.rows[0]!;
        periodStart = start;

        // The aggregates are real-time, so XP earned since the last refresh still counts.
        // The current week and month are never materialized yet, so their rows are rolled
        // up from the daily aggregate on read. Filtering on a range of fixed values, not
        // bucket = time_bucket(..., now()), lets TimescaleDB push it down to that index.
        // Users whose XP in the period nets to zero or less are left off the board.
        const [board, personal] = await Promise.all([
          app.db.query<LeaderboardRow>(
            `SELECT u.id, u.username, b.xp, u.total_xp,
                    RANK() OVER (ORDER BY b.xp DESC)::int AS rank
             FROM ${view} b
             JOIN app_user u ON u.id = b.user_id
             WHERE b.bucket >= $1 AND b.bucket < $2 AND b.xp > 0
             ORDER BY b.xp DESC, u.username ASC, u.id ASC
             LIMIT $3`,
            [start, end, limit],
          ),
          app.db.query<PersonalRankRow>(
            `SELECT COALESCE(b.xp, 0)::bigint AS xp, u.total_xp,
                    CASE WHEN b.xp > 0 THEN
                      (SELECT count(*) FROM ${view} o
                       JOIN app_user ou ON ou.id = o.user_id
                       WHERE o.bucket >= $1 AND o.bucket < $2 AND o.xp > b.xp)::int + 1
                    ELSE NULL END AS rank
             FROM app_user u
             LEFT JOIN ${view} b ON b.user_id = u.id AND b.bucket >= $1 AND b.bucket < $2
             WHERE u.id = $3`,
            [start, end, request.user.id],
          ),
        ]);
        rows = board.rows;
        meRows = personal.rows;
      }

      const me = meRows[0];
      if (!me) throw new HttpError(401, 'INVALID_ACCESS_TOKEN', 'Access token is invalid');

      return {
        period,
        periodStart: periodStart?.toISOString() ?? null,
        entries: rows.map((row) => ({
          rank: row.rank,
          userId: row.id,
          username: row.username,
          xp: Number(row.xp),
          totalXp: row.total_xp,
        })),
        limit,
        me: { rank: me.rank, xp: Number(me.xp), totalXp: me.total_xp },
      };
    },
  );
};

export default leaderboardRoutes;
