# CleanPursuit

CleanPursuit is a community cleanup app where people report litter, rally others to clean it up, and earn XP on leaderboards.
It is being built for the 48-hour Hack Knight hackathon.

## How it works

1. **Report** a spot with a photo, location and description.
   Gemini tags the trash and hazards, and our rules set a difficulty tier.
2. **Create a quest** from the report so others can see the problem.
3. **Join a party** to clean it up, either a scheduled event or a walk-up on an open bounty.
   Members check in by GPS.
4. **End the party.** The party leader submits an after photo and a bag count.
5. **Earn XP.** Everyone who checked in gets XP based on their time on site, scaled by difficulty, with a bonus for hotspots.
   XP feeds daily, weekly and monthly leaderboards.

Reports flagged for sharps or biohazards show warnings and nearby drop-off locations instead of handling instructions.

The full product summary is in [docs/mvp.md](docs/mvp.md).

## Status

| Part | State |
| --- | --- |
| Database | Migrations 001 and 002 applied to the DEV Tiger Data service |
| App | Expo starter project in `app/` |
| API | Fastify in `server/` with auth, photo uploads, reports and quests |

## Tech stack

| Layer | Choice |
| --- | --- |
| App | React Native with Expo and Expo Router |
| API | Node.js 24 with Fastify 5, TypeScript, Zod and `pg`, with its own auth (argon2id, JWT access tokens, rotating refresh tokens) |
| Database | Tiger Data: Postgres 18 with TimescaleDB, PostGIS, H3 and citext |
| File storage | Cloudflare R2 |
| AI | Gemini, called once per report |
| Secrets | Infisical |

## Repo layout

```
app/                    React Native app (Expo)
server/src/             Fastify API
server/test/            API tests
server/db/migrations/   Numbered SQL migrations, applied in order
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

### Apply database migrations

Migrations run in order against the Tiger Data service, one file at a time.
Only run files that have not been applied yet; 001 and 002 are already on the DEV service.
The connection string comes from Infisical, so wrap the command in `infisical run`:

```bash
infisical run -- sh -c 'psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/db/migrations/003_example.sql'
```

The single quotes matter: `$DATABASE_URL` must expand inside the command Infisical runs, not in your shell.
Applied migrations are never edited; changes go in a new numbered file.

## Auth

The API handles accounts itself.

- `POST /auth/register` and `POST /auth/login` return the user, an access token and a refresh token.
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
- `POST /reports` files a report.
  The difficulty tier comes from the tags, using the rules in [docs/mvp.md](docs/mvp.md#difficulty-tier).
  If the spot is already reported, the report is still saved and `duplicateOf` points at the original and its quest.
- `POST /reports/{id}/quest` turns an original report into a quest.
- `GET /quests?latitude=&longitude=` lists open quests nearby, nearest first, for the map and list.
- `GET /reports/{id}` and `GET /quests/{id}` return one of each.

The full request and response shapes are in the interactive docs at `/docs`.

## Secrets

All secrets live in Infisical: the database connection string, the JWT secret, R2 credentials and the Gemini key.
Never commit `.env` files; the root `.gitignore` excludes every `.env` file except `.env.example`.
`server/.env.example` lists the variable names the API reads, and `server/src/env.ts` checks them at startup.

## Docs

- [docs/mvp.md](docs/mvp.md): vision, scope, core loop, XP rules, risks and open decisions
- [docs/database.md](docs/database.md): every table, how they relate, and the leaderboard and hotspot aggregates
- [AGENTS.md](AGENTS.md): conventions for coding agents working in this repo
