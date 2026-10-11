import type { DifficultyTier } from './difficulty.ts';

// XP rules. Keep docs/mvp.md in sync with these numbers.

// The most XP one member can earn in one party, hotspot bonus included.
// It scales with the quest's difficulty: easy 1x, medium 1.5x, hard 2x, legendary 3x.
export const TIER_MAX_XP: Record<DifficultyTier, number> = {
  easy: 100,
  medium: 150,
  hard: 200,
  legendary: 300,
};

// Every checked-in member earns at least this much when the party ends with a photo,
// even when a quick cleanup has no full minute between location pings.
export const TIER_MIN_XP: Record<DifficultyTier, number> = {
  easy: 25,
  medium: 40,
  hard: 50,
  legendary: 75,
};

// A scheduled party's time slot counts as its length in whole minutes, between these limits.
const MIN_SLOT_MINUTES = 1;
const MAX_SLOT_MINUTES = 100;
// A walk-up has no schedule, so an hour on site earns the full amount.
export const WALK_UP_SLOT_MINUTES = 60;
const HOTSPOT_BONUS_PERCENT = 20;

// The minutes on site that earn the full amount at a scheduled party.
export function scheduleSlotMinutes(start: Date, end: Date): number {
  const minutes = Math.floor((end.getTime() - start.getTime()) / 60_000);
  return Math.min(MAX_SLOT_MINUTES, Math.max(MIN_SLOT_MINUTES, minutes));
}

// Base XP: the time-based award, with a minimum for each difficulty tier.
export function baseXp(tier: DifficultyTier, minutesOnSite: number, slotMinutes: number): number {
  const minutes = Math.min(Math.max(minutesOnSite, 0), slotMinutes);
  return Math.max(TIER_MIN_XP[tier], Math.floor((TIER_MAX_XP[tier] * minutes) / slotMinutes));
}

// The hotspot bonus on top of base XP, limited so the total stays within the tier's maximum.
export function hotspotBonusXp(tier: DifficultyTier, base: number): number {
  return Math.min(Math.floor((base * HOTSPOT_BONUS_PERCENT) / 100), Math.max(0, TIER_MAX_XP[tier] - base));
}
