import { buildApp } from './app.ts';
import { type Env, loadEnv } from './env.ts';
import { createPool } from './lib/db.ts';

let env: Env;
try {
  env = loadEnv();
} catch (err) {
  console.error((err as Error).message);
  console.error('Run with `infisical run -- npm run dev`, or see .env.example.');
  process.exit(1);
}

const pool = createPool(env.DATABASE_URL);
const app = await buildApp({ env, pool });

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
