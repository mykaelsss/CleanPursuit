import assert from 'node:assert/strict';
import { test } from 'node:test';
import { difficultyTier } from '../src/lib/difficulty.ts';
import { newUploadKey, parseUploadKey } from '../src/lib/files.ts';
import { detectImageType } from '../src/lib/images.ts';
import { LEVEL_START_XP, levelFor, MAX_LEVEL } from '../src/lib/levels.ts';
import { isSensibleRange, sensibleRange, tierGallons, volumeEstimate } from '../src/lib/volume.ts';

test('difficulty tier follows the documented rules', () => {
  // Kitchen bags as an exact volume, so the tier sees exactly that many.
  const tier = (hazards: string[], categories: string[] = ['plastic'], kitchenBags?: number) =>
    difficultyTier({
      categories,
      hazards,
      estimatedVolume: kitchenBags ? { minGallons: kitchenBags * 13, maxGallons: kitchenBags * 13 } : null,
    });

  assert.equal(tier([]), 'easy');
  assert.equal(tier([], ['plastic'], 3), 'easy');
  assert.equal(tier([], ['plastic'], 4), 'medium');
  assert.equal(tier([], ['electronics']), 'medium');
  assert.equal(tier(['bulky_items']), 'medium');
  assert.equal(tier([], ['plastic'], 10), 'hard');
  assert.equal(tier(['broken_glass']), 'hard');
  assert.equal(tier(['chemicals', 'bulky_items']), 'hard');
  assert.equal(tier(['sharps']), 'legendary');
  assert.equal(tier(['biohazard', 'broken_glass'], ['plastic'], 20), 'legendary');
});

test('the tier uses a point a third of the way up the volume range', () => {
  assert.equal(tierGallons({ minGallons: 90, maxGallons: 120 }), 100);
  const tier = (minGallons: number, maxGallons: number) =>
    difficultyTier({ categories: ['plastic'], hazards: [], estimatedVolume: { minGallons, maxGallons } });
  // 8-12 kitchen bags: the middle (10 bags) would be hard, but leaning low it is medium.
  assert.equal(tier(104, 156), 'medium');
  assert.equal(tier(130, 195), 'hard');
  assert.equal(tier(40, 52), 'easy');
});

test('volume ranges stay tight, and bag counts come from them', () => {
  assert.equal(isSensibleRange({ minGallons: 104, maxGallons: 156 }), true);
  assert.equal(isSensibleRange({ minGallons: 2, maxGallons: 15 }), true, 'one kitchen bag of slack for small piles');
  assert.equal(isSensibleRange({ minGallons: 50, maxGallons: 150 }), false);
  assert.equal(isSensibleRange({ minGallons: 30, maxGallons: 20 }), false);

  // Too wide: narrowed around the same middle.
  assert.deepEqual(sensibleRange({ minGallons: 50, maxGallons: 150 }), { minGallons: 71, maxGallons: 106 });
  assert.deepEqual(sensibleRange({ minGallons: 30, maxGallons: 20 }), { minGallons: 20, maxGallons: 30 });
  assert.deepEqual(sensibleRange({ minGallons: 104, maxGallons: 156 }), { minGallons: 104, maxGallons: 156 });
  for (const [low, high] of [[1, 5000], [13, 400], [7, 9], [500, 9000]] as const) {
    assert.ok(isSensibleRange(sensibleRange({ minGallons: low, maxGallons: high })), `${low}-${high}`);
  }

  // Never something like "4-12 contractor bags".
  const contractor = volumeEstimate(sensibleRange({ minGallons: 150, maxGallons: 500 })).bags[2]!;
  assert.ok(contractor.max <= Math.ceil(contractor.min * 1.5), `${contractor.min}-${contractor.max}`);

  assert.deepEqual(volumeEstimate({ minGallons: 5, maxGallons: 8 }).bags, [
    { size: 'kitchen', gallons: 13, min: 1, max: 1 },
    { size: 'large', gallons: 33, min: 1, max: 1 },
    { size: 'contractor', gallons: 42, min: 1, max: 1 },
  ]);
});

test('detectImageType recognizes JPEG, PNG and WebP by their first bytes', () => {
  const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
  assert.equal(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
  assert.equal(detectImageType(new Uint8Array([0x89, ...ascii('PNG\r\n'), 0x1a, 0x0a])), 'image/png');
  assert.equal(detectImageType(new Uint8Array([...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP')])), 'image/webp');
  assert.equal(detectImageType(new Uint8Array(ascii('<svg xmlns='))), null);
  assert.equal(detectImageType(new Uint8Array()), null);
});

test('upload keys round-trip and reject anything the API did not issue', () => {
  const userId = '01990000-0000-7000-8000-000000000000';
  const key = newUploadKey(userId, 'image/webp');
  assert.match(key, /^users\/01990000-0000-7000-8000-000000000000\/[0-9a-f-]{36}\.webp$/);
  assert.deepEqual(parseUploadKey(key), { userId, contentType: 'image/webp' });

  assert.equal(parseUploadKey(`users/${userId}/../../secret.jpg`), null);
  assert.equal(parseUploadKey(`users/${userId}/01990000-0000-7000-8000-000000000001.gif`), null);
  assert.equal(parseUploadKey('photo.jpg'), null);
});

test('levels grow by 1.2x per level from 1000 XP, up to level 15', () => {
  // Keep in sync with the table in docs/mvp.md.
  assert.deepEqual(
    LEVEL_START_XP,
    [0, 1000, 2200, 3600, 5300, 7400, 9900, 12900, 16500, 20800, 26000, 32200, 39600, 48500, 59200],
  );
  assert.equal(LEVEL_START_XP.length, MAX_LEVEL);

  assert.deepEqual(levelFor(0), { number: 1, xpIntoLevel: 0, xpForNextLevel: 1000 });
  assert.deepEqual(levelFor(999), { number: 1, xpIntoLevel: 999, xpForNextLevel: 1000 });
  assert.deepEqual(levelFor(1000), { number: 2, xpIntoLevel: 0, xpForNextLevel: 1200 });
  assert.deepEqual(levelFor(3000), { number: 3, xpIntoLevel: 800, xpForNextLevel: 1400 });
  assert.deepEqual(levelFor(59199), { number: 14, xpIntoLevel: 10699, xpForNextLevel: 10700 });
  assert.deepEqual(levelFor(59200), { number: 15, xpIntoLevel: 0, xpForNextLevel: null });
  assert.deepEqual(levelFor(100000), { number: 15, xpIntoLevel: 40800, xpForNextLevel: null });
});
