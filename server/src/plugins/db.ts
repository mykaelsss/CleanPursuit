import fp from 'fastify-plugin';
import type pg from 'pg';

declare module 'fastify' {
  interface FastifyInstance {
    db: pg.Pool;
  }
}

export interface DbPluginOptions {
  pool: pg.Pool;
}

// Shares one Postgres pool with every route as `app.db` and closes it when the app closes.
export default fp<DbPluginOptions>(
  async (app, { pool }) => {
    // An idle client can lose its connection; without a listener that error crashes the process.
    pool.on('error', (err) => app.log.error({ err }, 'idle database client error'));
    app.decorate('db', pool);
    app.addHook('onClose', () => pool.end());
  },
  { name: 'db' },
);
