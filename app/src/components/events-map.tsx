import { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

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

export function EventsMap({ events, selectedId, onSelect, center, bottomPadding }: EventsMapProps) {
  const map = useRef<MapView>(null);
  const theme = useTheme();

  useEffect(() => {
    if (center) map.current?.animateCamera({ center, zoom: 14 }, { duration: 500 });
  }, [center]);

  // Pan to the selected event, whether it was picked on the map or in the list.
  useEffect(() => {
    const event = events.find((e) => e.id === selectedId);
    if (event) map.current?.animateCamera({ center: event.location }, { duration: 400 });
  }, [selectedId, events]);

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
        <Marker
          key={event.id}
          identifier={event.id}
          coordinate={event.location}
          title={event.title}
          pinColor={event.id === selectedId ? '#F97316' : theme.tint}
          // A tap opens the event card instead of Google's info window.
          onPress={(e) => {
            e.stopPropagation();
            onSelect(event.id);
          }}
        />
      ))}
    </MapView>
  );
}
