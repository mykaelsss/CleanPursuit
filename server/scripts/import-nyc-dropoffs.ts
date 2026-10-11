// Imports NYC's official syringe and sharps drop-off sites from NYC Open Data into dropoff_location.
// Safe to run again: rows update in place, and sites gone from the dataset are retired, not deleted,
// because quests that already list them still point at them.
//
//   infisical run -- npm run import:dropoffs

import { z } from 'zod';
import { loadEnv } from '../src/env.ts';
import { createPool, withTransaction } from '../src/lib/db.ts';

// "Pharmaceutical and Syringe Drop-Off Locations in NYC", published by the Department of Sanitation.
const DATASET = 'https://data.cityofnewyork.us/resource/edk2-vkjh.json';
const METADATA = 'https://data.cityofnewyork.us/api/views/edk2-vkjh.json';
const SHARPS_SITE_TYPE = 'SYRINGE/SHARPS Drop-off';

const rowSchema = z.object({
  sitename: z.string(),
  address: z.string(),
  phonenum: z.string().optional(),
  days_hours: z.string().optional(),
  notes: z.string().optional(),
  latitude: z.coerce.number().min(40).max(41.5),
  longitude: z.coerce.number().min(-74.5).max(-73.5),
});

type Row = z.infer<typeof rowSchema>;

function clean(text: string | undefined): string | null {
  const cleaned = text?.replace(/\s+/g, ' ').trim();
  return cleaned ? cleaned : null;
}

// Vans that move around list an office address, which would put a misleading pin on the map.
function isMobileUnit(row: Row): boolean {
  return /mob+ile unit/i.test(`${row.days_hours ?? ''} ${row.notes ?? ''}`);
}

// The dataset has no stable row ID, so a site is keyed by its name and address.
function externalId(row: Row): string {
  return `${clean(row.sitename)}|${clean(row.address)}`.toLowerCase();
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  return response.json();
}

const env = loadEnv();
const pool = createPool(env.DATABASE_URL);

try {
  const query = new URLSearchParams({ site_type: SHARPS_SITE_TYPE, $limit: '5000' });
  const rows = z.array(rowSchema).parse(await fetchJson(`${DATASET}?${query}`));
  const { rowsUpdatedAt } = z.object({ rowsUpdatedAt: z.number() }).parse(await fetchJson(METADATA));
  // The city vouches for its list as of its last update, which stands in for a hand check.
  const verifiedAt = new Date(rowsUpdatedAt * 1000);

  const sites = new Map(rows.filter((row) => !isMobileUnit(row)).map((row) => [externalId(row), row]));
  // An empty answer would retire every site, so treat it as a broken download.
  if (sites.size === 0) throw new Error('The dataset returned no sharps drop-off sites; nothing was changed');

  const retired = await withTransaction(pool, async (client) => {
    for (const [id, row] of sites) {
      await client.query(
        `INSERT INTO dropoff_location
           (source, external_id, name, address, location, phone, hours, notes, verified_at)
         VALUES ('open_data', $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, $8, $9)
         ON CONFLICT (source, external_id) DO UPDATE SET
           name = EXCLUDED.name, address = EXCLUDED.address, location = EXCLUDED.location,
           phone = EXCLUDED.phone, hours = EXCLUDED.hours, notes = EXCLUDED.notes,
           verified_at = EXCLUDED.verified_at, retired_at = NULL`,
        [
          id,
          clean(row.sitename),
          clean(row.address),
          row.longitude,
          row.latitude,
          clean(row.phonenum),
          clean(row.days_hours),
          clean(row.notes),
          verifiedAt,
        ],
      );
    }
    const { rowCount } = await client.query(
      `UPDATE dropoff_location SET retired_at = now()
       WHERE source = 'open_data' AND retired_at IS NULL AND NOT (external_id = ANY($1))`,
      [[...sites.keys()]],
    );
    return rowCount ?? 0;
  });

  const skipped = rows.length - sites.size;
  console.log(
    `Imported ${sites.size} sharps drop-off sites (data as of ${verifiedAt.toISOString()}), ` +
      `skipped ${skipped} mobile units or repeats, retired ${retired}.`,
  );
} finally {
  await pool.end();
}
