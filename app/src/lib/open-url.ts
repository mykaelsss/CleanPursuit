import * as Linking from 'expo-linking';
import { Platform } from 'react-native';

// Opens a link outside the app. On web, websites open in a new tab so the app stays open.
export async function openUrl(url: string): Promise<void> {
  if (Platform.OS === 'web' && /^https?:/.test(url)) {
    window.open(url, '_blank', 'noopener,noreferrer');
    return;
  }
  await Linking.openURL(url);
}
