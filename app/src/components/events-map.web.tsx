import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';

import type { EventsMapProps } from '@/components/events-map';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { LEAFLET_MAP_HTML, type MapCommand, parseMapEvent, useMapUpdate } from '@/lib/leaflet-map-html';

// The Leaflet map page (see leaflet-map-html.ts) in an iframe, talking over postMessage.
export function EventsMap({
  events,
  quests,
  hotspots,
  selected,
  onSelect,
  center,
  userLocation,
  bottomPadding,
}: EventsMapProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const latest = useRef<{ update: MapCommand | null; center: EventsMapProps['center'] }>({ update: null, center: null });
  const [loadError, setLoadError] = useState<string | null>(null);
  const reduceMotion = useReducedMotion();
  const scheme = useColorScheme();
  const theme = useTheme();

  const update = useMapUpdate({
    events,
    quests,
    hotspots,
    selected,
    user: userLocation,
    bottomPadding,
    reduceMotion,
    dark: scheme === 'dark',
    selectedFill: theme.ink,
    selectedText: theme.reward,
  });

  function send(command: MapCommand) {
    frame.current?.contentWindow?.postMessage(JSON.stringify(command), '*');
  }

  useEffect(() => {
    latest.current.update = update;
    if (ready.current) send(update);
  }, [update]);

  useEffect(() => {
    latest.current.center = center;
    if (ready.current && center) send({ type: 'center', ...center });
  }, [center]);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Only listen to our own map frame.
      if (!frame.current || e.source !== frame.current.contentWindow) return;
      const event = parseMapEvent(e.data);
      if (event?.type === 'ready') {
        ready.current = true;
        setLoadError(null);
        if (latest.current.update) send(latest.current.update);
        if (latest.current.center) send({ type: 'center', ...latest.current.center });
      } else if (event?.type === 'select') {
        onSelect(event.kind, event.id);
      } else if (event?.type === 'error') {
        setLoadError(event.message);
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onSelect]);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]}>
      <iframe
        ref={frame}
        srcDoc={LEAFLET_MAP_HTML}
        title="Map of quests, cleanup parties and hotspots"
        style={{ border: 0, width: '100%', height: '100%' }}
      />
      {loadError && (
        <View style={[styles.error, { backgroundColor: theme.backgroundElement }]} accessibilityRole="alert">
          <ThemedText type="small" themeColor="error">
            {loadError}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  error: {
    position: 'absolute',
    top: Spacing.six,
    left: Spacing.four,
    right: Spacing.four,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
});
