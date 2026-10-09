-- 001_initial_schema.sql
-- Initial CleanPursuit schema (Hack Knight MVP).
--
-- Core model:
--   report --1:0..1-- quest --1:N-- party --1:N-- party_member
--   A report is one user's sighting. Re-reports of the same spot are their own rows
--   that point at the original via duplicate_of_report_id (one level deep).
--   A quest is the problem to clean up. A party is one outing on a quest: scheduled
--   (an "event") or walk-up (on a "bounty"). Event vs bounty is derived, not stored.
--   activity_event is the append-only hypertable behind XP, leaderboards, hotspots
--   and the dashboard. presence_ping is the GPS hypertable behind geofenced check-ins.

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS h3;
CREATE EXTENSION IF NOT EXISTS h3_postgis CASCADE;  -- pulls in postgis_raster
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

CREATE TYPE difficulty_tier AS ENUM ('easy', 'medium', 'hard', 'legendary');
CREATE TYPE tag_source AS ENUM ('user', 'gemini');
CREATE TYPE quest_status AS ENUM ('open', 'completed', 'cancelled', 'expired');
CREATE TYPE party_status AS ENUM (
  'scheduled',  -- has a time slot, nobody checked in yet
  'active',     -- at least one member checked in
  'partial',    -- ended by the leader, quest still needs work
  'completed',  -- ended by the leader, quest is done
  'abandoned',  -- everyone left without the leader submitting an after photo
  'cancelled'   -- scheduled party called off before it started
);
CREATE TYPE party_member_status AS ENUM ('signed_up', 'checked_in', 'left', 'no_show');
CREATE TYPE party_leave_reason AS ENUM ('voluntary', 'geofence_timeout', 'party_ended');
CREATE TYPE guild_role AS ENUM ('owner', 'member');
CREATE TYPE dropoff_source AS ENUM ('seed', 'google_places');
CREATE TYPE activity_kind AS ENUM (
  'report_submitted',
  'party_checked_in',
  'party_left',
  'party_ended',        -- one row per party, carries bag_count
  'party_xp_awarded',   -- one row per checked-in member, carries xp and minutes_on_site
  'quest_completed',
  'hotspot_bonus',
  'xp_adjustment'       -- the only kind that may carry negative xp
);

-- ---------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------

CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- Users, auth, files
-- ---------------------------------------------------------------------------

