import { buildApp } from './app.ts';
import { createGeminiAnalyzer } from './lib/analyzer.ts';
import { type Env, loadEnv } from './env.ts';
import { createPool } from './lib/db.ts';
import { createGooglePlaceFinder } from './lib/places.ts';
import { createR2Storage } from './lib/storage.ts';

let env: Env;
try {
  env = loadEnv();
} catch (err) {
  console.error((err as Error).message);
  console.error('Run with `infisical run -- npm run dev`, or see .env.example.');
  process.exit(1);
}

const pool = createPool(env.DATABASE_URL);
const storage = createR2Storage({
  accountId: env.R2_ACCOUNT_ID,
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  bucket: env.R2_BUCKET,
});
const analyzer = createGeminiAnalyzer({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL });
const places = createGooglePlaceFinder({ apiKey: env.GOOGLE_MAPS_API_KEY });
const app = await buildApp({ env, pool, storage, analyzer, places });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, async () => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.fatal({ err }, 'failed to start');
  await app.close();
  process.exit(1);
}
