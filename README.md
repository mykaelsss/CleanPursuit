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
| API | Not started |

## Tech stack

| Layer | Choice |
| --- | --- |
| App | React Native with Expo and Expo Router |
| API | Node.js, with its own auth (argon2id, JWT access tokens, rotating refresh tokens) |
| Database | Tiger Data: Postgres 18 with TimescaleDB, PostGIS, H3 and citext |
| File storage | Cloudflare R2 |
| AI | Gemini, called once per report |
| Secrets | Infisical |

## Repo layout

```
app/                    React Native app (Expo)
server/db/migrations/   Numbered SQL migrations, applied in order
docs/mvp.md             Product summary: scope, core loop, XP rules, risks
docs/database.md        Database design: tables, relationships, aggregates
AGENTS.md               Instructions for coding agents (CLAUDE.md links to it)
```

## Getting started

### Prerequisites

- Node.js and npm
- The [Infisical CLI](https://infisical.com/docs/cli/overview), logged in to the project
- `psql`, for applying migrations

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

## Secrets

All secrets live in Infisical: the database connection string, JWT keys, R2 credentials and the Gemini key.
Never commit `.env` files.
If a local `.env` is needed, keep it in `.gitignore` and commit a `.env.example` that lists variable names only.

## Docs

- [docs/mvp.md](docs/mvp.md): vision, scope, core loop, XP rules, risks and open decisions
- [docs/database.md](docs/database.md): every table, how they relate, and the leaderboard and hotspot aggregates
- [AGENTS.md](AGENTS.md): conventions for coding agents working in this repo
