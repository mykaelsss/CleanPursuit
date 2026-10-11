# CleanPursuit

CleanPursuit is a community cleanup app where people report litter, rally others to clean it up, and earn XP on leaderboards.
It is being built for the 48-hour Hack Knight hackathon.

## How it works

1. **Report** a spot with a photo, location and description.
   Gemini suggests the trash categories and hazards, the reporter confirms them, and our rules set a difficulty tier.
2. **Create a quest** from the report so others can see the problem.
3. **Join a party** to clean it up.
   Parties are scheduled for now; walk-ups on open bounties are not built yet.
   Members check in by GPS during the time slot.
4. **End the party.** The party leader submits an after photo, a bag count and whether the cleanup is done.
5. **Earn XP.** Everyone who checked in gets up to 100 XP, based on how much of the time slot they were on site, with a bonus for hotspots.
   XP feeds daily, weekly, monthly and all-time leaderboards.

Reports flagged for sharps or biohazards recommend calling 311, require a sharps container for sharps, and show nearby drop-off sites from NYC's official list.

The full product summary is in [docs/mvp.md](docs/mvp.md).

## Status

| Part | State |
| --- | --- |
| Database | Migrations 001 to 010 applied to the DEV Tiger Data service, with NYC sharps drop-off sites imported |
| App | Expo app with sign-in, nearby events, quest creation, check-in and ending for walk-ups and events, an XP popup, leaderboards, a quest's drop-off sites with directions, and a safety resources page in `app/` |
| API | Fastify in `server/` with auth, photo uploads, Gemini photo analysis, reports, quests, events and parties, XP, leaderboards, hotspots, equipment and drop-offs |

## Tech stack

| Layer | Choice |
| --- | --- |
| App | React Native with Expo and Expo Router |
| API | Node.js 24 with Fastify 5, TypeScript, Zod and `pg`, with its own auth (argon2id, JWT access tokens, rotating refresh tokens) |
| Database | Tiger Data: Postgres 18 with TimescaleDB, PostGIS, H3 and citext |
| File storage | Cloudflare R2 |
| AI | Gemini (`gemini-3.5-flash-lite`), called once per report photo |
| Secrets | Infisical |

## Repo layout

```
app/                    React Native app (Expo)
server/src/             Fastify API
server/test/            API tests
server/db/migrations/   Numbered SQL migrations, applied in order
server/db/seed/         Photos for the demo data script
scripts/phone.sh        Runs the API and app for Expo Go on a phone, over tunnels
docs/mvp.md             Product summary: scope, core loop, XP rules, risks
docs/database.md        Database design: tables, relationships, aggregates
AGENTS.md               Instructions for coding agents (CLAUDE.md links to it)
```

## Getting started

### Prerequisites

