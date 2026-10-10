import type pg from 'pg';
import type { Env } from '../src/env.ts';

export const testEnv: Env = {
  NODE_ENV: 'test',
  HOST: '127.0.0.1',
  PORT: 3000,
  LOG_LEVEL: 'silent',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://unused',
  JWT_SECRET: 'test-secret-that-is-only-used-in-tests',
};

export function fakePool(query: () => Promise<unknown> = async () => ({ rows: [] })): pg.Pool {
  return { query, on: () => {}, end: async () => {} } as unknown as pg.Pool;
}
