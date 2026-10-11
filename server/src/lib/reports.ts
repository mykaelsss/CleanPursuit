import type pg from 'pg';
import { z } from 'zod';
import { difficultyTierSchema } from './difficulty.ts';
import { photoSchema } from './files.ts';
import { locationSchema, placeNameSchema, selectLocation } from './geo.ts';
import type { Storage } from './storage.ts';
import { userSummarySchema } from './users.ts';
import { volumeEstimate, volumeEstimateSchema } from './volume.ts';

export const categorySchema = z.object({ code: z.string(), label: z.string() });

export const hazardSchema = z.object({
  code: z.string(),
  label: z.string(),
  warning: z.string(),
  requiresDropoff: z.boolean().describe('Show drop-off sites and the escalation path; see GET /quests/{id}/dropoffs'),
});

export const reportSchema = z.object({
  id: z.uuid(),
  description: z.string(),
  location: locationSchema,
  placeName: placeNameSchema.nullable(),
  difficultyTier: difficultyTierSchema,
  estimatedVolume: volumeEstimateSchema.nullable(),
  categories: z.array(categorySchema),
  hazards: z.array(hazardSchema),
  photo: photoSchema,
  reporter: userSummarySchema,
  questId: z.uuid().nullable(),
  duplicateOf: z
    .object({ reportId: z.uuid(), questId: z.uuid().nullable() })
    .nullable()
    .describe('Set when this spot was already reported; points at the original report and its quest'),
  createdAt: z.iso.datetime(),
});

export type Report = z.infer<typeof reportSchema>;

interface ReportRow {
  id: string;
  description: string;
  latitude: number;
  longitude: number;
  place_name: string | null;
  difficulty_tier: Report['difficultyTier'];
  estimated_volume_min_gallons: number | null;
  estimated_volume_max_gallons: number | null;
  created_at: Date;
  photo_file_id: string;
  photo_key: string;
  reporter_id: string;
  reporter_username: string;
  quest_id: string | null;
  duplicate_of_report_id: string | null;
  duplicate_quest_id: string | null;
  categories: Report['categories'];
  hazards: Report['hazards'];
}

const REPORT_QUERY = `
  SELECT r.id, r.description, ${selectLocation('r.location')}, r.place_name, r.difficulty_tier,
         r.estimated_volume_min_gallons, r.estimated_volume_max_gallons,
         r.created_at, r.photo_file_id, f.key AS photo_key, u.id AS reporter_id, u.username AS reporter_username,
         q.id AS quest_id, r.duplicate_of_report_id, dq.id AS duplicate_quest_id,
         COALESCE((SELECT json_agg(json_build_object('code', c.code, 'label', c.label) ORDER BY c.code)
                   FROM report_category rc
                   JOIN trash_category c ON c.code = rc.category_code
                   WHERE rc.report_id = r.id), '[]') AS categories,
         COALESCE((SELECT json_agg(json_build_object('code', h.code, 'label', h.label, 'warning', h.warning_text,
                                                     'requiresDropoff', h.requires_dropoff) ORDER BY h.code)
                   FROM report_hazard rh
                   JOIN hazard h ON h.code = rh.hazard_code
                   WHERE rh.report_id = r.id), '[]') AS hazards
  FROM report r
  JOIN file f ON f.id = r.photo_file_id
  JOIN app_user u ON u.id = r.reporter_user_id
  LEFT JOIN quest q ON q.report_id = r.id
  LEFT JOIN quest dq ON dq.report_id = r.duplicate_of_report_id`;

async function toReport(row: ReportRow, storage: Storage): Promise<Report> {
  return {
    id: row.id,
    description: row.description,
    location: { latitude: row.latitude, longitude: row.longitude },
    placeName: row.place_name,
    difficultyTier: row.difficulty_tier,
    estimatedVolume:
      row.estimated_volume_min_gallons === null || row.estimated_volume_max_gallons === null
        ? null
        : volumeEstimate({
            minGallons: row.estimated_volume_min_gallons,
            maxGallons: row.estimated_volume_max_gallons,
          }),
    categories: row.categories,
    hazards: row.hazards,
    photo: { id: row.photo_file_id, url: await storage.presignDownload(row.photo_key) },
    reporter: { id: row.reporter_id, username: row.reporter_username },
    questId: row.quest_id,
    duplicateOf: row.duplicate_of_report_id
      ? { reportId: row.duplicate_of_report_id, questId: row.duplicate_quest_id }
      : null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function findReport(db: pg.Pool | pg.PoolClient, storage: Storage, id: string): Promise<Report | null> {
  const { rows } = await db.query<ReportRow>(`${REPORT_QUERY} WHERE r.id = $1`, [id]);
  return rows[0] ? toReport(rows[0], storage) : null;
}
