import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { type Tag, type Terrain, terrainSchema } from '../lib/analyzer.ts';
import { errorSchema, HttpError } from '../lib/errors.ts';
import type { ImageType } from '../lib/images.ts';
import { volumeEstimate, volumeEstimateSchema } from '../lib/volume.ts';
import { perUserRateLimit } from '../lib/rate-limit.ts';

const security = [{ bearerAuth: [] }];

const photoAnalysisSchema = z.object({
  fileId: z.uuid(),
  showsLitter: z.boolean().describe('False when Gemini sees no litter; warn the reporter, but let them continue'),
  description: z.string().describe('Suggested report description'),
  categories: z.array(z.string()).describe('Suggested category codes from GET /tags'),
  hazards: z.array(z.string()).describe('Suggested hazard codes from GET /tags'),
  estimatedVolume: volumeEstimateSchema
    .nullable()
    .describe('Suggested trash amount, with bag counts for common bag sizes; null when there is no litter'),
  terrain: terrainSchema,
  model: z.string(),
  createdAt: z.iso.datetime(),
});

type PhotoAnalysis = z.infer<typeof photoAnalysisSchema>;

interface AnalysisRow {
  file_id: string;
  shows_litter: boolean;
  description: string;
  category_codes: string[];
  hazard_codes: string[];
  estimated_volume_min_gallons: number | null;
  estimated_volume_max_gallons: number | null;
  terrain: Terrain;
  model: string;
  created_at: Date;
}

const ANALYSIS_COLUMNS = `file_id, shows_litter, description, category_codes, hazard_codes,
                          estimated_volume_min_gallons, estimated_volume_max_gallons, terrain, model, created_at`;

function toAnalysis(row: AnalysisRow): PhotoAnalysis {
  return {
    fileId: row.file_id,
    showsLitter: row.shows_litter,
    description: row.description,
    categories: row.category_codes,
    hazards: row.hazard_codes,
    estimatedVolume:
      row.estimated_volume_min_gallons === null || row.estimated_volume_max_gallons === null
        ? null
        : volumeEstimate({
            minGallons: row.estimated_volume_min_gallons,
            maxGallons: row.estimated_volume_max_gallons,
          }),
    terrain: row.terrain,
    model: row.model,
    createdAt: row.created_at.toISOString(),
  };
}

const analysisRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/files/:id/analysis',
    {
      onRequest: app.authenticate,
      config: { rateLimit: perUserRateLimit(30, '1 hour') },
      schema: {
        tags: ['files'],
        summary: 'Suggest report tags for an uploaded photo',
        description:
          'Gemini looks at the photo and suggests a description, categories, hazards and a trash amount to prefill the ' +
          'report form. The reporter confirms or edits them before `POST /reports`. ' +
          'Each photo is analyzed once; calling again returns the same result. ' +
          'On 503 `ANALYSIS_UNAVAILABLE`, show the form empty.',
        security,
        params: z.object({ id: z.uuid() }),
        response: {
          200: photoAnalysisSchema,
          400: errorSchema,
          401: errorSchema,
          404: errorSchema,
          429: errorSchema,
          503: errorSchema,
        },
      },
    },
    async (request) => {
      const fileId = request.params.id;
      const { rows } = await app.db.query<{ key: string; content_type: ImageType; analyzed: boolean }>(
        `SELECT f.key, f.content_type, EXISTS (SELECT 1 FROM photo_analysis WHERE file_id = f.id) AS analyzed
         FROM file f
         WHERE f.id = $1 AND f.uploaded_by_user_id = $2`,
        [fileId, request.user.id],
      );
      const file = rows[0];
      if (!file) throw new HttpError(404, 'FILE_NOT_FOUND', 'Upload the photo and confirm it with POST /files first');

      const select = () =>
        app.db.query<AnalysisRow>(`SELECT ${ANALYSIS_COLUMNS} FROM photo_analysis WHERE file_id = $1`, [fileId]);
      if (file.analyzed) return toAnalysis((await select()).rows[0]!);

      const [categories, hazards, image] = await Promise.all([
        app.db.query<Tag>(`SELECT code, label FROM trash_category ORDER BY code`),
        app.db.query<Tag>(`SELECT code, label FROM hazard ORDER BY code`),
        app.storage.read(file.key),
      ]);

      const startedAt = performance.now();
      let result;
      try {
        result = await app.analyzer.analyze({
          image,
          contentType: file.content_type,
          categories: categories.rows,
          hazards: hazards.rows,
        });
      } catch (err) {
        request.log.error({ err, fileId }, 'photo analysis failed');
        throw new HttpError(503, 'ANALYSIS_UNAVAILABLE', 'Photo analysis is unavailable; fill in the report by hand');
      }
      const latencyMs = Math.round(performance.now() - startedAt);

      const { analysis } = result;
      const inserted = await app.db.query<AnalysisRow>(
        `INSERT INTO photo_analysis (file_id, model, shows_litter, description, category_codes, hazard_codes,
                                     estimated_volume_min_gallons, estimated_volume_max_gallons, terrain,
                                     input_tokens, output_tokens, latency_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (file_id) DO NOTHING
         RETURNING ${ANALYSIS_COLUMNS}`,
        [
          fileId,
          result.model,
          analysis.showsLitter,
          analysis.description,
          analysis.categories,
          analysis.hazards,
          analysis.estimatedVolume?.minGallons ?? null,
          analysis.estimatedVolume?.maxGallons ?? null,
          analysis.terrain,
          result.inputTokens,
          result.outputTokens,
          latencyMs,
        ],
      );
      // No row means a concurrent request for the same photo saved first; return its result.
      return toAnalysis(inserted.rows[0] ?? (await select()).rows[0]!);
    },
  );
};

export default analysisRoutes;
