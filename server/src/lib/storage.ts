import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Long enough to upload a large photo on a slow connection.
export const UPLOAD_URL_TTL_SECONDS = 10 * 60;
// Photo URLs in API responses stay valid this long, so the app should cache images by file id, not URL.
export const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

export interface StoredObject {
  contentType: string | undefined;
  sizeBytes: number;
}

// The object storage the API needs. R2 in production; tests pass an in-memory fake.
export interface Storage {
  // A URL the app can PUT exactly `sizeBytes` bytes of `contentType` to, and nothing else.
  presignUpload(key: string, contentType: string, sizeBytes: number): Promise<string>;
  presignDownload(key: string): Promise<string>;
  // Null when the object does not exist.
  head(key: string): Promise<StoredObject | null>;
  readStart(key: string, length: number): Promise<Uint8Array>;
  remove(key: string): Promise<void>;
}

export interface R2Options {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

export function createR2Storage({ accountId, accessKeyId, secretAccessKey, bucket }: R2Options): Storage {
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    // R2 does not support the SDK's default checksums, which would also end up in presigned URLs.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  return {
    presignUpload(key, contentType, sizeBytes) {
      return getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: sizeBytes }),
        // Signing these headers makes R2 reject an upload with a different type or size.
        { expiresIn: UPLOAD_URL_TTL_SECONDS, signableHeaders: new Set(['content-type', 'content-length']) },
      );
    },

    presignDownload(key) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
        expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      });
    },

    async head(key) {
      try {
        const result = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return { contentType: result.ContentType, sizeBytes: result.ContentLength ?? 0 };
      } catch (err) {
        if (err instanceof NotFound) return null;
        throw err;
      }
    },

    async readStart(key, length) {
      const result = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key, Range: `bytes=0-${length - 1}` }));
      return result.Body ? result.Body.transformToByteArray() : new Uint8Array();
    },

    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  };
}
