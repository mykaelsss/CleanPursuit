import type pg from 'pg';
import { withTransaction } from './db.ts';
import { MEMBER_TIMEOUT_MINUTES } from './presence.ts';

// Presence rules for parties under way, applied lazily by the routes that touch a party.

type LockedParty = { id: string; questId: string; areaId: string };

// Applies the presence rules to an active party the caller has locked. Members
// with no on-site ping for MEMBER_TIMEOUT_MINUTES leave, then the party is handed
// off or abandoned if its leader is gone.
export async function settleLockedParty(client: pg.PoolClient, party: LockedParty) {
  await client.query(
    `WITH timed_out AS (
       UPDATE party_member
       SET status = 'left',
           left_at = coalesce(last_on_site_at, checked_in_at),
           left_reason = 'geofence_timeout'
       WHERE party_id = $1
         AND status = 'checked_in'
         AND coalesce(last_on_site_at, checked_in_at) < now() - make_interval(mins => $2)
       RETURNING user_id
     )
     INSERT INTO activity_event (kind, user_id, guild_id, area_id, quest_id, party_id)
     SELECT 'party_left', t.user_id, gm.guild_id, $3::h3index, $4, $1
     FROM timed_out t
     LEFT JOIN guild_member gm ON gm.user_id = t.user_id`,
    [party.id, MEMBER_TIMEOUT_MINUTES, party.areaId, party.questId],
  );

  await handOffOrAbandon(client, party.id);
}

// A party whose leader left is led by the member who checked in earliest and is
// still there. A walk-up with nobody checked in is abandoned, which frees the quest
// for the next walk-up. An event with nobody checked in keeps its leader until its
// scheduled end, so people on their way can still arrive and the first of them to
// check in leads; after the end it is abandoned.
export async function handOffOrAbandon(client: pg.PoolClient, partyId: string) {
  const present = await client.query<{ user_id: string }>(
    `SELECT user_id
     FROM party_member
     WHERE party_id = $1 AND status = 'checked_in'
     ORDER BY checked_in_at, user_id
     LIMIT 1`,
    [partyId],
  );

  const successor = present.rows[0];

  if (!successor) {
    await client.query(
      `UPDATE party p
       SET status = 'abandoned',
           ended_at = greatest(
             p.started_at,
             (SELECT max(left_at) FROM party_member WHERE party_id = p.id)
           )
       WHERE p.id = $1
         AND (p.scheduled_end IS NULL OR p.scheduled_end <= now())`,
      [partyId],
    );
    return;
  }

  await client.query(
    `UPDATE party p
     SET leader_user_id = $2
     WHERE p.id = $1
       AND EXISTS (
         SELECT 1 FROM party_member m
         WHERE m.party_id = p.id
           AND m.user_id = p.leader_user_id
           AND m.status = 'left'
       )`,
    [partyId, successor.user_id],
  );
}

// Marks a checked-in member of a locked party as having left by choice, then hands
// off or abandons the party. Returns false when the member was not checked in.
export async function leaveLockedParty(client: pg.PoolClient, party: LockedParty, userId: string): Promise<boolean> {
  const left = await client.query(
    `UPDATE party_member
     SET status = 'left',
         left_at = now(),
         left_reason = 'voluntary'
     WHERE party_id = $1 AND user_id = $2 AND status = 'checked_in'`,
    [party.id, userId],
  );

  if (left.rowCount === 0) return false;

  await client.query(
    `INSERT INTO activity_event
       (kind, user_id, guild_id, area_id, quest_id, party_id)
     SELECT 'party_left', $1, gm.guild_id, $2::h3index, $3, $4
     FROM (SELECT 1) one
     LEFT JOIN guild_member gm ON gm.user_id = $1`,
    [userId, party.areaId, party.questId, party.id],
  );

  await handOffOrAbandon(client, party.id);
  return true;
}

// One cleanup at a time: checking in to one leaves any other the user is checked in
// to, so time on site is never counted twice. `keep` is the event being checked in
// to, or the quest whose walk-up is being checked in to.
export async function leaveOtherParties(
  client: pg.PoolClient,
  userId: string,
  keep: { partyId: string } | { walkUpQuestId: string },
) {
  const elsewhere = await client.query<{ id: string; quest_id: string; area_id: string }>(
    `SELECT p.id, p.quest_id, r.area_id::text AS area_id
     FROM party p
     JOIN party_member m ON m.party_id = p.id
     JOIN quest q ON q.id = p.quest_id
     JOIN report r ON r.id = q.report_id
     WHERE m.user_id = $1
       AND m.status = 'checked_in'
       AND p.status = 'active'
       AND p.id IS DISTINCT FROM $2::uuid
       AND NOT coalesce(p.scheduled_start IS NULL AND p.quest_id = $3::uuid, false)
     ORDER BY p.id
     FOR UPDATE OF p`,
    [userId, 'partyId' in keep ? keep.partyId : null, 'walkUpQuestId' in keep ? keep.walkUpQuestId : null],
  );

  for (const other of elsewhere.rows) {
    await leaveLockedParty(client, { id: other.id, questId: other.quest_id, areaId: other.area_id }, userId);
  }
}

// Settles an active party in its own transaction, so timeouts and handoffs stand
// even when the request that noticed them is then rejected. Other parties are untouched.
export async function settleParty(db: pg.Pool, partyId: string) {
  await withTransaction(db, async (client) => {
    const result = await client.query<{ quest_id: string; area_id: string }>(
      `SELECT p.quest_id, r.area_id::text AS area_id
       FROM party p
       JOIN quest q ON q.id = p.quest_id
       JOIN report r ON r.id = q.report_id
       WHERE p.id = $1 AND p.status = 'active'
       FOR UPDATE OF p`,
      [partyId],
    );

    const party = result.rows[0];
    if (!party) return;

    await settleLockedParty(client, { id: partyId, questId: party.quest_id, areaId: party.area_id });
  });
}
