-- 008_leaderboard_index.sql
-- Index for the all-time leaderboard, which ranks users by app_user.total_xp.
--
-- Leaderboard query shape: ORDER BY total_xp DESC, username LIMIT n
-- username breaks ties so the order is stable between requests.

CREATE INDEX app_user_total_xp_idx ON app_user (total_xp DESC, username);
