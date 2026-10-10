import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';

import { EventCard, SitePhoto } from '@/components/event-card';
import { EventsMap } from '@/components/events-map';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, type EventDetail, type NearbyEvent } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDistance, formatEventTime } from '@/lib/event-format';
import { isInNyc, NYC_REGION } from '@/lib/nyc';
import { isSampleEvent, sampleEvents, setSampleAttendance, type SampleEvent } from '@/lib/sample-events';

type Point = { latitude: number; longitude: number };

// Near the user, or the whole city when we don't know where they are.
const NEARBY_RADIUS_M = 10_000;
const CITY_RADIUS_M = 40_000;

// The list sheet peeks at the bottom like Google Maps' explore sheet, and drags up to half or full height.
const LIST_SNAP_POINTS = ['25%', '50%', '88%'];
const CARD_SNAP_POINTS = ['70%', '92%'];

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Can't reach CleanPursuit. Check your connection.";
}

export default function EventsScreen() {
  const { authedRequest, user } = useAuth();
  const theme = useTheme();
  const { height } = useWindowDimensions();
  const cardSheet = useRef<BottomSheet>(null);

  // Where to search: the user if they are in NYC, otherwise the whole city.
  const [search, setSearch] = useState<{ center: Point; radiusM: number } | null>(null);
  const [mapCenter, setMapCenter] = useState<Point | null>(null);
  const [events, setEvents] = useState<NearbyEvent[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // Development only: placeholder events shown while the API has none, so the layout can be seen.
  const [samples, setSamples] = useState<SampleEvent[] | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The latest selection, for checking whether a response is still wanted after an await.
  const selectedRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  // Find the user once. Outside NYC, or without permission, show the whole city.
  useEffect(() => {
    (async () => {
      const city = { center: { latitude: NYC_REGION.latitude, longitude: NYC_REGION.longitude }, radiusM: CITY_RADIUS_M };
      try {
        const { granted } = await Location.requestForegroundPermissionsAsync();
        if (!granted) return setSearch(city);
        const { coords } = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const here = { latitude: coords.latitude, longitude: coords.longitude };
        if (!isInNyc(here)) return setSearch(city);
        setSearch({ center: here, radiusM: NEARBY_RADIUS_M });
        setMapCenter(here);
      } catch {
        setSearch(city);
      }
    })();
  }, []);

  const loadEvents = useCallback(async () => {
    if (!search) return;
    const { center, radiusM } = search;
    try {
      const { events } = await authedRequest<{ events: NearbyEvent[] }>(
        `/events?latitude=${center.latitude}&longitude=${center.longitude}&radiusM=${radiusM}`,
      );
      setEvents(events);
      setListError(null);
      setSamples((current) => (__DEV__ && events.length === 0 && user ? (current ?? sampleEvents(center, user)) : null));
    } catch (err) {
      setListError(errorMessage(err));
      if (__DEV__ && user) setSamples((current) => current ?? sampleEvents(center, user));
    }
  }, [authedRequest, search, user]);

  const shown: NearbyEvent[] | null = samples ?? events;

  // Reload when the tab is opened, so new events and attendee counts show up.
  useFocusEffect(
    useCallback(() => {
      loadEvents();
    }, [loadEvents]),
  );

  const select = useCallback(
    async (id: string) => {
      selectedRef.current = id;
      setSelectedId(id);
      setDetail(null);
      setCardError(null);
      cardSheet.current?.snapToIndex(0);
      if (isSampleEvent(id)) {
        setDetail(samples?.find((e) => e.id === id) ?? null);
        return;
      }
      try {
        const loaded = await authedRequest<EventDetail>(`/events/${id}`);
        // Ignore a slow response for an event the user has already moved away from.
        if (selectedRef.current === id) setDetail(loaded);
      } catch (err) {
        if (selectedRef.current === id) setCardError(errorMessage(err));
      }
    },
    [authedRequest, samples],
  );

  // Swiping the card down, or tapping the dimmed map, goes back to the list.
  const deselect = useCallback(() => {
    selectedRef.current = null;
    setSelectedId(null);
    setDetail(null);
    setCardError(null);
  }, []);

  async function changeAttendance(method: 'POST' | 'DELETE') {
    if (!selectedId) return;
    if (isSampleEvent(selectedId)) {
      const sample = samples?.find((e) => e.id === selectedId);
      if (!sample || !user) return;
      const updated = setSampleAttendance(sample, user, method === 'POST');
      setSamples((list) => list?.map((e) => (e.id === updated.id ? updated : e)) ?? null);
      setDetail(updated);
      return;
    }
    setBusy(true);
    setCardError(null);
    try {
      const updated = await authedRequest<EventDetail>(`/events/${selectedId}/join`, { method });
      setDetail(updated);
      setEvents((list) =>
        list?.map((e) =>
          e.id === updated.id ? { ...e, joined: updated.joined, attendeeCount: updated.attendeeCount } : e,
        ) ?? null,
      );
    } catch (err) {
      setCardError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const selected = detail ?? shown?.find((e) => e.id === selectedId) ?? null;

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.5} pressBehavior="close" />
    ),
    [],
  );

  const sheetStyle = {
    backgroundStyle: { backgroundColor: theme.background },
    handleIndicatorStyle: { backgroundColor: theme.textSecondary },
    bottomInset: BottomTabInset,
    enableDynamicSizing: false,
  };

  return (
    <ThemedView style={styles.container}>
      <EventsMap
        events={shown ?? []}
        selectedId={selectedId}
        onSelect={select}
        center={mapCenter}
        bottomPadding={height * 0.25}
      />

      <BottomSheet {...sheetStyle} snapPoints={LIST_SNAP_POINTS} index={0}>
        <BottomSheetFlatList
          data={shown ?? []}
          keyExtractor={(event: NearbyEvent) => event.id}
          renderItem={({ item }: { item: NearbyEvent }) => <EventRow event={item} onPress={() => select(item.id)} />}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <ThemedText style={styles.listTitle}>Cleanups near you</ThemedText>
              {shown && shown.length > 0 && (
                <ThemedText type="small" themeColor="textSecondary">
                  {shown.length} upcoming {shown.length === 1 ? 'event' : 'events'}
                </ThemedText>
              )}
              {samples && (
                <ThemedView type="backgroundElement" style={styles.sampleBanner}>
                  <ThemedText type="smallBold">Sample events</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    Placeholders for the layout, shown in development until real events exist.
                    {listError ? ` (${listError})` : ''}
                  </ThemedText>
                </ThemedView>
              )}
            </View>
          }
          ListEmptyComponent={
            listError ? (
              <View style={styles.status}>
                <ThemedText themeColor="error" style={styles.centered}>
                  {listError}
                </ThemedText>
                <Pressable onPress={loadEvents} accessibilityRole="button">
                  <ThemedText type="smallBold" style={{ color: theme.tint }}>
                    Try again
                  </ThemedText>
                </Pressable>
              </View>
            ) : events ? (
              <ThemedText themeColor="textSecondary" style={[styles.status, styles.centered]}>
                No cleanups are scheduled nearby yet.
              </ThemedText>
            ) : (
              <ActivityIndicator style={styles.status} color={theme.textSecondary} />
            )
          }
        />
      </BottomSheet>

      <BottomSheet
        {...sheetStyle}
        ref={cardSheet}
        snapPoints={CARD_SNAP_POINTS}
        index={-1}
        enablePanDownToClose
        onClose={deselect}
        backdropComponent={renderBackdrop}>
        <BottomSheetScrollView contentContainerStyle={styles.card}>
          {selected ? (
            <EventCard
              event={selected}
              detail={detail}
              busy={busy}
              error={cardError}
              onJoin={() => changeAttendance('POST')}
              onLeave={() => changeAttendance('DELETE')}
            />
          ) : (
            cardError && <ThemedText themeColor="error">{cardError}</ThemedText>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    </ThemedView>
  );
}

function EventRow({ event, onPress }: { event: NearbyEvent; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <SitePhoto photo={event.photo} style={styles.thumbnail} />
      <View style={styles.rowText}>
        <ThemedText style={styles.rowTitle} numberOfLines={1}>
          {event.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {formatEventTime(event.scheduledStart, event.scheduledEnd)}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
          {formatDistance(event.distanceM)} · Up to {event.maxXp.toLocaleString()} XP · {event.attendeeCount} going
        </ThemedText>
        {event.joined && (
          <ThemedText type="smallBold" style={{ color: theme.tint }}>
            {event.isOrganizer ? 'Organizing' : "You're going"}
          </ThemedText>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  list: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.four,
  },
  listHeader: {
    paddingBottom: Spacing.three,
  },
  sampleBanner: {
    marginTop: Spacing.two,
    padding: Spacing.two + Spacing.one,
    borderRadius: Spacing.two + Spacing.one,
    gap: Spacing.half,
  },
  listTitle: {
    fontSize: 20,
    lineHeight: 26,
    fontWeight: 700,
  },
  status: {
    marginTop: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  centered: {
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
  },
  thumbnail: {
    width: 72,
    height: 72,
    borderRadius: Spacing.two + Spacing.one,
  },
  rowText: {
    flex: 1,
    justifyContent: 'center',
    gap: Spacing.half,
  },
  rowTitle: {
    fontWeight: 700,
  },
  pressed: {
    opacity: 0.7,
  },
  card: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
  },
});
