// Creates a demo quest with a sharps or biohazard report, so the drop-off screen has something to show.
// It runs the real flow in process (register, R2 upload, report, quest, drop-off lookup) without a running API.
// Any signed-in user can open the quest, so you can stay signed in as yourself.
//
//   infisical run -- npm run seed:demo-quest
//   infisical run -- npm run seed:demo-quest -- --hazard biohazard --latitude 40.6782 --longitude -73.9442
//   infisical run -- npm run seed:demo-quest -- --clean
//
// Demo users have emails at DEMO_EMAIL_DOMAIN; --clean deletes them and everything they created.

import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { buildApp } from '../src/app.ts';
import { loadEnv } from '../src/env.ts';
import { createGeminiAnalyzer } from '../src/lib/analyzer.ts';
import { createPool } from '../src/lib/db.ts';
import { createGooglePlaceFinder } from '../src/lib/places.ts';
import { createR2Storage } from '../src/lib/storage.ts';

const DEMO_EMAIL_DOMAIN = 'demo.cleanpursuit.test';

// A 1x1 green PNG, so the report has a real photo without shipping an image file.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const { values } = parseArgs({
  options: {
    hazard: { type: 'string', default: 'sharps' },
    // Bryant Park, Manhattan.
    latitude: { type: 'string', default: '40.7536' },
    longitude: { type: 'string', default: '-73.9832' },
    title: { type: 'string' },
    clean: { type: 'boolean', default: false },
  },
});

const env = { ...loadEnv(), LOG_LEVEL: 'silent' as const };
const storage = createR2Storage({
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucket: env.R2_BUCKET,
});

async function clean() {
  const pool = createPool(env.DATABASE_URL);
  try {
    const { rows: users } = await pool.query<{ id: string }>(`SELECT id FROM app_user WHERE email LIKE $1`, [
      `%@${DEMO_EMAIL_DOMAIN}`,
    ]);
    const ids = [users.map((user) => user.id)];
    const { rows: files } = await pool.query<{ key: string }>(
      `SELECT key FROM file WHERE uploaded_by_user_id = ANY($1)`,
      ids,
    );
    await pool.query('DELETE FROM activity_event WHERE user_id = ANY($1)', ids);
    // Saved drop-off lists go with the quest (ON DELETE CASCADE).
    await pool.query(
      `DELETE FROM quest
       WHERE created_by_user_id = ANY($1)
          OR report_id IN (SELECT id FROM report WHERE reporter_user_id = ANY($1))`,
      ids,
    );
    // Duplicates and their originals go in one statement, which checks the self-reference at the end.
    await pool.query('DELETE FROM report WHERE reporter_user_id = ANY($1)', ids);
    await pool.query('DELETE FROM file WHERE uploaded_by_user_id = ANY($1)', ids);
    await pool.query('DELETE FROM refresh_token WHERE user_id = ANY($1)', ids);
    await pool.query('DELETE FROM app_user WHERE id = ANY($1)', ids);
    await Promise.all(files.map(({ key }) => storage.remove(key)));
    console.log(`Deleted ${users.length} demo users and ${files.length} photos.`);
  } finally {
    await pool.end();
  }
}

async function seed() {
  const location = { latitude: Number(values.latitude), longitude: Number(values.longitude) };
  const app = await buildApp({
    env,
    pool: createPool(env.DATABASE_URL),
    storage,
    // Not called: the report is filed with its tags directly.
    analyzer: createGeminiAnalyzer({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL }),
    places: createGooglePlaceFinder({ apiKey: env.GOOGLE_MAPS_API_KEY }),
  });

  try {
    const call = async (method: 'GET' | 'POST', url: string, payload?: object, token?: string) => {
      const res = await app.inject({
        method,
        url,
        payload,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      if (res.statusCode >= 400) throw new Error(`${method} ${url} failed with ${res.statusCode}: ${res.body}`);
      return res.json();
    };

    const username = `demo_${randomBytes(4).toString('hex')}`;
    const password = randomBytes(12).toString('base64url');
    const { accessToken: token } = await call('POST', '/auth/register', {
      username,
      email: `${username}@${DEMO_EMAIL_DOMAIN}`,
      password,
    });

    const { key, uploadUrl } = await call(
      'POST',
      '/uploads',
      { contentType: 'image/png', sizeBytes: PHOTO.length },
      token,
    );
    const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: PHOTO });
    if (!put.ok) throw new Error(`upload to R2 failed with ${put.status}`);
    const file = await call('POST', '/files', { key }, token);

    const report = await call(
      'POST',
      '/reports',
      {
        photoFileId: file.id,
        description:
          values.hazard === 'sharps' ? 'Syringes and wrappers by a planter.' : 'Dumped diapers and food waste.',
        location,
        categories: ['plastic', 'mixed'],
        hazards: [values.hazard],
      },
      token,
    );

    // Running the script twice at one spot files a duplicate; reuse the original's quest then.
    let questId: string | null = report.duplicateOf?.questId ?? null;
    if (questId) {
      console.log('This spot already has a quest; showing that one.');
    } else {
      const title = values.title ?? (values.hazard === 'sharps' ? 'Needles by Bryant Park' : 'Biohazard cleanup');
      questId = (await call('POST', `/reports/${report.id}/quest`, { title }, token)).id as string;
    }

    const { dropoffs } = await call('GET', `/quests/${questId}/dropoffs`, undefined, token);

    console.log(`Quest ${questId}`);
    console.log(`  ${dropoffs.length} drop-off sites, nearest: ${dropoffs[0]?.name ?? 'none'}`);
    console.log(`  web:      http://localhost:8081/quests/${questId}/dropoffs`);
    console.log(`  Expo Go:  <exps:// link from scripts/phone.sh>/--/quests/${questId}/dropoffs`);
    console.log(`  demo user ${username} / ${password} (any signed-in user can open the quest)`);
    console.log('Remove demo data with: infisical run -- npm run seed:demo-quest -- --clean');
  } finally {
    await app.close();
  }
}

if (values.hazard !== 'sharps' && values.hazard !== 'biohazard') {
  console.error('--hazard must be sharps or biohazard');
  process.exit(1);
}
if (values.clean) await clean();
else await seed();
