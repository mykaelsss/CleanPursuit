-- 010_party_rewards.sql
-- When a party ends with an after photo, everyone who checked in sees the XP they earned in the app.
-- reward_seen_at records that a member has seen it, so it shows once, on whichever device they use next.
-- Members of parties that ended before this migration have already been rewarded, so they are marked seen.

ALTER TABLE party_member
  ADD COLUMN reward_seen_at timestamptz,
  ADD CONSTRAINT party_member_reward_seen_after_check_in_check
    CHECK (reward_seen_at IS NULL OR checked_in_at IS NOT NULL);

UPDATE party_member pm
SET reward_seen_at = p.ended_at
FROM party p
WHERE p.id = pm.party_id
  AND p.status IN ('partial', 'completed')
  AND pm.checked_in_at IS NOT NULL;

-- Rewards query shape: WHERE user_id = $1 AND reward_seen_at IS NULL AND checked_in_at IS NOT NULL
CREATE INDEX party_member_unseen_reward_idx ON party_member (user_id)
  WHERE reward_seen_at IS NULL AND checked_in_at IS NOT NULL;
