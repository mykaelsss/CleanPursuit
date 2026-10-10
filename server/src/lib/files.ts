import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { IMAGE_EXTENSIONS, type ImageType } from './images.ts';
import type { Storage } from './storage.ts';

export const fileSchema = z.object({
  id: z.uuid(),
  contentType: z.string(),
  sizeBytes: z.number().int(),
  url: z.url().describe('Expires after an hour; cache the image by file id'),
  createdAt: z.iso.datetime(),
});

export type File = z.infer<typeof fileSchema>;

// How other resources return a photo.
export const photoSchema = fileSchema.pick({ id: true, url: true });

export const FILE_COLUMNS = 'id, key, content_type, size_bytes, created_at';

export interface FileRow {
  id: string;
  key: string;
  content_type: string;
  // bigint, which pg returns as a string.
  size_bytes: string;
  created_at: Date;
}

export async function toFile(row: FileRow, storage: Storage): Promise<File> {
  return {
    id: row.id,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    url: await storage.presignDownload(row.key),
    createdAt: row.created_at.toISOString(),
  };
}

// Upload keys embed the uploader's id, so confirming an upload can check who it belongs to
// without storing pending uploads anywhere.
export function newUploadKey(userId: string, contentType: ImageType): string {
  return `users/${userId}/${randomUUID()}.${IMAGE_EXTENSIONS[contentType]}`;
}

const uploadKeyPattern = /^users\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.([a-z]+)$/;

// The uploader and the content type the key was issued for, or null if the API never issued it.
export function parseUploadKey(key: string): { userId: string; contentType: ImageType } | null {
  const match = uploadKeyPattern.exec(key);
  if (!match) return null;
  const entry = Object.entries(IMAGE_EXTENSIONS).find(([, extension]) => extension === match[2]);
  return entry ? { userId: match[1]!, contentType: entry[0] as ImageType } : null;
}
