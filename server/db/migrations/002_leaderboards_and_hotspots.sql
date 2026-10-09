-- 002_leaderboards_and_hotspots.sql
-- Continuous aggregates over activity_event.
--
--   xp_daily_by_user  --> xp_weekly_by_user
--                     --> xp_monthly_by_user
--   report_daily_by_area_reporter --> area_hotspot_30d (plain view)
--
-- All aggregates are real-time (materialized_only = false), so rows written since the
-- last refresh still show up. Buckets are in UTC. All-time XP is app_user.total_xp.
--
-- Refresh policies only look back a few days. After backfilling seed data, refresh
-- the full range by hand (daily first, then the rollups built on it):
--   CALL refresh_continuous_aggregate('xp_daily_by_user', NULL, NULL);
--   CALL refresh_continuous_aggregate('xp_weekly_by_user', NULL, NULL);
--   CALL refresh_continuous_aggregate('xp_monthly_by_user', NULL, NULL);
--   CALL refresh_continuous_aggregate('report_daily_by_area_reporter', NULL, NULL);

-- ---------------------------------------------------------------------------
-- XP leaderboards
-- ---------------------------------------------------------------------------

CREATE MATERIALIZED VIEW xp_daily_by_user
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 day', occurred_at) AS bucket,
  user_id,
  sum(xp)::bigint AS xp,
  coalesce(sum(minutes_on_site) FILTER (WHERE kind = 'party_xp_awarded'), 0)::bigint AS minutes_on_site,
  count(*) FILTER (WHERE kind = 'party_xp_awarded') AS parties
FROM activity_event
GROUP BY bucket, user_id
WITH NO DATA;

CREATE MATERIALIZED VIEW xp_weekly_by_user
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 week', bucket) AS bucket,
  user_id,
  sum(xp)::bigint AS xp,
  sum(minutes_on_site)::bigint AS minutes_on_site,
  sum(parties)::bigint AS parties
FROM xp_daily_by_user
GROUP BY 1, user_id
WITH NO DATA;

CREATE MATERIALIZED VIEW xp_monthly_by_user
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 month', bucket) AS bucket,
  user_id,
  sum(xp)::bigint AS xp,
  sum(minutes_on_site)::bigint AS minutes_on_site,
  sum(parties)::bigint AS parties
FROM xp_daily_by_user
GROUP BY 1, user_id
WITH NO DATA;

-- Leaderboard query shape: WHERE bucket = $1 ORDER BY xp DESC LIMIT n
CREATE INDEX xp_daily_by_user_bucket_xp_idx ON xp_daily_by_user (bucket, xp DESC);
CREATE INDEX xp_weekly_by_user_bucket_xp_idx ON xp_weekly_by_user (bucket, xp DESC);
CREATE INDEX xp_monthly_by_user_bucket_xp_idx ON xp_monthly_by_user (bucket, xp DESC);

-- Short refresh on the daily aggregate so the demo never lags.
SELECT add_continuous_aggregate_policy('xp_daily_by_user',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '5 minutes');

SELECT add_continuous_aggregate_policy('xp_weekly_by_user',
  start_offset => INTERVAL '3 weeks',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 hour');

SELECT add_continuous_aggregate_policy('xp_monthly_by_user',
  start_offset => INTERVAL '3 months',
  end_offset => INTERVAL '1 day',
  schedule_interval => INTERVAL '1 hour');

-- ---------------------------------------------------------------------------
-- Hotspots
-- ---------------------------------------------------------------------------

-- Grouped by reporter so distinct reporters can be counted over any window.
-- Distinct counts cannot be summed across buckets, so this keeps the reporter dimension.
CREATE MATERIALIZED VIEW report_daily_by_area_reporter
WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
SELECT
  time_bucket(INTERVAL '1 day', occurred_at) AS bucket,
  area_id,
  user_id AS reporter_user_id,
  count(*) AS reports
FROM activity_event
WHERE kind = 'report_submitted'
GROUP BY bucket, area_id, user_id
WITH NO DATA;

CREATE INDEX report_daily_by_area_reporter_area_bucket_idx
  ON report_daily_by_area_reporter (area_id, bucket DESC);

SELECT add_continuous_aggregate_policy('report_daily_by_area_reporter',
  start_offset => INTERVAL '3 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '5 minutes');

-- Heat map and hotspot bonus source. distinct_reporters drives both, so one person
-- re-reporting the same spot cannot heat it up on their own. The bonus threshold
-- (e.g. 3+ distinct reporters) lives in the API.
CREATE VIEW area_hotspot_30d AS
SELECT
  area_id,
  count(DISTINCT reporter_user_id) AS distinct_reporters,
  sum(reports)::bigint AS reports,
  max(bucket) AS last_reported_day
FROM report_daily_by_area_reporter
WHERE bucket >= time_bucket(INTERVAL '1 day', now() - INTERVAL '30 days')
GROUP BY area_id;
