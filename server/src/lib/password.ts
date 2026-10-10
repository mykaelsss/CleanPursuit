import { hash, verify } from '@node-rs/argon2';

// OWASP's argon2id settings: 19 MiB of memory, 2 passes, 1 thread.
// They match the library defaults but are written out so an upgrade cannot change them silently.
const options = { algorithm: 2 /* Argon2id */, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

export function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  return verify(passwordHash, password);
}

let dummyHash: Promise<string> | undefined;

// Spends the same time as a real check, so a login for an unknown account is not faster
// and cannot reveal which usernames and emails exist.
export async function verifyDummyPassword(password: string): Promise<false> {
  dummyHash ??= hashPassword('not a real password');
  await verify(await dummyHash, password);
  return false;
}
