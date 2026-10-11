import * as Linking from 'expo-linking';
import { ActionSheetIOS, Platform } from 'react-native';

import { openUrl } from '@/lib/open-url';

export interface Destination {
  name: string;
  latitude: number;
  longitude: number;
  // Lets Google Maps open the exact place instead of a dropped pin.
  googlePlaceId?: string | null;
}

export function googleMapsUrl({ latitude, longitude, googlePlaceId }: Destination): string {
  const placeId = googlePlaceId ? `&destination_place_id=${encodeURIComponent(googlePlaceId)}` : '';
  return `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}${placeId}`;
}

export function appleMapsUrl({ latitude, longitude }: Destination): string {
  return `https://maps.apple.com/?daddr=${latitude},${longitude}`;
}

export function wazeUrl({ latitude, longitude }: Destination): string {
  return `https://waze.com/ul?ll=${latitude},${longitude}&navigate=yes`;
}

// Android hands geo: links to the user's default maps app, or asks which one to use.
function geoUrl({ name, latitude, longitude }: Destination): string {
  // Parentheses would end the label early.
  const label = encodeURIComponent(name.replace(/[()]/g, ''));
  return `geo:0,0?q=${latitude},${longitude}(${label})`;
}

// Opens directions in the user's preferred maps app.
// iOS has no default maps app to ask for, so it offers a choice of the ones that can open.
export async function openDirections(destination: Destination): Promise<void> {
  if (Platform.OS === 'android') {
    await Linking.openURL(geoUrl(destination)).catch(() => Linking.openURL(googleMapsUrl(destination)));
    return;
  }
  if (Platform.OS !== 'ios') {
    await openUrl(googleMapsUrl(destination));
    return;
  }

  // Google's link opens its app when installed and the website otherwise, so it is always offered.
  // Checking for Waze needs LSApplicationQueriesSchemes in app.json, which Expo Go ignores.
  const apps = [
    { label: 'Apple Maps', url: appleMapsUrl(destination) },
    { label: 'Google Maps', url: googleMapsUrl(destination) },
  ];
  if (await Linking.canOpenURL('waze://').catch(() => false)) {
    apps.push({ label: 'Waze', url: wazeUrl(destination) });
  }

  ActionSheetIOS.showActionSheetWithOptions(
    {
      title: `Directions to ${destination.name}`,
      options: [...apps.map((app) => app.label), 'Cancel'],
      cancelButtonIndex: apps.length,
    },
    (index) => {
      const app = apps[index];
      if (app) void Linking.openURL(app.url);
    },
  );
}