- Node.js 24 or later, and npm
- The [Infisical CLI](https://infisical.com/docs/cli/overview), logged in to the project
- `psql`, for applying migrations

### Run the API

```bash
cd server
npm install
infisical run -- npm run dev
```

The API listens on port 3000 by default and restarts when files change.
`GET /health` checks the API and the database, and interactive API docs are at http://localhost:3000/docs outside production.
To reach the API from a phone running Expo Go, use your computer's LAN address instead of `localhost`.

Node runs the TypeScript directly, so there is no build step.
Before committing, run:

```bash
npm run typecheck
infisical run -- npm test
```

Plain `npm test` also works, but it skips the tests that need the database.

Without Infisical, copy `server/.env.example` to `server/.env` and fill it in; `npm run dev` loads it automatically.

### Run the app

```bash
cd app
npm install
npx expo start
```

From the Expo output you can open the app in an iOS simulator, an Android emulator, a browser or Expo Go.
Add packages with `npx expo install <package>` so versions match the Expo SDK.
The app has `expo-dev-client`, so press `s` in the Expo output (or start with `npx expo start --go`) to open it in Expo Go.

### Run the app on your phone

```bash
./scripts/phone.sh
```

This starts the API and Metro, puts each behind a Cloudflare quick tunnel and points the app at the API tunnel, so it works on any network, including a phone hotspot.
It prints an `exps://` link and a QR code; scan the code with your phone's camera to open the app in Expo Go, and press Ctrl+C to stop everything.
To open a screen directly, add `/--/<path>` to the link, for example `exps://<tunnel>/--/resources`.
Expo's keyboard shortcuts are off in this mode, so shake the phone for the developer menu.
It needs the Infisical CLI and `cloudflared` (`brew install cloudflared`), but no Cloudflare account.
It does not use `expo start --tunnel`, whose bundled ngrok often fails to connect.
Logs go to `$TMPDIR/cleanpursuit-phone/`.
While it runs, anyone with the API tunnel URL can reach the API and the DEV database behind it.

### Apply database migrations

Migrations run in order against the Tiger Data service, one file at a time.
Only run files that have not been applied yet; 001 to 008 are already on the DEV service.
The connection string comes from Infisical, so wrap the command in `infisical run`:

```bash
infisical run -- sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/db/migrations/005_example.sql'
```

The single quotes matter: `$DATABASE_URL` must expand inside the command Infisical runs, not in your shell.
Applied migrations are never edited; changes go in a new numbered file.

### Load demo data

```bash
cd server
infisical run -- npm run seed:demo
```

This creates 26 demo users and 11 cleanup events across the five boroughs, each with a report, a photo and a quest.
One event is under way and the rest start over the next week, at set hours in New York time.
Sign in as `demo` with the password `cleanpursuit-demo`: that account leads the Prospect Park event and has joined the Meadow Lake and Jamaica Avenue ones.
Every other demo user has the same password.

Rerun it shortly before a demo.
Each run deletes what the demo accounts created (including parties other users scheduled on demo quests) and recreates it, so event times stay current.
Demo accounts are the ones with an `@demo.example.com` email, and they keep their ids, so the app stays signed in across runs.
The photos are in `server/db/seed/photos/`, credited in its `CREDITS.md`.

## Auth

The API handles accounts itself.

- `POST /auth/register` and `POST /auth/login` return the user, an access token and a refresh token.
  The user includes `totalXp` and `level` (`number`, `xpIntoLevel` and `xpForNextLevel`, which is null at the max level); see [Levels](docs/mvp.md#levels).
- Send the access token as `Authorization: Bearer <token>`.
  It lasts 15 minutes.
- When a request fails with code `ACCESS_TOKEN_EXPIRED`, call `POST /auth/refresh` with the refresh token to get a new pair.
- Refresh tokens last 30 days and work once.
  Reusing an old one signs the user out on every device, so the app must never send two refreshes at the same time.
- `POST /auth/logout` revokes a refresh token.
- In the app, keep the refresh token in `expo-secure-store` and the access token in memory only.

Passwords are hashed with argon2id, and login, registration and refresh are rate limited to 10 requests per minute per IP.

## Photos

Photos go straight from the phone to Cloudflare R2, so they never pass through the API.

1. `POST /uploads` with the content type and exact size returns a short-lived upload URL.
2. The app PUTs the photo to that URL with the returned headers.
3. `POST /files` with the key confirms the upload and returns a file id.
   The API checks the stored size and the file's first bytes before accepting it.
4. Attach the file id to a report (`photoFileId`) or, later, a party.

JPEG, PNG and WebP up to 10 MB are accepted.
Convert iPhone HEIC photos to JPEG in the app, and shrink them first to save upload time.
Photo URLs in responses expire after an hour, so cache images by file id rather than by URL.

## Reports and quests

- `GET /tags` lists the trash categories and hazards for the report form.
- `POST /files/{id}/analysis` asks Gemini to suggest a description, categories, hazards and a trash amount for an uploaded photo.
  Call it right after `POST /files` and prefill the report form with the result while the reporter fills in the rest.
  Each photo is analyzed once; calling again returns the saved result.
  If `showsLitter` is false, warn the reporter but let them continue.
  On 503 `ANALYSIS_UNAVAILABLE`, show the form empty; reporting never depends on Gemini.
- Trash amounts are a range in gallons (`estimatedVolume: { minGallons, maxGallons }`), and responses add `bags` with counts for kitchen (13 gal), large (33 gal) and contractor (42 gal) bags.
  Show those so volunteers know what to bring.
  The high end may be at most 1.5 times the low end (or one kitchen bag above it); wider ranges get 400 `INVALID_VOLUME_RANGE`.
  See [Trash amount](docs/mvp.md#trash-amount).
- `POST /reports` files a report.
  Send `placeName`, a readable name for the spot such as "Tompkins Square Park, East Village", so the app can show it instead of coordinates.
  Suggest one from the phone's geocoder and let the reporter edit it.
  The difficulty tier comes from the tags the reporter sends, using the rules in [docs/mvp.md](docs/mvp.md#difficulty-tier).
  Tags that Gemini suggested and the reporter kept are recorded with `gemini` as their source.
  If the spot is already reported, the report is still saved and `duplicateOf` points at the original and its quest.
- `POST /reports/{id}/quest` turns an original report into a quest.
- `GET /quests?latitude=&longitude=` lists open quests nearby, nearest first, for the map and list.
- `GET /reports/{id}` and `GET /quests/{id}` return one of each.
- `GET /files/{id}/report` lets the uploader recover the report for a confirmed photo if the submission response was lost.
  It returns null before that photo has a report; other users get 404.

The app's Create a quest tab uploads and analyzes the photo, lets the reporter edit and confirm the report details and cleanup location, then saves the report and quest.
It can also schedule an initial party, which makes the creator its organizer and first attendee.
Duplicate reports link to the original quest and require reviewing that quest before scheduling there.
AI failure leaves manual reporting available, and partial failures keep saved records for retries.

The full request and response shapes are in the interactive docs at `/docs`.

### Try photo analysis on your own photos

This runs photos through the real flow (R2 upload, `POST /files`, Gemini) and prints what Gemini suggests, with timing and token counts.
It deletes every user, file and photo it creates when it finishes.

```bash
cd server
infisical run -- npm run try:analysis -- photo.jpg some-folder/
infisical run -- npm run try:analysis -- --model gemini-3.5-flash-lite --model gemini-3.8-flash some-folder/
```

Pass `--model` more than once to compare models on the same photos.
Photos must be JPEG, PNG or WebP of at most 10 MB, and each model can analyze 30 photos per run.

### Import sharps drop-off sites

This loads NYC's official syringe and sharps drop-off sites from NYC Open Data, skipping mobile vans that have no fixed location.
Run it again any time to pick up the city's changes.

```bash
cd server
infisical run -- npm run import:dropoffs
```

### Seed a demo sharps quest

This files a sharps report at Bryant Park through the real flow (R2 upload, report, quest, drop-off lookup) and prints the quest's drop-off screen links.
Any signed-in user can open the quest, so stay signed in as yourself.

```bash
cd server
infisical run -- npm run seed:demo-quest
infisical run -- npm run seed:demo-quest -- --hazard biohazard --latitude 40.6782 --longitude -73.9442
infisical run -- npm run seed:demo-quest -- --clean
```

Running it twice at the same spot reuses the first quest.
`--clean` deletes every demo user, with their reports, quests and photos.

## Events and parties

A party is one attempt at a quest.
Two sets of routes create scheduled parties, and both make the same `party` rows.

- `GET /events?latitude=&longitude=` lists upcoming and in-progress events nearby, soonest first.
- `POST /quests/{id}/events` schedules an event on an open quest.
  Events start in the future and last at most 12 hours.
  Retrying the same organizer and exact time slot returns their existing scheduled or active event.
- `POST /events/{id}/join` signs up for an event until it ends, and `DELETE /events/{id}/join` withdraws before check-in.
- `GET /events/{id}` returns an event with its attendees.
- `POST /quests/{questId}/parties` also schedules a party on an open quest.
  It needs a start in the future and an end after the start, with no length limit.
  The person who schedules it is the leader and first member.
- `POST /parties/{id}/join` signs up for a party before its start time.
- `POST /parties/{id}/check-in` with `location` checks a signed-up member in.
  It works only between the scheduled start and end, within 100 m of the report location.
  The first check-in makes the party active.
- `POST /parties/{id}/presence` with `location` records a GPS ping for a checked-in member of an active party.
  Pings within 100 m are on site, and time on site for XP is measured between on-site pings.
  The app should ping about once a minute during a party, since one gap counts for at most 10 minutes.
- `POST /parties/{id}/end` lets the leader end an active scheduled party with `afterPhotoFileId`, `bagCount` and `outcome` (`completed` or `partial`).
  The after photo must be the leader's own confirmed upload and not attached to anything else.
  `completed` closes the quest; `partial` leaves it open.
  Walk-up parties cannot be ended yet and get 409 `PARTY_NOT_SCHEDULED`.
- `GET /parties/{id}` returns a party and its members.

Ending a party awards XP to members who checked in; see [XP](docs/mvp.md#xp).

## Leaderboards and hotspots

- `GET /leaderboards?period=&limit=` ranks users by XP earned in a period: `day`, `week`, `month` or `all` (the default).
  Days, weeks and months are the current UTC ones, weeks start on Monday, and `periodStart` says when the period began.
  Each entry has `xp` for the period and `totalXp` for all time.
  Users with no XP in the period are left out, and ties share a rank.
  It returns 20 entries by default and at most 100.
  `me` gives the signed-in user's `rank`, period `xp` and `totalXp`, even outside the returned entries.
  `me.rank` is null when the user's net XP in the period is zero or negative.
  The app's Leaderboard tab uses this endpoint with a limit of 100 and lets users select each period.
  The older `GET /leaderboard` endpoint still returns all-time ranks including zero-XP accounts.
- `GET /hotspots?limit=` lists H3 areas reported in the last 30 days with their center point, hexagon `boundary`, distinct reporters and report count, busiest first.
  It returns 100 areas by default and at most 250.
  Add `latitude`, `longitude` and `radiusM` together to keep only areas whose center is within `radiusM` meters; sending only some of them gets 400 `INVALID_NEAR_FILTER`.
  Quests and events carry `areaId`, so the app can tell which ones are in a hotspot.
  `isHotspot` is true when 3 or more different people reported the area, which is when cleaning it earns bonus XP.

## Equipment and drop-offs

- `GET /quests/{id}/equipment` returns gear for a quest and the warnings for its hazards.
  Gear comes from the report's categories, or from its hazards when it has any.
  Items with `required: true` come first; volunteers must bring them, such as the sharps container for sharps.
  A quest with a hazard that needs drop-off (sharps or biohazard) gets only its required gear, plus the warnings.
  If any reported hazard has no gear mapped, the optional gear list is empty rather than guessed.
- `GET /quests/{id}/dropoffs` returns drop-off sites for sharps and biohazard quests, nearest first, plus the 311 escalation path.
  The first request saves the 5 nearest sharps-accepting sites within 5 km, and later requests return the saved list.
  NYC's listed sites come first; Google Places is searched only when none is nearby, and those results have `verified: false`, so tell volunteers to call ahead.
  If Places fails, nothing is saved and the next request tries again.
  Quests without those hazards get `requiresDropoff: false` and an empty list.

## Secrets

All secrets live in Infisical: the database connection string, the JWT secret, R2 credentials, the Gemini key and the Google Maps key.
Never commit `.env` files; the root `.gitignore` excludes every `.env` file except `.env.example`.
`server/.env.example` lists the variable names the API reads, and `server/src/env.ts` checks them at startup.

## Docs

- [docs/mvp.md](docs/mvp.md): vision, scope, core loop, XP rules, risks and open decisions
- [docs/database.md](docs/database.md): every table, how they relate, and the leaderboard and hotspot aggregates
- [AGENTS.md](AGENTS.md): conventions for coding agents working in this repo