CREATE TABLE app_user (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  username        citext NOT NULL UNIQUE CHECK (username ~ '^[A-Za-z0-9_]{3,32}$'),
  email           citext NOT NULL UNIQUE CHECK (position('@' IN email) > 1),
  password_hash   text NOT NULL,          -- argon2id, hashed in the API
  avatar_file_id  uuid,                   -- FK added after file exists
  total_xp        integer NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER app_user_set_updated_at
  BEFORE UPDATE ON app_user
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE refresh_token (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  user_id         uuid NOT NULL REFERENCES app_user (id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,   -- store a hash, never the raw token
  replaced_by_id  uuid REFERENCES refresh_token (id),  -- rotation chain, for reuse detection
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_token_user_id_idx ON refresh_token (user_id);

-- One row per object in Cloudflare R2. Owners point at files, files do not point at owners.
CREATE TABLE file (
  id                   uuid PRIMARY KEY DEFAULT uuidv7(),
  key                  text NOT NULL UNIQUE,  -- object key in the R2 bucket
  content_type         text NOT NULL CHECK (content_type LIKE 'image/%'),
  size_bytes           bigint NOT NULL CHECK (size_bytes > 0),
  uploaded_by_user_id  uuid NOT NULL REFERENCES app_user (id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX file_uploaded_by_user_id_idx ON file (uploaded_by_user_id);

ALTER TABLE app_user
  ADD CONSTRAINT app_user_avatar_file_id_fkey
  FOREIGN KEY (avatar_file_id) REFERENCES file (id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- Guilds (tables exist for guild_id snapshots; no guild features in the MVP)
-- ---------------------------------------------------------------------------

CREATE TABLE guild (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  name                citext NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 3 AND 40),
  description         text CHECK (char_length(description) <= 500),
  logo_file_id        uuid REFERENCES file (id) ON DELETE SET NULL,
  created_by_user_id  uuid NOT NULL REFERENCES app_user (id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER guild_set_updated_at
  BEFORE UPDATE ON guild
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE guild_member (
  guild_id   uuid NOT NULL REFERENCES guild (id) ON DELETE CASCADE,
  user_id    uuid NOT NULL UNIQUE REFERENCES app_user (id) ON DELETE CASCADE,  -- one guild per user
  role       guild_role NOT NULL DEFAULT 'member',
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Equipment lookup (gear list is derived from a report's categories and hazards)
-- ---------------------------------------------------------------------------

CREATE TABLE trash_category (
  code   text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
  label  text NOT NULL
);

CREATE TABLE hazard (
  code              text PRIMARY KEY CHECK (code ~ '^[a-z_]+$'),
  label             text NOT NULL,
  warning_text      text NOT NULL,
  requires_dropoff  boolean NOT NULL DEFAULT false  -- triggers the drop-off lookup for the quest
);

CREATE TABLE item (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  name         text NOT NULL UNIQUE,
  description  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE category_item (
  category_code  text NOT NULL REFERENCES trash_category (code) ON DELETE CASCADE,
  item_id        uuid NOT NULL REFERENCES item (id) ON DELETE CASCADE,
  PRIMARY KEY (category_code, item_id)
);

CREATE INDEX category_item_item_id_idx ON category_item (item_id);

CREATE TABLE hazard_item (
  hazard_code  text NOT NULL REFERENCES hazard (code) ON DELETE CASCADE,
  item_id      uuid NOT NULL REFERENCES item (id) ON DELETE CASCADE,
  PRIMARY KEY (hazard_code, item_id)
);

CREATE INDEX hazard_item_item_id_idx ON hazard_item (item_id);

-- ---------------------------------------------------------------------------
-- Reports
-- ---------------------------------------------------------------------------

CREATE TABLE report (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  reporter_user_id        uuid NOT NULL REFERENCES app_user (id),
  photo_file_id           uuid NOT NULL UNIQUE REFERENCES file (id),
  description             text NOT NULL CHECK (char_length(description) BETWEEN 1 AND 2000),
  location                geography(Point, 4326) NOT NULL,
  -- ~75 m edge H3 hexagon, the hotspot grid cell. Derived so it can never disagree with location.
  area_id                 h3index NOT NULL
                            GENERATED ALWAYS AS (h3_lat_lng_to_cell(location::geometry, 10)) STORED,
  duplicate_of_report_id  uuid REFERENCES report (id),
  difficulty_tier         difficulty_tier NOT NULL,  -- set by API rules from tags; provisional until a party ends
  estimated_bag_count     integer CHECK (estimated_bag_count > 0),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (duplicate_of_report_id <> id)
);

CREATE INDEX report_location_idx ON report USING gist (location);
CREATE INDEX report_area_id_created_at_idx ON report (area_id, created_at DESC);
CREATE INDEX report_reporter_user_id_idx ON report (reporter_user_id);
CREATE INDEX report_duplicate_of_report_id_idx ON report (duplicate_of_report_id)
  WHERE duplicate_of_report_id IS NOT NULL;

CREATE TABLE report_category (
  report_id      uuid NOT NULL REFERENCES report (id) ON DELETE CASCADE,
  category_code  text NOT NULL REFERENCES trash_category (code),
  source         tag_source NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, category_code)
);

CREATE TABLE report_hazard (
  report_id    uuid NOT NULL REFERENCES report (id) ON DELETE CASCADE,
  hazard_code  text NOT NULL REFERENCES hazard (code),
  source       tag_source NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (report_id, hazard_code)
);

-- ---------------------------------------------------------------------------
-- Quests
-- ---------------------------------------------------------------------------

CREATE TABLE quest (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  report_id             uuid NOT NULL UNIQUE REFERENCES report (id),
  created_by_user_id    uuid NOT NULL REFERENCES app_user (id),
  title                 text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 80),
  status                quest_status NOT NULL DEFAULT 'open',
  expires_at            timestamptz,
  completed_at          timestamptz,
  dropoffs_fetched_at   timestamptz,  -- set once the drop-off lookup ran, even if it found nothing
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK (expires_at IS NULL OR expires_at > created_at)
);

CREATE INDEX quest_created_by_user_id_idx ON quest (created_by_user_id);
CREATE INDEX quest_open_idx ON quest (created_at DESC) WHERE status = 'open';

CREATE TRIGGER quest_set_updated_at
  BEFORE UPDATE ON quest
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Duplicates always point at an original, and only originals can have a quest.
CREATE FUNCTION enforce_report_duplicate_rules() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.duplicate_of_report_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM report
               WHERE id = NEW.duplicate_of_report_id AND duplicate_of_report_id IS NOT NULL) THEN
      RAISE EXCEPTION 'report % must point at an original report, not a duplicate', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM report WHERE duplicate_of_report_id = NEW.id) THEN
      RAISE EXCEPTION 'report % has duplicates and cannot itself be a duplicate', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM quest WHERE report_id = NEW.id) THEN
      RAISE EXCEPTION 'report % has a quest and cannot be a duplicate', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER report_enforce_duplicate_rules
  BEFORE INSERT OR UPDATE OF duplicate_of_report_id ON report
  FOR EACH ROW EXECUTE FUNCTION enforce_report_duplicate_rules();

CREATE FUNCTION enforce_quest_report_is_original() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM report
             WHERE id = NEW.report_id AND duplicate_of_report_id IS NOT NULL) THEN
    RAISE EXCEPTION 'quest must be created from an original report, % is a duplicate', NEW.report_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quest_enforce_report_is_original
  BEFORE INSERT OR UPDATE OF report_id ON quest
  FOR EACH ROW EXECUTE FUNCTION enforce_quest_report_is_original();

-- ---------------------------------------------------------------------------
-- Parties
-- ---------------------------------------------------------------------------

CREATE TABLE party (
  id                    uuid PRIMARY KEY DEFAULT uuidv7(),
  quest_id              uuid NOT NULL REFERENCES quest (id),
  leader_user_id        uuid NOT NULL,  -- must be a member, see deferred FK below
  status                party_status NOT NULL,
  scheduled_start       timestamptz,    -- set = scheduled party ("event"), NULL = walk-up ("bounty")
  scheduled_end         timestamptz,
  started_at            timestamptz,    -- first check-in
  ended_at              timestamptz,
  bag_count             integer CHECK (bag_count >= 0),
  after_photo_file_id   uuid UNIQUE REFERENCES file (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK ((scheduled_start IS NULL) = (scheduled_end IS NULL)),
  CHECK (scheduled_end > scheduled_start),
  CHECK (status <> 'scheduled' OR (scheduled_start IS NOT NULL AND started_at IS NULL)),
  CHECK (status NOT IN ('active', 'partial', 'completed') OR started_at IS NOT NULL),
  CHECK ((status IN ('scheduled', 'active')) = (ended_at IS NULL)),
  CHECK ((status IN ('partial', 'completed')) = (after_photo_file_id IS NOT NULL)),
  CHECK ((status IN ('partial', 'completed')) = (bag_count IS NOT NULL)),
  CHECK (ended_at >= started_at)
);

CREATE INDEX party_quest_id_idx ON party (quest_id);
CREATE INDEX party_leader_user_id_idx ON party (leader_user_id);
CREATE INDEX party_upcoming_idx ON party (scheduled_start) WHERE status = 'scheduled';
-- Walk-ups join the quest's live walk-up party instead of starting a second one.
CREATE UNIQUE INDEX party_one_active_walkup_per_quest_idx ON party (quest_id)
  WHERE status = 'active' AND scheduled_start IS NULL;

CREATE TRIGGER party_set_updated_at
  BEFORE UPDATE ON party
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE party_member (
  party_id         uuid NOT NULL REFERENCES party (id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES app_user (id),
  status           party_member_status NOT NULL DEFAULT 'signed_up',
  signed_up_at     timestamptz NOT NULL DEFAULT now(),
  checked_in_at    timestamptz,
  last_on_site_at  timestamptz,  -- latest on-site presence_ping; drives the 30 min geofence timeout
  left_at          timestamptz,
  left_reason      party_leave_reason,
  PRIMARY KEY (party_id, user_id),
  CHECK ((status IN ('checked_in', 'left')) = (checked_in_at IS NOT NULL)),
  CHECK ((status = 'left') = (left_at IS NOT NULL)),
  CHECK ((status = 'left') = (left_reason IS NOT NULL)),
  CHECK (last_on_site_at >= checked_in_at),
  CHECK (left_at >= checked_in_at)
);

CREATE INDEX party_member_user_id_idx ON party_member (user_id);
CREATE INDEX party_member_geofence_idx ON party_member (last_on_site_at)
  WHERE status = 'checked_in';

-- The leader is always a member of their own party. Deferred so a party and its
-- leader's membership row can be inserted in the same transaction.
ALTER TABLE party
  ADD CONSTRAINT party_leader_is_member_fkey
  FOREIGN KEY (id, leader_user_id) REFERENCES party_member (party_id, user_id)
  DEFERRABLE INITIALLY DEFERRED;

-- ---------------------------------------------------------------------------
-- Biohazard drop-off locations
-- ---------------------------------------------------------------------------

-- Google Places terms only allow storing place IDs indefinitely, so Places rows keep
-- the ID and the API refetches details. Hand-verified seed rows carry full details.
CREATE TABLE dropoff_location (
  id               uuid PRIMARY KEY DEFAULT uuidv7(),
  source           dropoff_source NOT NULL,
  google_place_id  text UNIQUE,
  name             text,
  address          text,
  location         geography(Point, 4326),
  accepts_sharps   boolean NOT NULL DEFAULT true,
  verified_at      timestamptz,
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'google_places') = (google_place_id IS NOT NULL)),
  CHECK (source <> 'seed' OR (name IS NOT NULL AND address IS NOT NULL AND location IS NOT NULL))
);

CREATE INDEX dropoff_location_location_idx ON dropoff_location USING gist (location);

CREATE TRIGGER dropoff_location_set_updated_at
  BEFORE UPDATE ON dropoff_location
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Snapshot of the nearest drop-offs, fetched once per biohazard quest.
CREATE TABLE quest_dropoff (
  quest_id             uuid NOT NULL REFERENCES quest (id) ON DELETE CASCADE,
  dropoff_location_id  uuid NOT NULL REFERENCES dropoff_location (id),
  distance_m           integer NOT NULL CHECK (distance_m >= 0),
  rank                 smallint NOT NULL CHECK (rank > 0),
  PRIMARY KEY (quest_id, dropoff_location_id),
  UNIQUE (quest_id, rank)
);

CREATE INDEX quest_dropoff_dropoff_location_id_idx ON quest_dropoff (dropoff_location_id);

-- ---------------------------------------------------------------------------
-- Hypertables
-- ---------------------------------------------------------------------------

-- Append-only log of everything that happened. Source for XP, leaderboards,
-- hotspots and the dashboard. guild_id and area_id are snapshots at event time.
CREATE TABLE activity_event (
  id               uuid NOT NULL DEFAULT uuidv7(),
  occurred_at      timestamptz NOT NULL DEFAULT now(),
  kind             activity_kind NOT NULL,
  user_id          uuid NOT NULL REFERENCES app_user (id),
  guild_id         uuid REFERENCES guild (id),
  area_id          h3index,
  report_id        uuid REFERENCES report (id),
  quest_id         uuid REFERENCES quest (id),
  party_id         uuid REFERENCES party (id),
  xp               integer NOT NULL DEFAULT 0,
  bag_count        integer CHECK (bag_count >= 0),
  minutes_on_site  integer CHECK (minutes_on_site >= 0),
  PRIMARY KEY (id, occurred_at),
  CHECK (kind = 'xp_adjustment' OR xp >= 0),
  CHECK (kind <> 'report_submitted' OR (report_id IS NOT NULL AND area_id IS NOT NULL)),
  CHECK (kind NOT IN ('party_checked_in', 'party_left', 'party_ended', 'party_xp_awarded')
         OR party_id IS NOT NULL),
  CHECK (kind <> 'party_ended' OR bag_count IS NOT NULL),
  CHECK (kind <> 'party_xp_awarded' OR minutes_on_site IS NOT NULL),
  CHECK (kind <> 'quest_completed' OR quest_id IS NOT NULL)
) WITH (
  tsdb.hypertable,
  tsdb.partition_column = 'occurred_at',
  tsdb.chunk_interval = '7 days',
  tsdb.segmentby = 'user_id',
  tsdb.orderby = 'occurred_at DESC'
);

CREATE INDEX activity_event_user_id_occurred_at_idx ON activity_event (user_id, occurred_at DESC);
CREATE INDEX activity_event_kind_occurred_at_idx ON activity_event (kind, occurred_at DESC);
CREATE INDEX activity_event_reports_by_area_idx ON activity_event (area_id, occurred_at DESC)
  WHERE kind = 'report_submitted';

-- GPS pings while a member is in an active party. on_site is computed by the API
-- with ST_DWithin against the quest's report location.
CREATE TABLE presence_ping (
  party_id     uuid NOT NULL,
  user_id      uuid NOT NULL,
  recorded_at  timestamptz NOT NULL,
  location     geography(Point, 4326) NOT NULL,
  on_site      boolean NOT NULL,
  PRIMARY KEY (party_id, user_id, recorded_at),
  FOREIGN KEY (party_id, user_id) REFERENCES party_member (party_id, user_id) ON DELETE CASCADE
) WITH (
  tsdb.hypertable,
  tsdb.partition_column = 'recorded_at',
  tsdb.chunk_interval = '1 day',
  tsdb.segmentby = 'party_id',
  tsdb.orderby = 'recorded_at DESC'
);

-- Location history is only needed to settle a party. Keep it short for privacy.
SELECT add_retention_policy('presence_ping', drop_after => INTERVAL '30 days');

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

INSERT INTO trash_category (code, label) VALUES
  ('plastic',     'Plastic'),
  ('paper',       'Paper and cardboard'),
  ('glass',       'Glass bottles and jars'),
  ('metal',       'Cans and metal'),
  ('organic',     'Food and yard waste'),
  ('textiles',    'Clothing and fabric'),
  ('electronics', 'Electronics and batteries'),
  ('mixed',       'Mixed litter');

-- Volunteers are pointed to drop-off and escalation, never given sharps handling instructions.
INSERT INTO hazard (code, label, warning_text, requires_dropoff) VALUES
  ('sharps',       'Sharps',
   'Needles or syringes were reported here. Do not pick them up. Use the drop-off and escalation info for this quest.',
   true),
  ('biohazard',    'Biohazard',
   'Biological waste was reported here. Do not touch it. Use the drop-off and escalation info for this quest.',
   true),
  ('broken_glass', 'Broken glass',
   'Broken glass was reported here. Wear puncture-resistant gloves and closed-toe shoes.',
   false),
  ('chemicals',    'Chemicals',
   'Possible chemicals or unknown liquids were reported here. Do not open, mix, or pour out containers.',
   false),
  ('bulky_items',  'Bulky items',
   'Large or heavy items were reported here. Lift with a partner and do not move anything you cannot carry safely.',
   false);
