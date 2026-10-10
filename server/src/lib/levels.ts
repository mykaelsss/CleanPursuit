import { z } from 'zod';

// Levels come from all-time XP, so they are computed here rather than stored.
// Level 1 to 2 costs FIRST_LEVEL_XP, and each level after costs GROWTH times the one before,
// rounded to the nearest 100 XP. Keep docs/mvp.md in sync with these numbers.
export const MAX_LEVEL = 15;
const FIRST_LEVEL_XP = 1000;
const GROWTH = 1.2;

// LEVEL_START_XP[n - 1] is the total XP needed to reach level n.
export const LEVEL_START_XP: readonly number[] = levelStarts();

function levelStarts() {
  const starts = [0];
  let total = 0;
  for (let level = 1; level < MAX_LEVEL; level++) {
    total += Math.round((FIRST_LEVEL_XP * GROWTH ** (level - 1)) / 100) * 100;
    starts.push(total);
  }
  return starts;
}

export const levelSchema = z.object({
  number: z.number().int().min(1).max(MAX_LEVEL),
  xpIntoLevel: z.number().int().min(0).describe('XP earned since reaching this level'),
  xpForNextLevel: z
    .number()
    .int()
    .positive()
    .nullable()
    .describe('XP this level takes to finish; null at the max level'),
});

export type Level = z.infer<typeof levelSchema>;

export function levelFor(totalXp: number): Level {
  let start = 0;
  for (const [i, next] of LEVEL_START_XP.entries()) {
    if (totalXp < next) {
      return { number: i, xpIntoLevel: totalXp - start, xpForNextLevel: next - start };
    }
    start = next;
  }
  return { number: MAX_LEVEL, xpIntoLevel: totalXp - start, xpForNextLevel: null };
}
