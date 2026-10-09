# CleanPursuit

CleanPursuit is a community trash cleanup app for the Hack Knight hackathon.
People report litter, form parties to clean it up, and earn XP on leaderboards.

## Docs

- [docs/mvp.md](docs/mvp.md): full MVP summary, including the vision, scope, core loop, XP rules, risks and open decisions.
- [docs/database.md](docs/database.md): database design, table purposes, relationships and aggregates.

Read the relevant doc before changing product behavior or the schema, and update it in the same change.

## Stack

- App: React Native
- API: Node.js, with its own auth (argon2id, JWT access tokens, rotating refresh tokens)
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
- `server/db/migrations/`: numbered SQL migrations, applied in order.
- `docs/`: product and database docs.

## Rules

- Never edit an applied migration; add a new numbered one.
- Secrets (database URL, JWT keys, R2 and Gemini keys) live in Infisical, never in the repo.
- Never commit `.env` files; keep them in `.gitignore` and commit a `.env.example` that lists variable names only.
- Never give sharps or biohazard handling instructions in app copy; point to drop-off and escalation.
- Use a plain dash "-", never an em dash.
- In long Markdown files, put each sentence on its own line.
