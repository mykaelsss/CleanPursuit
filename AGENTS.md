# CleanPursuit

CleanPursuit is a community trash cleanup app for the Hack Knight hackathon.
People report litter, form parties to clean it up, and earn XP on leaderboards.

## Docs

- [docs/mvp.md](docs/mvp.md): full MVP summary, including the vision, scope, core loop, XP rules, risks and open decisions.
- [docs/database.md](docs/database.md): database design, table purposes, relationships and aggregates.

Read the relevant doc before changing product behavior or the schema, and update it in the same change.

## Stack

- App: React Native
- API: Node.js 24 with Fastify 5, TypeScript, Zod and `pg`, with its own auth (argon2id, JWT access tokens, rotating refresh tokens)
- Database: Tiger Data (Postgres 18, TimescaleDB, PostGIS, H3, citext), service `clean-pursuit` (`sm60nzjanh`, DEV)
- Files: Cloudflare R2
- Secrets: Infisical, injected at runtime with `infisical run -- <command>`
- AI: Gemini, called once per report

## Core model

`report` -> `quest` (0..1) -> `party` (many) -> `party_member` (many).
A quest is the problem; a party is one attempt at it, either scheduled (an event) or walk-up (a bounty).
Only the party leader ends a party, and XP goes to checked-in members when it ends with an after photo.

## Repo layout

- `app/`: React Native app (Expo). Has its own `AGENTS.md` with Expo guidance.
- `server/src/`: Fastify API.
  `app.ts` builds the app, `server.ts` starts it, `env.ts` validates environment variables, `plugins/` holds shared plugins, `routes/` holds one plugin per resource, and `lib/` holds shared helpers.
- `server/test/`: API tests using `node:test` and `app.inject()`.
  Tests that need the database skip themselves unless `DATABASE_URL` is set, so run `infisical run -- npm test` to include them.
- `server/db/migrations/`: numbered SQL migrations, applied in order.
- `docs/`: product and database docs.

## Server conventions

- Node runs the TypeScript directly (type stripping), so there is no build step.
  Import local files with the `.ts` extension, and use only erasable syntax (no `enum`, `namespace` or constructor parameter properties).
- Every route declares Zod schemas for its input and every response status, so undeclared fields such as password hashes never leave the API.
- Write plain parameterized SQL through `app.db` (a `pg` pool); no ORM.
- Shared plugins are wrapped in `fastify-plugin`; route plugins are not.
- Protect a route with `onRequest: app.authenticate` and `security: [{ bearerAuth: [] }]`, then read the user id from `request.user.id`.
- Throw `HttpError` with a stable `code` for expected failures, and declare those statuses with `errorSchema`.
- Reach R2 only through `app.storage`, and return photos with `photoSchema` (file id and a presigned URL), never raw object keys.
  Tests pass `fakeStorage()` from `test/helpers.ts`, so they never touch R2.
- Reach Gemini only through `app.analyzer`, and only from `POST /files/{id}/analysis`, which saves the result so each photo is analyzed once.
  Gemini only suggests tags; the reporter confirms them and our rules set the tier.
  Tests pass `fakeAnalyzer()` from `test/helpers.ts`, so they never call Gemini.
- Add new environment variables to `src/env.ts` and `.env.example` in the same change.
- Run `npm run typecheck` and `infisical run -- npm test` in `server/` before committing.

## Rules

- Never edit an applied migration; add a new numbered one.
- Secrets (database URL, JWT secret, R2 and Gemini keys) live in Infisical, never in the repo.
- Never commit `.env` files; keep them in `.gitignore` and commit a `.env.example` that lists variable names only.
- Never give sharps or biohazard handling instructions in app copy; point to drop-off and escalation.
- Use a plain dash "-", never an em dash.
- In long Markdown files, put each sentence on its own line.
