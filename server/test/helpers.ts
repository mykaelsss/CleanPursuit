import type pg from 'pg';
import type { Env } from '../src/env.ts';
import type { AnalyzeInput, Analysis, PhotoAnalyzer } from '../src/lib/analyzer.ts';
import type { Place, PlaceFinder, SearchInput } from '../src/lib/places.ts';
import type { Storage } from '../src/lib/storage.ts';

export const testEnv: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused',
  JWT_SECRET: 'test-secret-that-is-only-used-in-tests',
  R2_ACCOUNT_ID: 'test',
  R2_ACCESS_KEY_ID: 'test',
  R2_SECRET_ACCESS_KEY: 'test',
  R2_BUCKET: 'test',
  GEMINI_API_KEY: 'test',
  GEMINI_MODEL: 'test-model',
  GOOGLE_MAPS_API_KEY: 'test',
};

export function fakePool(query: () => Promise<unknown> = async () => ({ rows: [] })): pg.Pool {
  return { query, on: () => {}, end: async () => {} } as unknown as pg.Pool;
}

export interface FakeStorage extends Storage {
  // Stands in for the app's PUT to the upload URL.
  put(key: string, contentType: string, body: Uint8Array): void;
  has(key: string): boolean;
}

// In-memory object storage, so tests never touch R2.
export function fakeStorage(): FakeStorage {
  const objects = new Map<string, { contentType: string; body: Uint8Array }>();
  return {
    put: (key, contentType, body) => void objects.set(key, { contentType, body }),
    has: (key) => objects.has(key),
    presignUpload: async (key) => `https://storage.test/upload/${key}`,
    presignDownload: async (key) => `https://storage.test/${key}`,
    head: async (key) => {
      const object = objects.get(key);
      return object ? { contentType: object.contentType, sizeBytes: object.body.length } : null;
    },
    read: async (key) => objects.get(key)?.body ?? new Uint8Array(),
    readStart: async (key, length) => objects.get(key)?.body.slice(0, length) ?? new Uint8Array(),
    remove: async (key) => void objects.delete(key),
  };
}

// The first bytes of a PNG, followed by padding. Enough to pass the format check.
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);

export interface FakeAnalyzer extends PhotoAnalyzer {
  calls: AnalyzeInput[];
}

// Answers with `analysis` (or throws `error`), so tests never call Gemini.
export function fakeAnalyzer(analysis: Partial<Analysis> = {}, error?: Error): FakeAnalyzer {
  const calls: AnalyzeInput[] = [];
  return {
    calls,
    async analyze(input) {
      calls.push(input);
      if (error) throw error;
      return {
        analysis: {
          showsLitter: true,
          description: 'Plastic bottles by a bench.',
          categories: ['plastic'],
          hazards: [],
          estimatedVolume: { minGallons: 10, maxGallons: 15 },
          terrain: 'grass',
          ...analysis,
        },
        model: 'test-model',
        inputTokens: 1500,
        outputTokens: 200,
      };
    },
  };
}

export interface FakePlaces extends PlaceFinder {
  searches: SearchInput[];
  detailLookups: string[];
}

// Answers searches with `places` (or throws `error`), so tests never call Google Places.
export function fakePlaces(places: Place[] = [], error?: Error): FakePlaces {
  const searches: SearchInput[] = [];
  const detailLookups: string[] = [];
  return {
    searches,
    detailLookups,
    async search(input) {
      searches.push(input);
      if (error) throw error;
      return places;
    },
    async details(placeId) {
      detailLookups.push(placeId);
      if (error) throw error;
      return places.find((place) => place.id === placeId) ?? null;
    },
  };
}
