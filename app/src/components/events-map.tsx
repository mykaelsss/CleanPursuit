import { useEffect, useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import type { NearbyEvent } from '@/lib/api';
import { LEAFLET_MAP_HTML, MAP_PAGE_URL, type MapCommand, parseMapEvent, useMapUpdate } from '@/lib/leaflet-map-html';

export interface EventsMapProps {
  events: NearbyEvent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  // Where to center the map, such as the user's location. Changing it pans the map there.
  center: { latitude: number; longitude: number } | null;
  // The user's location, shown as a blue dot, or null when unknown or outside NYC.
  userLocation: { latitude: number; longitude: number } | null;
  // Space covered by the bottom sheet, so centering and the location button stay visible.
  bottomPadding: number;
}

// The Leaflet map page (see leaflet-map-html.ts) in a WebView.
export function EventsMap({ events, selectedId, onSelect, center, userLocation, bottomPadding }: EventsMapProps) {
  const webView = useRef<WebView>(null);
  const ready = useRef(false);
  const latest = useRef<{ update: MapCommand | null; center: EventsMapProps['center'] }>({ update: null, center: null });
  const [loadError, setLoadError] = useState<string | null>(null);
  // With Reduce Motion on, the map jumps instead of gliding.
  const reduceMotion = useReducedMotion();
  const scheme = useColorScheme();
  const theme = useTheme();

  const update = useMapUpdate({
    events,
    selectedId,
    user: userLocation,
    bottomPadding,
    reduceMotion,
    dark: scheme === 'dark',
    // The selected pin turns forest green with gold text, like the quest card's reward panel.
    selectedFill: theme.ink,
    selectedText: theme.reward,
  });

  function send(command: MapCommand) {
    webView.current?.injectJavaScript(`window.cpReceive && window.cpReceive(${JSON.stringify(command)}); true;`);
  }

  useEffect(() => {
    latest.current.update = update;
    if (ready.current) send(update);
  }, [update]);

  useEffect(() => {
    latest.current.center = center;
    if (ready.current && center) send({ type: 'center', ...center });
  }, [center]);

  function onMessage(e: WebViewMessageEvent) {
    const event = parseMapEvent(e.nativeEvent.data);
    if (event?.type === 'ready') {
      ready.current = true;
      setLoadError(null);
      if (latest.current.update) send(latest.current.update);
      if (latest.current.center) send({ type: 'center', ...latest.current.center });
    } else if (event?.type === 'select') {
      onSelect(event.id);
    } else if (event?.type === 'error') {
      setLoadError(event.message);
    }
  }

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.background }]}>
      <WebView
        ref={webView}
        source={{ html: LEAFLET_MAP_HTML, baseUrl: MAP_PAGE_URL }}
        originWhitelist={['*']}
        onMessage={onMessage}
        // Links in the map credits open in the browser instead of replacing the map.
        onShouldStartLoadWithRequest={(request) => {
          const { url } = request;
          if (url === MAP_PAGE_URL || url.startsWith('about:') || url.startsWith('data:')) return true;
          Linking.openURL(url);
          return false;
        }}
        onError={() => setLoadError('The map could not load. Check your connection.')}
        // Reloading the page resets it, so it must say it is ready again before taking commands.
        onLoadStart={() => {
          ready.current = false;
        }}
        style={styles.webView}
        bounces={false}
        scrollEnabled={false}
        overScrollMode="never"
        setBuiltInZoomControls={false}
        setSupportMultipleWindows={false}
        accessibilityLabel="Map of cleanup events"
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
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  error: {
    position: 'absolute',
    top: Spacing.six,
    left: Spacing.four,
    right: Spacing.four,
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
});
