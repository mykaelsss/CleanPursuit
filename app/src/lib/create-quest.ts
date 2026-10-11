import type { ImagePickerAsset } from 'expo-image-picker';

import type { AuthedRequest, LitterReport, LocationPoint, Quest, ReportInput, VolumeRange } from './api';

export function parseLocation(latitude: string, longitude: string) {
  if (!latitude.trim() || !longitude.trim()) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { latitude: lat, longitude: lng }
    : null;
}

// Where a photo was taken, from its EXIF GPS tags, or null when it has none.
// Android sends signed decimal degrees. iOS sends positive degrees with N/S and E/W refs,
// and leaves GPS out of camera photos, so those need the phone's current location instead.
export function photoPoint(photo: Pick<ImagePickerAsset, 'exif'>): LocationPoint | null {
  const exif = photo.exif;
  if (!exif) return null;
  const latitude = signed(exif.GPSLatitude, exif.GPSLatitudeRef, 'S');
  const longitude = signed(exif.GPSLongitude, exif.GPSLongitudeRef, 'W');
  if (latitude === null || longitude === null) return null;
  // 0, 0 is what some cameras write when they have no fix.
  if (latitude === 0 && longitude === 0) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;
  return { latitude, longitude };
}

function signed(value: unknown, ref: unknown, negative: 'S' | 'W'): number | null {
  const degrees = typeof value === 'string' ? Number(value) : value;
  if (typeof degrees !== 'number' || !Number.isFinite(degrees)) return null;
  if (typeof ref !== 'string' || !ref) return degrees;
  return ref.toUpperCase().startsWith(negative) ? -Math.abs(degrees) : Math.abs(degrees);
}

// undefined means optional and empty; null means invalid.
export function parseVolume(low: string, high: string): VolumeRange | null | undefined {
  if (!low.trim() && !high.trim()) return undefined;
  const minGallons = Number(low);
  const maxGallons = Number(high);
  if (!Number.isInteger(minGallons) || !Number.isInteger(maxGallons) || minGallons < 1 ||
      maxGallons > 10_000 || maxGallons < minGallons ||
      (maxGallons > minGallons * 1.5 && maxGallons - minGallons > 13)) return null;
  return { minGallons, maxGallons };
}

export type CreationProgress = { report?: LitterReport; quest?: Quest };

// Keep successfully saved records when the next request fails. A retry resumes from them.
// GET also recovers a quest whose POST succeeded but whose response was lost.
export async function saveQuest(
  request: AuthedRequest,
  input: ReportInput,
  title: string,
  progress: CreationProgress,
  onProgress: () => void,
): Promise<Quest> {
  if (!progress.report) {
    progress.report = await request<LitterReport | null>(`/files/${input.photoFileId}/report`) ??
      await request<LitterReport>('/reports', { method: 'POST', body: input });
    onProgress();
  }
  if (progress.quest) return progress.quest;
  const reportId = progress.report.duplicateOf?.reportId ?? progress.report.id;
  const original = await request<LitterReport>(`/reports/${reportId}`);
  if (original.questId) {
    progress.quest = await request<Quest>(`/quests/${original.questId}`);
  } else {
    try {
      progress.quest = await request<Quest>(`/reports/${reportId}/quest`, {
        method: 'POST', body: { title: title.trim() },
      });
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'QUEST_EXISTS') throw error;
      const latest = await request<LitterReport>(`/reports/${reportId}`);
      if (!latest.questId) throw error;
      progress.quest = await request<Quest>(`/quests/${latest.questId}`);
    }
  }
  onProgress();
  return progress.quest;
}
