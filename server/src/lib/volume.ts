import { z } from 'zod';

// How much trash a spot has, as a low and high estimate in US gallons.
// Gemini suggests it and the reporter confirms it; bag counts are worked out from it here, never by Gemini.
// Keep docs/mvp.md in sync with these rules.

export const KITCHEN_BAG_GALLONS = 13;

// The bags volunteers are likely to bring, smallest first.
export const BAG_SIZES = [
  { size: 'kitchen', gallons: KITCHEN_BAG_GALLONS },
  { size: 'large', gallons: 33 },
  { size: 'contractor', gallons: 42 },
] as const;

export const MAX_VOLUME_GALLONS = 10_000;

// A range is sensible when its high end is at most 1.5 times its low end,
// or, for small amounts, at most one kitchen bag above it.
const MAX_RANGE_RATIO = 1.5;

export interface VolumeRange {
  minGallons: number;
  maxGallons: number;
}

const gallons = z.number().int().min(1).max(MAX_VOLUME_GALLONS);

export const volumeRangeSchema = z.object({ minGallons: gallons, maxGallons: gallons });

export const volumeEstimateSchema = volumeRangeSchema.extend({
  bags: z
    .array(
      z.object({
        size: z.enum(BAG_SIZES.map((bag) => bag.size)),
        gallons: z.number().int(),
        min: z.number().int(),
        max: z.number().int(),
      }),
    )
    .describe('How many bags of each common size the trash fills, smallest bags first'),
});

export type VolumeEstimate = z.infer<typeof volumeEstimateSchema>;

export function isSensibleRange({ minGallons, maxGallons }: VolumeRange): boolean {
  return (
    maxGallons >= minGallons &&
    (maxGallons <= minGallons * MAX_RANGE_RATIO || maxGallons - minGallons <= KITCHEN_BAG_GALLONS)
  );
}

// Narrows a range that is too wide to a sensible one around the same middle (its geometric mean).
export function sensibleRange(range: VolumeRange): VolumeRange {
  const low = Math.min(range.minGallons, range.maxGallons);
  const high = Math.max(range.minGallons, range.maxGallons);
  if (isSensibleRange({ minGallons: low, maxGallons: high })) return { minGallons: low, maxGallons: high };

  const middle = Math.sqrt(low * high);
  const minGallons = Math.max(1, Math.round(middle / Math.sqrt(MAX_RANGE_RATIO)));
  return { minGallons, maxGallons: Math.min(Math.floor(minGallons * MAX_RANGE_RATIO), MAX_VOLUME_GALLONS) };
}

// The single amount the difficulty tier uses: a third of the way up the range,
// so it leans toward the low end and an inflated high end counts for less.
export function tierGallons({ minGallons, maxGallons }: VolumeRange): number {
  return (2 * minGallons + maxGallons) / 3;
}

export function volumeEstimate(range: VolumeRange): VolumeEstimate {
  return {
    ...range,
    bags: BAG_SIZES.map(({ size, gallons }) => ({
      size,
      gallons,
      min: Math.ceil(range.minGallons / gallons),
      max: Math.ceil(range.maxGallons / gallons),
    })),
  };
}
