# CleanPursuit MVP

CleanPursuit is a community cleanup app built for the 48-hour Hack Knight hackathon.
People report litter, rally others to clean it up, and earn XP on leaderboards so cleanup becomes a habit.

For the database, see [database.md](database.md).

## Vision

Core question: does making litter cleanup both competitive and community-based get people to clean up their neighborhoods more often?

There are no payments.
Cleanups are volunteer events, which removes the fraud and verification problem that cash rewards would create.

## Tracks targeted

| Track | How the project qualifies | Depends on |
| --- | --- | --- |
| Best Environmental Hack | Gamified neighborhood litter cleanup | Core loop |
| Best Use of Gemini API | Photo analysis for categories, hazards and difficulty tier | Should have |
| Best Use of Tiger Data | Hypertables, continuous aggregates for hotspots and leaderboards, PostGIS, H3 | Should have |
| Best Health Hack | Hazard warnings, equipment guidance and drop-off routing for sharps | Should have |
| Best Overall Hack | Full loop working with a populated demo | All of the above |
| Best Domain Name (GoDaddy Registry) | Register a project domain | Stretch |
| Best Use of ElevenLabs | Spoken safety briefing | Stretch |

Solana and Presage are skipped because they do not fit a no-payments volunteer app.
Confirm in the track rules that one project can enter multiple tracks.

## Scope

### Must have: the core loop

The demo works end to end with these six features.

1. Report an area with a photo, location and description.
2. Create a quest from a report.
3. Browse quests and parties in a scrollable list and on a map.
4. Sign up for a scheduled party, or walk up and join one.
5. The party leader ends the party with a bag count and an after photo.
6. Award XP when the party ends and show a leaderboard.

### Should have: what wins tracks

- **Gemini photo analysis.**
  One call per report.
  Gemini returns structured JSON: trash categories from a fixed list, hazard flags, estimated bag count and terrain.
  Our own rules map those to a difficulty tier: easy, medium, hard or legendary.
- **Equipment and warnings lookup.**
  Tables keyed by trash category and hazard, so Gemini is never called again for gear lists.
- **Hotspot multiplier.**
  Areas reported by several different people get bonus XP, computed from Tiger Data aggregates.
- **Biohazard drop-off map.**
  When a report is flagged as sharps or biohazard, the app fetches nearby drop-off locations once and stores them with the quest.
  They show on their own map, and tapping one opens directions in the user's maps app.
  If nothing is nearby, the app shows the sanitation escalation path instead.
  Volunteers are pointed to drop-off and escalation, never given sharps handling instructions.
- **Resources page.**
  Hardcoded in the app: sanitation escalation, disposal guidance, reporting numbers and where to get supplies.

### Stretch

- **Guilds.** Community teams with their own leaderboard. The tables exist, but there are no guild features in the MVP.
- **Before and after verification.** Gemini compares the two photos to confirm the area was cleaned before XP is awarded.
- **Researched impact ranges.** Per-quest-type estimates with cited sources. Backburnered because weight and percentage figures are hard to defend.
- **ElevenLabs safety briefing.** A spoken equipment and safety summary for volunteers.
- **GoDaddy Registry domain.** Pick a good name late in the build.

## How the core loop works

The original "event" became a quest with one or more parties.
A group gets credit together, and a cleanup can take several tries.

### Report

- A user submits a photo, location and description.
- The location snaps to an H3 cell (resolution 10, about 75 m edge) stored as `area_id`.
- If someone reports a spot that is already reported, the app tells them it exists.
  A new report is still saved and linked to the original as a duplicate.
- Duplicates heat up the hotspot map, but only distinct reporters count, so one person cannot heat a spot alone.

### Quest

- An original report can become one quest: the problem to solve.
- The person who creates the quest is raising awareness, not organizing.
  They are asked if they want to join a party, but they do not have to.

### Party

A party is one attempt at a quest, and a quest can have many.
There are two kinds, derived from whether a schedule is set:

| Kind | How it starts | Leader |
| --- | --- | --- |
| Event (scheduled party) | Someone picks a time slot and asks for help | The person who scheduled it |
| Bounty (walk-up party) | Anyone at the site checks in; others join the live party | The first person to check in |

Leader rules:

- Every party always has a leader, and the leader is always a member.
- Only the leader can end the party.
- The leader can hand the role to another member.
- If the leader leaves without handing off, the member who has been there longest is promoted.
- If nobody is left, the party is abandoned.

### Presence

- Members check in by GPS when they arrive.
- The app sends location pings during the party.
- A member with no on-site ping for 30 minutes is removed automatically.
- Time on site runs from check-in to the member's last on-site ping.
- Pings are deleted after 30 days.

### Ending a party

The leader submits an after photo, a bag count and an outcome.
The leader can also correct the report's tags before XP is awarded.

