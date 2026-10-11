import * as Location from 'expo-location';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import AppCard from '@/components/app-card';
import { FormButton, FormField } from '@/components/create-quest/form-controls';
import StepHeading from '@/components/create-quest/step-heading';
import { ThemedText } from '@/components/themed-text';
import { parseLocation } from '@/lib/create-quest';
import { currentPoint, formatCoordinate, placeNameFor } from '@/lib/spot-location';

export type LocationDraft = { latitude: string; longitude: string; placeName: string };

export default function LocationStep({ value, onChange, onBusyChange, done, note, children }: {
  value: LocationDraft; onChange: (value: LocationDraft) => void; onBusyChange: (busy: boolean) => void;
  done: boolean;
  // Says where an autofilled location came from, until the reporter looks up the spot themselves.
  note?: string | null;
  // The confirmation, shown at the end of the card.
  children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const operation = useRef(0);
  useEffect(() => () => { operation.current++; }, []);

  const update = (next: LocationDraft) => {
    operation.current++;
    setBusy(false);
    onBusyChange(false);
    setMessage(null);
    onChange(next);
  };

  const locate = async (address: boolean) => {
    const id = ++operation.current;
    setBusy(true);
    onBusyChange(true);
    onChange(value);
    setMessage(null);
    try {
      if (Platform.OS === 'web' && address) {
        throw new Error('Address lookup is available on phones. Use your location or enter coordinates here.');
      }
      if (address) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!permission.granted) {
          throw new Error('Location access was denied. You can enter the spot coordinates instead.');
        }
      }
      const point = address ? (await Location.geocodeAsync(value.placeName.trim()))[0] : await currentPoint();
      if (!point) throw new Error('No matching address found. Add a street and city, or enter coordinates.');
      if (id !== operation.current) return;
      const next = { ...value, latitude: formatCoordinate(point.latitude), longitude: formatCoordinate(point.longitude) };
      if (!address && !next.placeName) {
        const name = await placeNameFor(point);
        if (id !== operation.current) return;
        next.placeName = name;
      }
      if (id !== operation.current) return;
      onChange(next);
      setMessage('Check that these coordinates match the cleanup spot, then confirm below.');
    } catch (error) {
      if (id === operation.current) setMessage(error instanceof Error ? error.message : 'Location unavailable. Try again.');
    } finally {
      if (id === operation.current) { setBusy(false); onBusyChange(false); }
    }
  };

  return (
    <AppCard>
      <StepHeading number={3} title="Pin the spot" done={done} />
      <ThemedText type="small" themeColor="textSecondary">
        Use your current location only when you are at the spot. Volunteers check in within 100 m of this point.
      </ThemedText>
      <FormField label="Place name or address" maxLength={120} value={value.placeName}
        placeholder="Example: Tompkins Square Park, East Village"
        onChangeText={(placeName) => update({ ...value, placeName })} />
      <FormButton label={busy ? 'Finding the spot...' : 'Use my current location'} disabled={busy}
        onPress={() => void locate(false)} />
      {Platform.OS !== 'web' ? <FormButton label="Find this address" disabled={busy || !value.placeName.trim()}
        onPress={() => void locate(true)} /> : null}
      <View style={styles.coordinates}>
        <View style={styles.coordinate}><FormField label="Latitude" value={value.latitude} keyboardType="numbers-and-punctuation"
          placeholder="40.727" onChangeText={(latitude) => update({ ...value, latitude })} /></View>
        <View style={styles.coordinate}><FormField label="Longitude" value={value.longitude} keyboardType="numbers-and-punctuation"
          placeholder="-73.981" onChangeText={(longitude) => update({ ...value, longitude })} /></View>
      </View>
      {!value.latitude.trim() && !value.longitude.trim() ? (
        <ThemedText type="small" themeColor="textSecondary">
          {Platform.OS === 'web' ? 'Use your location or enter the coordinates.' : 'Use your location, find the address or enter the coordinates.'}
        </ThemedText>
      ) : !parseLocation(value.latitude, value.longitude) ? (
        <ThemedText type="small" themeColor="error">Enter a latitude from -90 to 90 and a longitude from -180 to 180.</ThemedText>
      ) : null}
      {message || note ? <ThemedText type="small" accessibilityLiveRegion="polite">{message ?? note}</ThemedText> : null}
      {children}
    </AppCard>
  );
}

const styles = StyleSheet.create({ coordinates: { flexDirection: 'row', gap: 12 }, coordinate: { flex: 1 } });
