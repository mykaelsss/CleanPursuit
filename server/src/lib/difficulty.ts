import { z } from 'zod';

// Matches the difficulty_tier enum in the database.
export const difficultyTierSchema = z.enum(['easy', 'medium', 'hard', 'legendary']);

export type DifficultyTier = z.infer<typeof difficultyTierSchema>;

export interface DifficultyInput {
  categories: readonly string[];
  hazards: readonly string[];
  estimatedBagCount?: number | null;
}

// Our rules, not Gemini's opinion, set the tier. Gemini only adds tags, and the tier is recomputed from them.
// Keep docs/mvp.md in sync with these rules.
export function difficultyTier({ categories, hazards, estimatedBagCount }: DifficultyInput): DifficultyTier {
  const bags = estimatedBagCount ?? 0;
  if (hazards.includes('sharps') || hazards.includes('biohazard')) return 'legendary';
  if (hazards.includes('chemicals') || hazards.includes('broken_glass') || bags >= 10) return 'hard';
  if (hazards.includes('bulky_items') || categories.includes('electronics') || bags >= 4) return 'medium';
  return 'easy';
}
