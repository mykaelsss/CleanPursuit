import fp from 'fastify-plugin';
import type { Storage } from '../lib/storage.ts';

declare module 'fastify' {
  interface FastifyInstance {
    storage: Storage;
  }
}

export interface StoragePluginOptions {
  storage: Storage;
}

// Shares the object storage (R2) with every route as `app.storage`.
export default fp<StoragePluginOptions>(
  async (app, { storage }) => {
    app.decorate('storage', storage);
  },
  { name: 'storage' },
);
