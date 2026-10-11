import { z } from 'zod';
import type { Location } from './geo.ts';

// Places gets this long to answer before the drop-off lookup gives up and retries on the next request.
export const PLACES_TIMEOUT_MS = 10_000;

export interface Place {
  id: string;
  name: string;
  address: string;
  location: Location;
}

export interface SearchInput {
  query: string;
  center: Location;
  radiusM: number;
  limit: number;
}

// Finds places with Google Places in production; tests pass a fake.
// Places terms only allow storing place IDs, so callers keep the ID and fetch details again when showing a place.
export interface PlaceFinder {
  search(input: SearchInput): Promise<Place[]>;
  // null when the place no longer exists.
  details(placeId: string): Promise<Place | null>;
}

export class PlacesFailedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'PlacesFailedError';
  }
}

const placeSchema = z.object({
  id: z.string(),
  displayName: z.object({ text: z.string() }),
  formattedAddress: z.string(),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
});

const searchResponseSchema = z.object({ places: z.array(placeSchema).default([]) });

// Only the fields we show, which keeps each call in the cheaper Places SKUs.
const PLACE_FIELDS = ['id', 'displayName', 'formattedAddress', 'location'];

function toPlace(place: z.infer<typeof placeSchema>): Place {
  return {
    id: place.id,
    name: place.displayName.text,
    address: place.formattedAddress,
    location: place.location,
  };
}

const BASE_URL = 'https://places.googleapis.com/v1';

export function createGooglePlaceFinder({ apiKey }: { apiKey: string }): PlaceFinder {
  async function call(path: string, fieldMask: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await fetch(`${BASE_URL}${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
          'x-goog-fieldmask': fieldMask,
        },
        signal: AbortSignal.timeout(PLACES_TIMEOUT_MS),
      });
    } catch (err) {
      throw new PlacesFailedError('Could not reach Google Places', { cause: err });
    }
  }

  async function parse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
    if (!response.ok) {
      throw new PlacesFailedError(`Google Places answered ${response.status}: ${await response.text()}`);
    }
    try {
      return schema.parse(await response.json());
    } catch (err) {
      throw new PlacesFailedError('Google Places returned an unexpected answer', { cause: err });
    }
  }

  return {
    async search({ query, center, radiusM, limit }) {
      const response = await call('/places:searchText', PLACE_FIELDS.map((field) => `places.${field}`).join(','), {
        method: 'POST',
        body: JSON.stringify({
          textQuery: query,
          pageSize: limit,
          // Text Search only restricts to rectangles, so bias to the circle and let the caller filter by distance.
          locationBias: { circle: { center, radius: radiusM } },
        }),
      });
      const { places } = await parse(response, searchResponseSchema);
      return places.map(toPlace);
    },

    async details(placeId) {
      const response = await call(`/places/${encodeURIComponent(placeId)}`, PLACE_FIELDS.join(','));
      if (response.status === 404) return null;
      return toPlace(await parse(response, placeSchema));
    },
  };
}
