import type { DifficultyTier } from './difficulty.ts';

// XP rules. Keep docs/mvp.md in sync with these numbers.
export const XP_PER_HOUR = 100;
// Time on site beyond this earns nothing more, so a long party cannot farm XP.
export const MAX_XP_HOURS = 3;
export const TIER_MULTIPLIER: Record<DifficultyTier, number> = {
  easy: 1,
  medium: 1.5,
  hard: 2,
  legendary: 3,
};

// XP for a given time on site at a given tier.
export function xpFor(tier: DifficultyTier, minutesOnSite: number): number {
  const hours = Math.min(Math.max(minutesOnSite, 0) / 60, MAX_XP_HOURS);
  return Math.round(hours * XP_PER_HOUR * TIER_MULTIPLIER[tier]);
}

// The most XP an attendee can earn at a scheduled party: present for the whole time slot.
export function maxXpForSchedule(tier: DifficultyTier, start: Date, end: Date): number {
  return xpFor(tier, (end.getTime() - start.getTime()) / 60_000);
}
