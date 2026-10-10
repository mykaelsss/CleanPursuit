import pg from 'pg';

export function createPool(databaseUrl: string): pg.Pool {
  // Read sslmode the way psql and Tiger's docs do. Without this, pg treats `require` as `verify-full`,
  // which rejects Tiger's certificate because it is signed by Timescale's own CA.
  const url = new URL(databaseUrl);
  url.searchParams.set('uselibpqcompat', 'true');
  return new pg.Pool({ connectionString: url.toString() });
}

// Runs `fn` in a transaction on one client, committing if it resolves and rolling back if it throws.
export async function withTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function isUniqueViolation(err: unknown, constraint: string): boolean {
  return err instanceof pg.DatabaseError && err.code === '23505' && err.constraint === constraint;
}

export function isForeignKeyViolation(err: unknown, constraint: string): boolean {
  return err instanceof pg.DatabaseError && err.code === '23503' && err.constraint === constraint;
}
