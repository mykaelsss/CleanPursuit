import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import type { ImagePickerAsset } from 'expo-image-picker';
import { Platform } from 'react-native';

import type { AuthedRequest } from '@/lib/api';

type Upload = { key: string; uploadUrl: string; headers: Record<string, string> };
export type PhotoProgress = { body?: Blob; key?: string; fileId?: string };

export async function uploadReportPhoto(
  photo: ImagePickerAsset,
  request: AuthedRequest,
  progress: PhotoProgress,
): Promise<string> {
  if (progress.fileId) return progress.fileId;
  if (!progress.body) {
    const context = ImageManipulator.manipulate(photo.uri);
    const longest = Math.max(photo.width, photo.height);
    if (longest > 1600) {
      context.resize(photo.width >= photo.height ? { width: 1600 } : { height: 1600 });
    }
    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
    progress.body = Platform.OS === 'web'
      ? await (await fetch(result.uri)).blob()
      : new File(result.uri);
    if (!progress.body.size || progress.body.size > 10 * 1024 * 1024) {
      progress.body = undefined;
      throw new Error('Choose a smaller photo. The upload limit is 10 MB.');
    }
  }
  // Confirmation is safe to retry with the same key, even if its earlier response was lost.
  if (!progress.key) {
    const upload = await request<Upload>('/uploads', {
      method: 'POST', body: { contentType: 'image/jpeg', sizeBytes: progress.body.size },
    });
    const response = await expoFetch(upload.uploadUrl, {
      method: 'PUT', headers: upload.headers, body: progress.body,
    });
    if (!response.ok) throw new Error('Photo upload failed. Check your connection and retry.');
    progress.key = upload.key;
  }
  const file = await request<{ id: string }>('/files', { method: 'POST', body: { key: progress.key } });
  progress.fileId = file.id;
  return file.id;
}
