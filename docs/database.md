# CleanPursuit database design

The database is a Tiger Cloud service running Postgres 18 with TimescaleDB, PostGIS, H3 and citext.
It has 20 tables, 2 of which are hypertables, plus 4 continuous aggregates and 1 view.
The source of truth is the SQL in `server/db/migrations/`; this file explains the shape and the reasons behind it.

For the product side, see [mvp.md](mvp.md).

## Environment

| What | Value |
| --- | --- |
| Service | `clean-pursuit` (id `sm60nzjanh`), DEV, us-east-1 |
| Postgres | 18.6, with built-in `uuidv7()` |
| Extensions | TimescaleDB 2.30, PostGIS 3.6, h3 + h3_postgis 4.2 (pulls in postgis_raster), citext |
| Applied | `001_initial_schema.sql`, `002_leaderboards_and_hotspots.sql` |
| Credentials | Connection string stored in Infisical, never in the repo |

## Conventions

- Every surrogate key is `uuid DEFAULT uuidv7()`, so ids sort by creation time.
- Lookup tables (`trash_category`, `hazard`) use a short text `code` as the key.
- Mutable tables have `created_at` and `updated_at`, with a `set_updated_at()` trigger.
- Status columns are Postgres enums, and CHECK constraints keep each status consistent with its timestamps and fields.
- Usernames, emails and guild names are `citext`, so uniqueness ignores case.
- Locations are `geography(Point, 4326)` with GiST indexes.
- Applied migrations are never edited.
  Changes go in a new numbered migration.

## Relationship diagram

Arrows read from the one side to the many side.
Snapshot links from `activity_event` are included.

```mermaid
erDiagram
  app_user ||--o{ refresh_token : "signs in with"
  refresh_token |o--o| refresh_token : "replaced by"
  app_user ||--o{ file : uploads
  app_user }o--o| file : "avatar"

  app_user ||--o{ report : reports
  file ||--o| report : "photo of"
  report |o--o{ report : "duplicated by"
  report ||--o{ report_category : tagged
  trash_category ||--o{ report_category : ""
  report ||--o{ report_hazard : flagged
  hazard ||--o{ report_hazard : ""

  trash_category ||--o{ category_item : needs
  hazard ||--o{ hazard_item : needs
  item ||--o{ category_item : ""
  item ||--o{ hazard_item : ""

  report ||--o| quest : "becomes"
  app_user ||--o{ quest : creates
  quest ||--o{ party : "attempted by"
  party ||--|{ party_member : has
  app_user ||--o{ party_member : joins
  party }o--|| party_member : "led by"
  file ||--o| party : "after photo"
  party_member ||--o{ presence_ping : pings

  quest ||--o{ quest_dropoff : "nearest"
  dropoff_location ||--o{ quest_dropoff : ""

  app_user ||--o{ guild : creates
  guild }o--o| file : "logo"
  guild ||--o{ guild_member : has
  app_user ||--o| guild_member : "belongs to"

  app_user ||--o{ activity_event : does
  guild |o--o{ activity_event : "snapshot"
  report |o--o{ activity_event : ""
  quest |o--o{ activity_event : ""
  party |o--o{ activity_event : ""
```

## Tables

### Users, auth and files

| Table | Purpose |
| --- | --- |
| `app_user` | One row per account. Holds `username`, `email`, the argon2id `password_hash`, an optional avatar, and `total_xp` (the all-time leaderboard). |
| `refresh_token` | Refresh tokens for JWT auth. Stores only a hash. `replaced_by_id` chains rotations so token reuse can be detected and the chain revoked. |
| `file` | One row per object in Cloudflare R2: `key`, `content_type` (images only), `size_bytes`, uploader. Owners point at files; files never point at owners. The API writes a row only after checking the uploaded object. |

### Reports and tags

