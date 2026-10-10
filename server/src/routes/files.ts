import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { errorSchema, HttpError } from '../lib/errors.ts';
import { FILE_COLUMNS, type FileRow, fileSchema, newUploadKey, parseUploadKey, toFile } from '../lib/files.ts';
import { detectImageType, IMAGE_SIGNATURE_BYTES, imageTypeSchema, MAX_IMAGE_BYTES } from '../lib/images.ts';
import { perUserRateLimit } from '../lib/rate-limit.ts';
import { UPLOAD_URL_TTL_SECONDS } from '../lib/storage.ts';

const security = [{ bearerAuth: [] }];

const fileRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    '/uploads',
    {
      onRequest: app.authenticate,
      config: { rateLimit: perUserRateLimit(60, '1 hour') },
      schema: {
        tags: ['files'],
        summary: 'Get a URL to upload a photo to',
        description:
          'Upload the photo with a PUT to `uploadUrl`, sending the returned headers and exactly `sizeBytes` bytes. ' +
          'Then confirm it with `POST /files`.',
        security,
        body: z.object({
          contentType: imageTypeSchema,
          sizeBytes: z.number().int().min(1).max(MAX_IMAGE_BYTES),
        }),
        response: {
          200: z.object({
            key: z.string(),
            uploadUrl: z.url(),
            method: z.literal('PUT'),
            headers: z.object({ 'Content-Type': z.string() }),
            expiresIn: z.number().int().describe('Seconds until the upload URL expires'),
          }),
          400: errorSchema,
          401: errorSchema,
          429: errorSchema,
        },
      },
    },
    async (request) => {
      const { contentType, sizeBytes } = request.body;
      const key = newUploadKey(request.user.id, contentType);
      return {
        key,
        uploadUrl: await app.storage.presignUpload(key, contentType, sizeBytes),
        method: 'PUT' as const,
        headers: { 'Content-Type': contentType },
        expiresIn: UPLOAD_URL_TTL_SECONDS,
      };
    },
  );

  app.post(
    '/files',
    {
      onRequest: app.authenticate,
      schema: {
        tags: ['files'],
        summary: 'Confirm an uploaded photo',
        description:
          'Checks the uploaded object and records it, returning the file id to attach to a report or party. ' +
          'Safe to retry with the same key.',
        security,
        body: z.object({ key: z.string().max(200) }),
        response: { 201: fileSchema, 400: errorSchema, 401: errorSchema },
      },
    },
    async (request, reply) => {
      const { key } = request.body;
      const issued = parseUploadKey(key);
      if (!issued || issued.userId !== request.user.id) {
        throw new HttpError(400, 'INVALID_UPLOAD_KEY', 'Use a key returned by POST /uploads');
      }

      const existing = await app.db.query<FileRow>(`SELECT ${FILE_COLUMNS} FROM file WHERE key = $1`, [key]);
      if (existing.rows[0]) return reply.status(201).send(await toFile(existing.rows[0], app.storage));

      const object = await app.storage.head(key);
      if (!object) {
        throw new HttpError(400, 'UPLOAD_NOT_FOUND', 'Upload the photo to the upload URL before confirming it');
      }

      // The signed URL already pins the type and size, but check what actually arrived before trusting it.
      const signature = await app.storage.readStart(key, IMAGE_SIGNATURE_BYTES);
      const valid =
        object.contentType === issued.contentType &&
        object.sizeBytes <= MAX_IMAGE_BYTES &&
        detectImageType(signature) === issued.contentType;
      if (!valid) {
        await app.storage.remove(key);
        throw new HttpError(400, 'INVALID_IMAGE', 'The upload is not a valid JPEG, PNG or WebP image');
      }

      const inserted = await app.db.query<FileRow>(
        `INSERT INTO file (key, content_type, size_bytes, uploaded_by_user_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (key) DO NOTHING
         RETURNING ${FILE_COLUMNS}`,
        [key, issued.contentType, object.sizeBytes, request.user.id],
      );
      // No row means a concurrent confirmation of the same key won; return its row.
      const row =
        inserted.rows[0] ??
        (await app.db.query<FileRow>(`SELECT ${FILE_COLUMNS} FROM file WHERE key = $1`, [key])).rows[0]!;
      return reply.status(201).send(await toFile(row, app.storage));
    },
  );
};

export default fileRoutes;
