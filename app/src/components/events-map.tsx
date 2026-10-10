import { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useReducedMotion } from 'react-native-reanimated';

import { DisplayFont, Tiers } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { NearbyEvent } from '@/lib/api';
import { NYC_BOUNDS, NYC_MIN_ZOOM, NYC_REGION } from '@/lib/nyc';

export interface EventsMapProps {
  events: NearbyEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Where to center the map, such as the user's location. Changing it pans the map there.
  center: { latitude: number; longitude: number } | null;
  // Space covered by the bottom sheet, so Google's controls and centering stay visible.
  bottomPadding: number;
}

// Custom marker views are drawn to a bitmap. They must redraw after mounting or changing, then stop,
// or every pin keeps re-rendering and the map stutters.
const PIN_SETTLE_MS = 500;

export function EventsMap({ events, selectedId, onSelect, center, bottomPadding }: EventsMapProps) {
  const map = useRef<MapView>(null);
  // With Reduce Motion on, the camera jumps instead of gliding.
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (center) map.current?.animateCamera({ center, zoom: 14 }, { duration: reduceMotion ? 0 : 500 });
  }, [center, reduceMotion]);

  // Pan to the selected quest, whether it was picked on the map or in the list.
  useEffect(() => {
    const event = events.find((e) => e.id === selectedId);
    if (event) map.current?.animateCamera({ center: event.location }, { duration: reduceMotion ? 0 : 400 });
  }, [selectedId, events, reduceMotion]);

  return (
    <MapView
      ref={map}
      provider={PROVIDER_GOOGLE}
      style={StyleSheet.absoluteFill}
      initialRegion={NYC_REGION}
      minZoomLevel={NYC_MIN_ZOOM}
      // Keep the camera inside the five boroughs.
      onMapReady={() => map.current?.setMapBoundaries(NYC_BOUNDS.northEast, NYC_BOUNDS.southWest)}
      showsUserLocation
      showsMyLocationButton
      toolbarEnabled={false}
      mapPadding={{ top: 0, right: 0, bottom: bottomPadding, left: 0 }}>
      {events.map((event) => (
        <XpPin key={event.id} event={event} selected={event.id === selectedId} onSelect={onSelect} />
      ))}
    </MapView>
  );
}

// A bubble with the quest's XP in its difficulty color. The selected pin turns ink with gold text and
// grows, so it stands out by size and shape as well as color.
const XpPin = memo(function XpPin({
  event,
  selected,
  onSelect,
}: {
  event: NearbyEvent;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const theme = useTheme();
  const tier = Tiers[event.difficultyTier];
  const background = selected ? theme.ink : tier.fill;
  const color = selected ? theme.xp : tier.onFill;

  // The selection the bitmap was last drawn for. Until it catches up, the marker keeps redrawing.
  const [drawnFor, setDrawnFor] = useState<boolean | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setDrawnFor(selected), PIN_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [selected]);

  return (
    <Marker
      identifier={event.id}
      coordinate={event.location}
      title={event.title}
      anchor={{ x: 0.5, y: 1 }}
      tracksViewChanges={drawnFor !== selected}
      // Keep the selected pin on top of any pins that overlap it.
      zIndex={selected ? 1 : 0}
      // A tap opens the quest card instead of Google's info window.
      onPress={(e) => {
        e.stopPropagation();
        onSelect(event.id);
      }}>
      <View style={styles.pin}>
        <View style={[styles.bubble, selected && styles.bubbleSelected, { backgroundColor: background }]}>
          <Text style={[styles.text, selected && styles.textSelected, { color }]} allowFontScaling={false}>
            {event.maxXp.toLocaleString()} XP
          </Text>
        </View>
        <View style={[styles.pointer, { borderTopColor: background }]} />
      </View>
    </Marker>
  );
});

const styles = StyleSheet.create({
  pin: {
    alignItems: 'center',
  },
  bubble: {
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  bubbleSelected: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 16,
    borderWidth: 3,
  },
  text: {
    fontFamily: DisplayFont,
    fontWeight: 'normal',
    fontSize: 14,
    lineHeight: 18,
  },
  textSelected: {
    fontSize: 18,
    lineHeight: 22,
  },
  pointer: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderTopWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