| Table | Purpose |
| --- | --- |
| `report` | One user's sighting: photo, description, location, `difficulty_tier`, optional `estimated_bag_count`. `area_id` is generated from the location. |
| `report_category` | Trash categories on a report, with `source` (`user` or `gemini`). |
| `report_hazard` | Hazard flags on a report, with `source`. |

Duplicate rules, enforced by triggers:

- Re-reporting a known spot creates a new `report` row whose `duplicate_of_report_id` points at the original.
- A duplicate always points at an original, never at another duplicate (one level deep).
- A report that has duplicates, or has a quest, cannot become a duplicate.
- Only an original report can become a quest.

`area_id` is `h3_lat_lng_to_cell(location, 10)`, a hexagon with an edge of about 75 m.
It is a stored generated column, so it can never disagree with the location.

`difficulty_tier` is set by API rules from the tags, not by Gemini directly.
It is provisional until a party ends, when the leader can correct the tags.

### Quests and parties

| Table | Purpose |
| --- | --- |
| `quest` | The problem to clean up, created from one original report (`report_id` is unique). `created_by_user_id` is the person raising awareness, not an organizer. Status: `open`, `completed`, `cancelled`, `expired`. |
| `party` | One attempt at a quest. `scheduled_start`/`scheduled_end` set means an event; both null means a walk-up on a bounty. Ends with `after_photo_file_id` and `bag_count`. |
| `party_member` | A user in a party: sign-up, check-in, last on-site time, and how they left. |

Party rules enforced in the database:

- `leader_user_id` is required and must be a member of the party (a deferred composite FK to `party_member`, so both rows can be inserted in one transaction).
- Only one active walk-up party per quest, so walk-ups join the live party instead of starting a second one.
- `scheduled` needs a schedule and no start; `active`, `partial` and `completed` need `started_at`.
- `partial` and `completed` need an after photo and a bag count; any ended status needs `ended_at`.
- A member who is `checked_in` or `left` has `checked_in_at`; a member who `left` has `left_at` and `left_reason` (`voluntary`, `geofence_timeout`, `party_ended`).

Party statuses:

```mermaid
stateDiagram-v2
  [*] --> scheduled: event created with a time slot
  [*] --> active: walk-up, first check-in
  scheduled --> active: first check-in
  scheduled --> cancelled: called off before start
  active --> completed: leader ends with photo and bag count
  active --> partial: leader ends with photo and bag count
  active --> abandoned: everyone left without a photo
  completed --> [*]
  partial --> [*]
  abandoned --> [*]
  cancelled --> [*]
```

Rules that live in the API, not the database:

- The first check-in on a walk-up becomes the leader.
- If the leader leaves without handing off, the longest-present member is promoted.
- A member with no on-site ping for 30 minutes is marked `left` with `geofence_timeout`.
- `presence_ping.on_site` is computed with `ST_DWithin` against the quest's report location.

### Equipment lookup

| Table | Purpose |
| --- | --- |
| `trash_category` | Fixed category list, seeded: plastic, paper, glass, metal, organic, textiles, electronics, mixed. |
| `hazard` | Fixed hazard list with `warning_text` and `requires_dropoff`, seeded: sharps, biohazard, broken_glass, chemicals, bulky_items. |
| `item` | A piece of gear, such as gloves or grabbers. Not seeded yet. |
| `category_item` | Gear needed for a category. |
| `hazard_item` | Gear needed for a hazard. |

The gear list for a quest is derived by joining its report's tags to these tables, so Gemini is never called again for gear.
Hazard warnings never include sharps handling instructions; they point to drop-off and escalation.

### Drop-off locations

| Table | Purpose |
| --- | --- |
| `dropoff_location` | Sharps and biohazard drop-off sites. `seed` rows are hand-verified and carry name, address and location. `google_places` rows store only `google_place_id`, because Places terms limit caching; the API refetches details. |
| `quest_dropoff` | The nearest drop-offs for a quest, fetched once, with `distance_m` and `rank`. `quest.dropoffs_fetched_at` records that the lookup ran, even if it found nothing. |

### Guilds (not in the MVP)

