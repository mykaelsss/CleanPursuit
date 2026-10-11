import type { FastifyBaseLogger } from 'fastify';
import type pg from 'pg';
import { z } from 'zod';
import { withTransaction } from './db.ts';
import { distanceMeters, type Location, locationSchema, selectLocation } from './geo.ts';
import { type PlaceFinder, PlacesFailedError } from './places.ts';
import { escalationSchema, region } from './region.ts';

// How far from a quest a drop-off site may be, and how many to keep.
export const DROPOFF_RADIUS_M = 5000;
export const DROPOFF_LIMIT = 5;

export const dropoffSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  address: z.string(),
  location: locationSchema,
  distanceM: z.number().int().describe('Meters from the quest'),
  phone: z.string().nullable(),
  hours: z.string().nullable().describe('Free text from the source, such as "Monday-Friday 9am-5pm"'),
  notes: z.string().nullable().describe('Where to find the drop-off at the site, such as "Lobby"'),
  verified: z
    .boolean()
    .describe('From an official or hand-checked list. Unverified sites come from a Google search, so call ahead.'),
  googlePlaceId: z.string().nullable().describe('Set for Google Places results, for directions links'),
});

export const questDropoffsSchema = z.object({
  requiresDropoff: z.boolean().describe('The quest has a hazard, such as sharps, that needs a drop-off site'),
  dropoffs: z.array(dropoffSchema).describe('Nearest first; empty when no site is nearby or the lookup failed'),
  escalation: escalationSchema.describe('Who to call instead; the recommended approach for sharps and biohazard'),
});

type Dropoff = z.infer<typeof dropoffSchema>;
type QuestDropoffs = z.infer<typeof questDropoffsSchema>;

interface Candidate {
  dropoffId?: string;
  placeId?: string;
  distanceM: number;
}

