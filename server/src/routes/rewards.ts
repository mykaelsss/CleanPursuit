import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema } from '../lib/errors.ts';
import { settleParty } from '../lib/parties.ts';
import { perUserRateLimit } from '../lib/rate-limit.ts';
import { userSummarySchema } from '../lib/users.ts';

// The XP a member earned from a party that ended with an after photo, which the app shows once
// to everyone who checked in, whether or not they were still there when it ended.

const security = [{ bearerAuth: [] }];

const rewardSchema = z.object({
  partyId: z.uuid(),
  questId: z.uuid(),
  questTitle: z.string(),
  outcome: z.enum(['completed', 'partial']).describe('completed when the party finished the quest'),
  walkUp: z.boolean().describe('Whether the party was a walk-up rather than an event'),
  leader: userSummarySchema,
  endedAt: z.iso.datetime(),
  bagCount: z.number().int(),
  minutesOnSite: z.number().int(),
  baseXp: z.number().int().describe('XP for time on site'),
  bonusXp: z.number().int().describe('Hotspot bonus'),
  xp: z.number().int().describe('baseXp plus bonusXp'),
});

const rewardRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/me/rewards',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['parties'],
        summary: 'List XP rewards you have not seen yet, oldest first',
        description:
          'Mark each one seen with POST /me/rewards/{partyId}/seen once it has been shown. ' +
          '`pending` is true while a cleanup you checked in to is still under way, so a reward may follow.',
        security,
        response: {
          200: z.object({ rewards: z.array(rewardSchema), pending: z.boolean() }),
          401: errorSchema,
        },
      },
    },
    async (request) => {
      // Settle the cleanups still under way first, so one everybody walked away from
      // stops being pending.
      const underWay = () =>
        app.db.query<{ id: string }>(
          `SELECT p.id
           FROM party_member m
           JOIN party p ON p.id = m.party_id
           WHERE m.user_id = $1 AND m.checked_in_at IS NOT NULL AND p.status = 'active'
           ORDER BY p.id`,
          [request.user.id],
        );
      for (const party of (await underWay()).rows) await settleParty(app.db, party.id);
      const pending = (await underWay()).rows.length > 0;

      const { rows } = await app.db.query<{
        party_id: string;
        quest_id: string;
        quest_title: string;
        outcome: 'completed' | 'partial';
        walk_up: boolean;
        leader_id: string;
        leader_username: string;
        ended_at: Date;
        bag_count: number;
        minutes_on_site: number;
        base_xp: number;
        bonus_xp: number;
      }>(
        `SELECT p.id AS party_id, p.quest_id, q.title AS quest_title, p.status AS outcome,
                p.scheduled_start IS NULL AS walk_up, p.leader_user_id AS leader_id,
                u.username AS leader_username, p.ended_at, p.bag_count,
                coalesce(sum(a.minutes_on_site) FILTER (WHERE a.kind = 'party_xp_awarded'), 0)::integer
                  AS minutes_on_site,
                coalesce(sum(a.xp) FILTER (WHERE a.kind = 'party_xp_awarded'), 0)::integer AS base_xp,
                coalesce(sum(a.xp) FILTER (WHERE a.kind = 'hotspot_bonus'), 0)::integer AS bonus_xp
         FROM party_member m
         JOIN party p ON p.id = m.party_id
         JOIN quest q ON q.id = p.quest_id
         JOIN app_user u ON u.id = p.leader_user_id
         LEFT JOIN activity_event a
           ON a.party_id = p.id AND a.user_id = m.user_id
          AND a.kind IN ('party_xp_awarded', 'hotspot_bonus')
          AND a.occurred_at >= p.started_at
         WHERE m.user_id = $1
           AND m.reward_seen_at IS NULL
           AND m.checked_in_at IS NOT NULL
           AND p.status IN ('partial', 'completed')
         GROUP BY p.id, q.title, u.username
         ORDER BY p.ended_at, p.id
         LIMIT 20`,
        [request.user.id],
      );

      return {
        rewards: rows.map((row) => ({
          partyId: row.party_id,
          questId: row.quest_id,
          questTitle: row.quest_title,
          outcome: row.outcome,
          walkUp: row.walk_up,
          leader: { id: row.leader_id, username: row.leader_username },
          endedAt: row.ended_at.toISOString(),
          bagCount: row.bag_count,
          minutesOnSite: row.minutes_on_site,
          baseXp: row.base_xp,
          bonusXp: row.bonus_xp,
          xp: row.base_xp + row.bonus_xp,
        })),
        pending,
      };
    },
  );

  app.post(
    '/me/rewards/:partyId/seen',
    {
      onRequest: app.authenticate,
      config: { rateLimit: perUserRateLimit(120, '1 hour') },
      schema: {
        tags: ['parties'],
        summary: 'Mark a reward as seen, so it is not shown again',
        description: 'Marking a reward that is already seen, or that does not exist, does nothing.',
        security,
        params: z.object({ partyId: z.uuid() }),
        response: { 204: z.null(), 400: errorSchema, 401: errorSchema, 429: errorSchema },
      },
    },
    async (request, reply) => {
      await app.db.query(
        `UPDATE party_member m
         SET reward_seen_at = now()
         FROM party p
         WHERE p.id = m.party_id
           AND m.party_id = $1
           AND m.user_id = $2
           AND m.reward_seen_at IS NULL
           AND m.checked_in_at IS NOT NULL
           AND p.status IN ('partial', 'completed')`,
        [request.params.partyId, request.user.id],
      );
      return reply.status(204).send(null);
    },
  );
};

export default rewardRoutes;
