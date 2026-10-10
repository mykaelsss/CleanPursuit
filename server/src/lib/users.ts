import { z } from 'zod';
import { levelFor, levelSchema } from './levels.ts';

// The user fields the API may return. Never add password_hash here.
export const userSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  email: z.string(),
  totalXp: z.number().int(),
  level: levelSchema,
  createdAt: z.iso.datetime(),
});

export type User = z.infer<typeof userSchema>;

export const USER_COLUMNS = 'id, username, email, total_xp, created_at';

export interface UserRow {
  id: string;
  username: string;
  email: string;
  total_xp: number;
  created_at: Date;
}

export function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    totalXp: row.total_xp,
    level: levelFor(row.total_xp),
    createdAt: row.created_at.toISOString(),
  };
}

// How other resources refer to a user: no email, XP or level.
export const userSummarySchema = userSchema.pick({ id: true, username: true });
