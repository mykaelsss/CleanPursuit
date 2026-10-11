import { z } from 'zod';
import { MEMBER_TIMEOUT_MINUTES } from './presence.ts';
import { userSummarySchema } from './users.ts';

// A quest's walk-up cleanup under way, if anyone is on site.
export const walkUpSchema = z
  .object({
    partyId: z.uuid(),
    leader: userSummarySchema,
    startedAt: z.iso.datetime(),
    checkedInCount: z.number().int().describe('Members on site now'),
  })
  .nullable()
  .describe('Check in with POST /quests/{id}/walk-up to join it, or to start one when this is null');

// A quest's live walk-up, joined as `w` onto a query with the quest as `q`. Members who have not been
// on site for the timeout no longer count, so a walk-up everyone walked away from does not show
// before it is settled.
export const WALK_UP_JOIN = `
  LEFT JOIN LATERAL (
    SELECT wp.id, wp.leader_user_id, wu.username AS leader_username, wp.started_at,
           (SELECT count(*)::integer FROM party_member wm
            WHERE wm.party_id = wp.id AND wm.status = 'checked_in'
              AND coalesce(wm.last_on_site_at, wm.checked_in_at)
                  >= now() - make_interval(mins => ${MEMBER_TIMEOUT_MINUTES})) AS checked_in_count
    FROM party wp
    JOIN app_user wu ON wu.id = wp.leader_user_id
    WHERE wp.quest_id = q.id AND wp.status = 'active' AND wp.scheduled_start IS NULL
  ) w ON w.checked_in_count > 0`;

export const WALK_UP_COLUMNS = `w.id AS walk_up_id, w.leader_user_id AS walk_up_leader_id,
  w.leader_username AS walk_up_leader_username, w.started_at AS walk_up_started_at,
  w.checked_in_count AS walk_up_checked_in_count`;

export interface WalkUpRow {
  walk_up_id: string | null;
  walk_up_leader_id: string | null;
  walk_up_leader_username: string | null;
  walk_up_started_at: Date | null;
  walk_up_checked_in_count: number | null;
}

export function toWalkUp(row: WalkUpRow): z.infer<typeof walkUpSchema> {
  if (!row.walk_up_id) return null;
  return {
    partyId: row.walk_up_id,
    leader: { id: row.walk_up_leader_id!, username: row.walk_up_leader_username! },
    startedAt: row.walk_up_started_at!.toISOString(),
    checkedInCount: row.walk_up_checked_in_count!,
  };
}
