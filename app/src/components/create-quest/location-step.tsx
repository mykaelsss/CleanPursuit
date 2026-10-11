import * as Location from 'expo-location';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import AppCard from '@/components/app-card';
import { FormButton, FormField } from '@/components/create-quest/form-controls';
import StepHeading from '@/components/create-quest/step-heading';
import { ThemedText } from '@/components/themed-text';
import { parseLocation } from '@/lib/create-quest';

export type LocationDraft = { latitude: string; longitude: string; placeName: string };

export default function LocationStep({ value, onChange, onBusyChange }: {
  value: LocationDraft; onChange: (value: LocationDraft) => void; onBusyChange: (busy: boolean) => void;
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
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Location access was denied. You can enter the spot coordinates instead.');
      }
      const point = address
        ? (await Location.geocodeAsync(value.placeName.trim()))[0]
        : (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })).coords;
      if (!point) throw new Error('No matching address found. Add a street and city, or enter coordinates.');
      if (id !== operation.current) return;
      const next = { ...value, latitude: point.latitude.toFixed(6), longitude: point.longitude.toFixed(6) };
      if (!address && Platform.OS !== 'web') {
        const result = await Location.reverseGeocodeAsync(point).catch(() => []);
        if (id !== operation.current) return;
        const place = result[0];
        const name = place ? [place.name ?? place.street, place.district ?? place.city]
          .filter(Boolean).join(', ').slice(0, 120) : '';
        next.placeName ||= name;
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
      <StepHeading number={3} title="PIN THE SPOT" />
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
      {!parseLocation(value.latitude, value.longitude) ? (
        <ThemedText type="small" themeColor="textSecondary">Enter valid latitude (-90 to 90) and longitude (-180 to 180).</ThemedText>
      ) : null}
      {message ? <ThemedText type="small" accessibilityLiveRegion="polite">{message}</ThemedText> : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({ coordinates: { flexDirection: 'row', gap: 12 }, coordinate: { flex: 1 } });
