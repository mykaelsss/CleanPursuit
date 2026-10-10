import assert from 'node:assert/strict';
import { test } from 'node:test';
import { difficultyTier } from '../src/lib/difficulty.ts';
import { newUploadKey, parseUploadKey } from '../src/lib/files.ts';
import { detectImageType } from '../src/lib/images.ts';

test('difficulty tier follows the documented rules', () => {
  const tier = (hazards: string[], categories: string[] = ['plastic'], estimatedBagCount?: number) =>
    difficultyTier({ categories, hazards, estimatedBagCount });

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
