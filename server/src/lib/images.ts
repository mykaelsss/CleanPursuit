import { z } from 'zod';

// Formats every phone, browser and Gemini can handle. The app converts HEIC photos to JPEG before uploading.
export const IMAGE_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type ImageType = keyof typeof IMAGE_EXTENSIONS;

export const imageTypeSchema = z.enum(Object.keys(IMAGE_EXTENSIONS) as [ImageType, ...ImageType[]]);

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// Enough leading bytes to recognize every allowed format.
export const IMAGE_SIGNATURE_BYTES = 12;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((byte, i) => bytes[offset + i] === byte);
}

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

// Detects the format from the file's first bytes, since the declared content type is only the client's claim.
export function detectImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, ...ascii('PNG\r\n'), 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  return null;
}