| Outcome | What happens to the quest | XP |
| --- | --- | --- |
| Completed | Closes | Yes |
| Partial | Stays open for a follow-up scheduled party or as a bounty | Yes |
| Abandoned | Stays open; everyone left without an after photo | No |
| Cancelled | A scheduled party was called off before it started | No |

```mermaid
stateDiagram-v2
  [*] --> Scheduled: event with a time slot
  [*] --> Active: walk-up, first check-in
  Scheduled --> Active: first check-in
  Scheduled --> Cancelled
  Active --> Completed: photo and bag count, quest closes
  Active --> Partial: photo and bag count, quest stays open
  Active --> Abandoned: nobody left, no photo
```

### XP

- XP is awarded once per party, when it ends with an after photo.
- Only members who checked in earn XP, including people who left early.
- Each member's XP is based on their time on site.
- XP scales with the report's difficulty tier.
- XP is capped per quest so a crowd cannot farm it.
- Cleaning a hotspot adds bonus XP.
- XP feeds daily, weekly and monthly leaderboards plus each user's all-time total.

The exact numbers (base rate, tier multipliers, cap, hotspot threshold) are still open.

## Tiger Data features

- **Activity log.** One append-only hypertable records reports, check-ins, party ends, XP and bonuses, with `user_id`, `guild_id` and `area_id` on every row.
- **Presence pings.** A second hypertable stores GPS pings with a 30-day retention policy.
- **Leaderboards.** A daily continuous aggregate, with weekly and monthly rolled up from it. All-time XP is a column on the user.
- **Hotspots.** A continuous aggregate counts reports per area and reporter; a 30-day view counts distinct reporters.
- **Dashboard.** Cleanups per week, bags collected, volunteer-hours, active volunteers and re-report rate, grouped by larger H3 cells instead of neighborhoods.
- **Geospatial.** PostGIS `geography`, GiST indexes and `ST_DWithin` for "near me" and the check-in geofence.

Aggregates are real-time and the daily ones refresh every 5 minutes, so the demo never lags.

## Gemini

- Use a Flash-class model with a response schema for structured output.
- Call it once per report and store the result with the report.
- Never call it on page loads.
- Gemini only extracts features; our rules set the tier.

## Directions handoff

- Google Maps: `https://www.google.com/maps/dir/?api=1&destination=LAT,LNG`
- Apple Maps: `https://maps.apple.com/?daddr=LAT,LNG`

## Tech stack

| Layer | Choice |
| --- | --- |
| App | React Native |
| API | Node.js |
| Auth | Built into the API: argon2id password hashes, JWT access tokens, rotating refresh tokens |
| Database | Tiger Data (Postgres 18 with TimescaleDB, PostGIS, H3, citext) |
| File storage | Cloudflare R2 |
| AI | Gemini (Flash-class) |
| Drop-off search | Hand-verified seed rows first, Google Places as fallback |

## 48-hour build order

The core loop ships first so there is always a working demo.

1. Set up the project, the Tiger Data schema and the activity-log hypertable with area snapping. (Done)
2. Report and quest creation, with photo upload.
3. Map and list views, plus party sign-up and check-in.
4. Ending a party with bag count and after photo, then XP and the leaderboard.
5. Gemini photo analysis, the tier rules and the equipment lookup.
6. Hotspot aggregate and bonus XP.
7. Biohazard drop-off map with directions links, and the resources page.
8. Seed a few months of backdated data for one demo region, plus a few hand-verified sharps drop-off locations.
9. Polish, rehearse the demo, then stretch goals if time remains.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| XP can be farmed with staged or exaggerated photos | Award XP only after the after photo, only to GPS-checked-in members, cap XP per quest, treat the reporter's tier as provisional |
| Gemini misclassifies a photo | Gemini extracts features only; our rules set the tier; the party leader corrects tags before XP |
| Drop-off search returns places that do not accept sharps | Hand-verified seed table first, Places as fallback, and a verify-before-you-go note on each result |
| Google Places terms limit caching | Store only place IDs and refetch details |
| Continuous aggregates lag during the demo | Real-time aggregates with a 5-minute refresh, plus a manual refresh after seeding |
| Gemini quota or rate limits | Check limits for the team key before the event; one call per report |

## Status and open decisions

Done:

- Schema migrations `001` and `002` are applied to the DEV Tiger service and tested.

Open:

- [ ] XP numbers: base rate, tier multipliers, per-quest cap, hotspot threshold.
- [ ] Geofence radius for check-in and on-site pings.
- [ ] Demo region, for seed data and drop-off locations.
- [ ] Gear seed data for the equipment lookup.
- [ ] Backdated demo data.
- [ ] Dashboard aggregate.
- [ ] Where Gemini results are stored.
- [ ] Task split across the team: frontend, Tiger Data and backend, Gemini integration, demo data.
