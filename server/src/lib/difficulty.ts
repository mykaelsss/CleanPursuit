import { z } from 'zod';
import { KITCHEN_BAG_GALLONS, tierGallons, type VolumeRange } from './volume.ts';

// Matches the difficulty_tier enum in the database.
export const difficultyTierSchema = z.enum(['easy', 'medium', 'hard', 'legendary']);

export type DifficultyTier = z.infer<typeof difficultyTierSchema>;

// Trash amounts, in kitchen bags, that raise the tier.
const MEDIUM_BAGS = 4;
const HARD_BAGS = 10;

export interface DifficultyInput {
  categories: readonly string[];
  hazards: readonly string[];
  estimatedVolume?: VolumeRange | null;
}

// Our rules, not Gemini's opinion, set the tier from the tags and trash amount the reporter submits.
// Keep docs/mvp.md in sync with these rules.
export function difficultyTier({ categories, hazards, estimatedVolume }: DifficultyInput): DifficultyTier {
  const bags = estimatedVolume ? tierGallons(estimatedVolume) / KITCHEN_BAG_GALLONS : 0;
  if (hazards.includes('sharps') || hazards.includes('biohazard')) return 'legendary';
  if (hazards.includes('chemicals') || hazards.includes('broken_glass') || bags >= HARD_BAGS) return 'hard';
  if (hazards.includes('bulky_items') || categories.includes('electronics') || bags >= MEDIUM_BAGS) return 'medium';
  return 'easy';
}
