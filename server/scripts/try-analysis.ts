// Runs your own photos through the real photo flow (R2 upload, POST /files, Gemini analysis)
// and prints what Gemini suggested. Everything it creates is deleted at the end.
//
//   infisical run -- npm run try:analysis -- photo.jpg more-photos/
//   infisical run -- npm run try:analysis -- --model gemini-3.5-flash-lite --model gemini-3.8-flash photos/

import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { buildApp } from '../src/app.ts';
import { loadEnv } from '../src/env.ts';
import { createGeminiAnalyzer } from '../src/lib/analyzer.ts';
import { createPool } from '../src/lib/db.ts';
import { type ImageType, MAX_IMAGE_BYTES } from '../src/lib/images.ts';
import { createGooglePlaceFinder } from '../src/lib/places.ts';
import { createR2Storage } from '../src/lib/storage.ts';

const CONTENT_TYPES: Record<string, ImageType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { model: { type: 'string', multiple: true } },
});

function photosIn(paths: string[]): string[] {
  return paths.flatMap((path) =>
    statSync(path).isDirectory()
      ? readdirSync(path)
          .sort()
          .map((name) => join(path, name))
          .filter((file) => CONTENT_TYPES[extname(file).toLowerCase()])
      : [path],
  );
}

const photos = photosIn(positionals);
if (photos.length === 0) {
  console.error('Usage: npm run try:analysis -- [--model <id> ...] <photo or folder> ...');
  console.error('Photos must be JPEG, PNG or WebP. Run it with `infisical run --`.');
  process.exit(1);
}

const env = { ...loadEnv(), LOG_LEVEL: 'silent' as const };
const models = values.model ?? [env.GEMINI_MODEL];
const storage = createR2Storage({
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucket: env.R2_BUCKET,
});

const userIds: string[] = [];

// Deletes the throwaway users, their files and analyses (by cascade), and the photos in R2.
async function cleanUp() {
  const pool = createPool(env.DATABASE_URL);
  const { rows } = await pool.query<{ key: string }>(`SELECT key FROM file WHERE uploaded_by_user_id = ANY($1)`, [
    userIds,
  ]);
  await pool.query(`DELETE FROM file WHERE uploaded_by_user_id = ANY($1)`, [userIds]);
  await pool.query(`DELETE FROM app_user WHERE id = ANY($1)`, [userIds]);
  await Promise.all(rows.map(({ key }) => storage.remove(key)));
  await pool.end();
}

process.once('SIGINT', async () => {
  console.log('\nStopped; cleaning up.');
  await cleanUp();
  process.exit(130);
});

try {
  for (const model of models) {
    console.log(`\n=== ${model} ===`);
    const analyzer = createGeminiAnalyzer({ apiKey: env.GEMINI_API_KEY, model });
    // A fresh app per model, so each gets its own rate limit budget. Closing it ends its pool.
    const places = createGooglePlaceFinder({ apiKey: env.GOOGLE_MAPS_API_KEY });
    const app = await buildApp({ env, pool: createPool(env.DATABASE_URL), storage, analyzer, places });

    const username = `try_${randomBytes(6).toString('hex')}`;
    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: { username, email: `${username}@example.com`, password: randomBytes(16).toString('hex') },
    });
    if (registered.statusCode !== 201) throw new Error(`register failed: ${registered.body}`);
    userIds.push(registered.json().user.id);
    const headers = { authorization: `Bearer ${registered.json().accessToken}` };

    for (const photo of photos) {
      console.log(`\n${basename(photo)}`);
      const contentType = CONTENT_TYPES[extname(photo).toLowerCase()];
      const bytes = readFileSync(photo);
      if (!contentType || bytes.length > MAX_IMAGE_BYTES) {
        console.log('  skipped: use a JPEG, PNG or WebP of at most 10 MB');
        continue;
      }

      const upload = await app.inject({
        method: 'POST',
        url: '/uploads',
        headers,
        payload: { contentType, sizeBytes: bytes.length },
      });
      const { key, uploadUrl } = upload.json();
      const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes });
      if (!put.ok) throw new Error(`upload to R2 failed with ${put.status}`);
      const file = await app.inject({ method: 'POST', url: '/files', headers, payload: { key } });
      if (file.statusCode !== 201) throw new Error(`POST /files failed: ${file.body}`);

      const startedAt = performance.now();
      const res = await app.inject({ method: 'POST', url: `/files/${file.json().id}/analysis`, headers });
      const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
      if (res.statusCode !== 200) {
        console.log(`  ${res.statusCode} ${res.json().code ?? ''} after ${seconds}s: ${res.json().message}`);
        continue;
      }

      const analysis = res.json();
      const usage = await app.db.query<{ input_tokens: number; output_tokens: number }>(
        `SELECT input_tokens, output_tokens FROM photo_analysis WHERE file_id = $1`,
        [analysis.fileId],
      );
      const list = (codes: string[]) => (codes.length ? codes.join(', ') : '-');
      console.log(`  shows litter  ${analysis.showsLitter ? 'yes' : 'NO'}`);
      console.log(`  title         ${analysis.title ?? '-'}`);
      console.log(`  description   ${analysis.description}`);
      console.log(`  categories    ${list(analysis.categories)}`);
      console.log(`  hazards       ${list(analysis.hazards)}`);
      const volume = analysis.estimatedVolume;
      const span = (min: number, max: number) => (min === max ? `${min}` : `${min}-${max}`);
      if (volume) {
        const bags = volume.bags.map((bag: { size: string; min: number; max: number }) => `${span(bag.min, bag.max)} ${bag.size}`);
        const unit = volume.maxGallons === 1 ? 'gallon' : 'gallons';
        console.log(`  volume        ${span(volume.minGallons, volume.maxGallons)} ${unit}`);
        console.log(`  bags          ${bags.join(', ')}`);
      } else {
        console.log('  volume        -');
      }
      console.log(`  terrain       ${analysis.terrain}`);
      console.log(
        `  took ${seconds}s, ${usage.rows[0]!.input_tokens} input and ${usage.rows[0]!.output_tokens} output tokens`,
      );
    }
    await app.close();
  }
} finally {
  await cleanUp();
}
