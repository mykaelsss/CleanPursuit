import fp from 'fastify-plugin';
import type { PlaceFinder } from '../lib/places.ts';

declare module 'fastify' {
  interface FastifyInstance {
    places: PlaceFinder;
  }
}

export interface PlacesPluginOptions {
  places: PlaceFinder;
}

// Shares the place finder (Google Places) with every route as `app.places`.
export default fp<PlacesPluginOptions>(
  async (app, { places }) => {
    app.decorate('places', places);
  },
  { name: 'places' },
);
