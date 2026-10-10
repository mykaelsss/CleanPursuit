import * as Location from 'expo-location';

import type { DifficultyTier } from '@/lib/api';

// "Sat, Oct 11 · 10:00 AM - 12:00 PM", with both dates when the event runs past midnight.
export function formatEventTime(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const time = (d: Date) => d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const endText = day(start) === day(end) ? time(end) : `${day(end)} ${time(end)}`;
  return `${day(start)} · ${time(start)} - ${endText}`;
}

export function formatDuration(startIso: string, endIso: string): string {
  const minutes = Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60_000);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} hr` : `${hours} hr ${rest} min`;
}

export function formatDistance(meters: number): string {
  const miles = meters / 1609.34;
  return miles < 0.1 ? `${Math.round(meters * 3.281)} ft` : `${miles.toFixed(1)} mi`;
}

export const TIER_LABELS: Record<DifficultyTier, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  legendary: 'Legendary',
};

const addresses = new Map<string, Promise<string>>();

// A street address from the phone's geocoder, cached per point. Falls back to coordinates.
export function lookupAddress(location: { latitude: number; longitude: number }): Promise<string> {
  const key = `${location.latitude.toFixed(5)},${location.longitude.toFixed(5)}`;
  let address = addresses.get(key);
  if (!address) {
    address = Location.reverseGeocodeAsync(location)
      .then(([place]) => {
        if (!place) return key;
        const street = [place.streetNumber, place.street].filter(Boolean).join(' ');
        const area = place.district ?? place.subregion ?? place.city;
        return [street || place.name, area].filter(Boolean).join(', ') || key;
      })
      .catch(() => {
        addresses.delete(key);
        return key;
      });
    addresses.set(key, address);
  }
  return address;
}
