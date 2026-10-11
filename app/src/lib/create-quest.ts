import type { AuthedRequest, LitterReport, Quest, ReportInput, VolumeRange } from './api';

export function parseLocation(latitude: string, longitude: string) {
  if (!latitude.trim() || !longitude.trim()) return null;
  const lat = Number(latitude);
  const lng = Number(longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { latitude: lat, longitude: lng }
    : null;
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