// Finds the nearest drop-off sites for a quest and saves them, so the lookup runs once per quest.
// Listed sites (official or hand-checked) come first; Google Places is only searched when none is nearby.
// If Places fails, nothing is saved and the next request tries again.
async function lookUp(db: pg.Pool, places: PlaceFinder, log: FastifyBaseLogger, questId: string, center: Location) {
  const { rows: listed } = await db.query<{ id: string; distance_m: number }>(
    `SELECT d.id, round(ST_Distance(d.location, r.location))::integer AS distance_m
     FROM quest q
     JOIN report r ON r.id = q.report_id
     JOIN dropoff_location d ON ST_DWithin(d.location, r.location, $2)
     WHERE q.id = $1 AND d.source <> 'google_places' AND d.retired_at IS NULL AND d.accepts_sharps
     ORDER BY distance_m, d.id
     LIMIT $3`,
    [questId, DROPOFF_RADIUS_M, DROPOFF_LIMIT],
  );
  let candidates: Candidate[] = listed.map((row) => ({ dropoffId: row.id, distanceM: row.distance_m }));

  if (candidates.length === 0) {
    try {
      const found = await places.search({
        query: region.dropoffSearchQuery,
        center,
        radiusM: DROPOFF_RADIUS_M,
        limit: DROPOFF_LIMIT,
      });
      const byId = new Map(found.map((place) => [place.id, place]));
      candidates = [...byId.values()]
        .map((place) => ({ placeId: place.id, distanceM: Math.round(distanceMeters(center, place.location)) }))
        .filter((candidate) => candidate.distanceM <= DROPOFF_RADIUS_M)
        .sort((a, b) => a.distanceM - b.distanceM)
        .slice(0, DROPOFF_LIMIT);
    } catch (err) {
      if (!(err instanceof PlacesFailedError)) throw err;
      log.warn({ err, questId }, 'drop-off search failed; will retry on the next request');
      return;
    }
  }

  await withTransaction(db, async (client) => {
    const claimed = await client.query(
      `UPDATE quest SET dropoffs_fetched_at = now() WHERE id = $1 AND dropoffs_fetched_at IS NULL`,
      [questId],
    );
    // Another request saved the lookup first.
    if (claimed.rowCount === 0) return;

    const dropoffIds: string[] = [];
    for (const candidate of candidates) {
      if (candidate.dropoffId) {
        dropoffIds.push(candidate.dropoffId);
        continue;
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO dropoff_location (source, google_place_id) VALUES ('google_places', $1)
         ON CONFLICT (google_place_id) DO UPDATE SET updated_at = now()
         RETURNING id`,
        [candidate.placeId],
      );
      dropoffIds.push(rows[0]!.id);
    }

    await client.query(
      `INSERT INTO quest_dropoff (quest_id, dropoff_location_id, distance_m, rank)
       SELECT $1, d.id, d.distance_m, d.rank
       FROM unnest($2::uuid[], $3::integer[]) WITH ORDINALITY AS d(id, distance_m, rank)`,
      [questId, dropoffIds, candidates.map((candidate) => candidate.distanceM)],
    );
  });
}

interface DropoffRow {
  id: string;
  google_place_id: string | null;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  hours: string | null;
  notes: string | null;
  verified_at: Date | null;
  distance_m: number;
}

// Places rows only store the place ID, so their details are fetched again each time.
async function toDropoff(row: DropoffRow, places: PlaceFinder, log: FastifyBaseLogger): Promise<Dropoff | null> {
  const base = {
    id: row.id,
    distanceM: row.distance_m,
    phone: row.phone,
    hours: row.hours,
    notes: row.notes,
    verified: row.verified_at !== null,
    googlePlaceId: row.google_place_id,
  };

  if (!row.google_place_id) {
    return {
      ...base,
      name: row.name!,
      address: row.address!,
      location: { latitude: row.latitude!, longitude: row.longitude! },
    };
  }

  try {
    const place = await places.details(row.google_place_id);
    return place ? { ...base, name: place.name, address: place.address, location: place.location } : null;
  } catch (err) {
    if (!(err instanceof PlacesFailedError)) throw err;
    log.warn({ err, placeId: row.google_place_id }, 'could not fetch drop-off details; leaving it out');
    return null;
  }
}

// The drop-off sites and escalation path for a quest, or null if there is no such quest.
export async function findQuestDropoffs(
  db: pg.Pool,
  places: PlaceFinder,
  log: FastifyBaseLogger,
  questId: string,
): Promise<QuestDropoffs | null> {
  const { rows } = await db.query<{ latitude: number; longitude: number; fetched: boolean; requires_dropoff: boolean }>(
    `SELECT ${selectLocation('r.location')}, q.dropoffs_fetched_at IS NOT NULL AS fetched,
            EXISTS (SELECT 1 FROM report_hazard rh
                    JOIN hazard h ON h.code = rh.hazard_code
                    WHERE rh.report_id = r.id AND h.requires_dropoff) AS requires_dropoff
     FROM quest q
     JOIN report r ON r.id = q.report_id
     WHERE q.id = $1`,
    [questId],
  );
  const quest = rows[0];
  if (!quest) return null;
  if (!quest.requires_dropoff) return { requiresDropoff: false, dropoffs: [], escalation: region.escalation };

  // Runs the first time anyone asks, so hazards added after the quest was created still get drop-offs.
  if (!quest.fetched) {
    await lookUp(db, places, log, questId, { latitude: quest.latitude, longitude: quest.longitude });
  }

  const { rows: saved } = await db.query<DropoffRow>(
    `SELECT d.id, d.google_place_id, d.name, d.address, ${selectLocation('d.location')},
            d.phone, d.hours, d.notes, d.verified_at, qd.distance_m
     FROM quest_dropoff qd
     JOIN dropoff_location d ON d.id = qd.dropoff_location_id
     WHERE qd.quest_id = $1 AND d.retired_at IS NULL AND d.accepts_sharps
     ORDER BY qd.rank`,
    [questId],
  );
  const dropoffs = await Promise.all(saved.map((row) => toDropoff(row, places, log)));
  return {
    requiresDropoff: true,
    dropoffs: dropoffs.filter((dropoff) => dropoff !== null),
    escalation: region.escalation,
  };
}
