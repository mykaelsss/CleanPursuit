import * as Location from 'expo-location';
import { Platform } from 'react-native';

import type { LocationPoint } from '@/lib/api';

// The phone's location. Throws when permission is denied.
export async function currentPoint(): Promise<LocationPoint> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Location access was denied. You can enter the spot coordinates instead.');
  }
  const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { latitude: coords.latitude, longitude: coords.longitude };
}

// A short readable name for a point, such as "Tompkins Square Park, East Village".
// Empty when the geocoder has nothing or is unavailable, as on web.
export async function placeNameFor(point: LocationPoint): Promise<string> {
  if (Platform.OS === 'web') return '';
  const [place] = await Location.reverseGeocodeAsync(point).catch(() => []);
  if (!place) return '';
  return [place.name ?? place.street, place.district ?? place.city].filter(Boolean).join(', ').slice(0, 120);
}

// Coordinates as the location form shows them.
export function formatCoordinate(value: number) {
  return value.toFixed(6);
}