| Table | Purpose |
| --- | --- |
| `guild` | A team with a name, description, logo and creator. |
| `guild_member` | Membership with a role (`owner` or `member`). `user_id` is unique, so a user is in at most one guild. |

The tables exist so `activity_event.guild_id` can be captured from day one.
There are no guild features in the MVP.

### Hypertables

| Table | Purpose |
| --- | --- |
| `activity_event` | Append-only log of everything that happened. Source for XP, leaderboards, hotspots and the dashboard. 7-day chunks, segmented by `user_id`. Primary key `(id, occurred_at)`. |
| `presence_ping` | GPS pings from checked-in members during a party. 1-day chunks, segmented by `party_id`, dropped after 30 days for privacy. |

`activity_event` kinds:

| Kind | Meaning | Required fields |
| --- | --- | --- |
| `report_submitted` | A report was filed | `report_id`, `area_id` |
| `party_checked_in` | A member checked in | `party_id` |
| `party_left` | A member left | `party_id` |
| `party_ended` | The leader ended the party (one row per party) | `party_id`, `bag_count` |
| `party_xp_awarded` | XP for one checked-in member | `party_id`, `minutes_on_site` |
| `quest_completed` | A quest was completed | `quest_id` |
| `hotspot_bonus` | Bonus XP for cleaning a hotspot | |
| `xp_adjustment` | Manual correction; the only kind that may carry negative XP | |

`guild_id` and `area_id` are snapshots taken when the event happens.

## Leaderboards and hotspots

All aggregates are real-time (`materialized_only = false`) and bucket in UTC.

| Object | Kind | Built from | Refresh |
| --- | --- | --- | --- |
| `xp_daily_by_user` | Continuous aggregate | `activity_event` | Every 5 min, last 3 days |
| `xp_weekly_by_user` | Continuous aggregate | `xp_daily_by_user` | Every hour, last 3 weeks |
| `xp_monthly_by_user` | Continuous aggregate | `xp_daily_by_user` | Every hour, last 3 months |
| `report_daily_by_area_reporter` | Continuous aggregate | `activity_event` (`report_submitted`) | Every 5 min, last 3 days |
| `area_hotspot_30d` | Plain view | `report_daily_by_area_reporter` | Always current |

- XP aggregates carry `xp`, `minutes_on_site` and `parties` per user per bucket, indexed on `(bucket, xp DESC)`.
- All-time XP is `app_user.total_xp`.
- `area_hotspot_30d` returns `distinct_reporters`, `reports` and `last_reported_day` per `area_id` for the last 30 days.
- The heat map and the hotspot bonus use `distinct_reporters`, so one person re-reporting a spot cannot heat it up alone.
- The bonus threshold (for example 3 or more reporters) lives in the API.
- The dashboard groups areas with `h3_cell_to_parent(area_id, 7)` instead of a neighborhoods table.

Refresh policies only look back a few days.
After backfilling seed data, refresh the full range by hand, daily first:

```sql
CALL refresh_continuous_aggregate('xp_daily_by_user', NULL, NULL);
CALL refresh_continuous_aggregate('xp_weekly_by_user', NULL, NULL);
CALL refresh_continuous_aggregate('xp_monthly_by_user', NULL, NULL);
CALL refresh_continuous_aggregate('report_daily_by_area_reporter', NULL, NULL);
```

## Open items

- Seed gear rows in `item`, `category_item` and `hazard_item`.
- Seed a few months of backdated demo data for one region, plus hand-verified drop-offs.
- Add a dashboard aggregate; it needs `area_id` on party events.
- Decide where Gemini results are stored (likely a 1:1 `report_analysis` table).
- Clean up R2 objects that were uploaded but never confirmed, and `file` rows that were never attached to anything.
- Guild leaderboard, later.
- Verify Tiger's TLS certificate in the API by trusting Timescale's CA.
  For now the API reads `sslmode=require` the way `psql` does, so the connection is encrypted but the certificate is not checked.
