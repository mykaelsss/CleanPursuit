import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFlatList,
  BottomSheetScrollView,
  useBottomSheet,
  type BottomSheetBackdropProps,
  type BottomSheetHandleProps,
} from '@gorhom/bottom-sheet';
import * as Location from 'expo-location';
import { useFocusEffect } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type LayoutChangeEvent,
  type Text,
} from 'react-native';
import { ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EventCard, MIN_TOUCH, SitePhoto } from '@/components/event-card';
import { displayStyles, squish, TierBadge, XpBadge, xpText } from '@/components/quest-ui';
import { EventsMap } from '@/components/events-map';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useAnnounce } from '@/hooks/use-announce';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, type EventDetail, type NearbyEvent } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { describeDistance, describeEventTime, formatDistance, formatEventTime, TIER_LABELS } from '@/lib/event-format';
import { isInNyc, NYC_REGION } from '@/lib/nyc';
import { isSampleEvent, sampleEvents, setSampleAttendance, type SampleEvent } from '@/lib/sample-events';

type Point = { latitude: number; longitude: number };

// Near the user, or the whole city when we don't know where they are.
const NEARBY_RADIUS_M = 10_000;
const CITY_RADIUS_M = 40_000;

// The list sheet peeks at the bottom like Google Maps' explore sheet, and drags up to half or full height.
// Screen reader users resize it by swiping up or down on its handle, which reads out these names.
const LIST_SNAP_POINTS = ['25%', '50%', '88%'];
const LIST_SIZE_NAMES = ['Collapsed', 'Half screen', 'Full screen'];
// How much of the map each list size covers, so Google's controls and centering stay visible.
// At full screen the map is mostly hidden, so it keeps the half screen padding.
const LIST_COVER = [0.25, 0.5, 0.5];
const CARD_SNAP_POINTS = ['70%', '92%'];

function errorMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : "Can't reach CleanPursuit. Check your connection.";
}

// Moves screen reader focus to a heading. React Native Web has no sendAccessibilityEvent, so on web the
// heading's DOM node is made focusable by script only (not a tab stop) and focused directly.
function focus(ref: RefObject<Text | null>) {
  const node = ref.current;
  if (!node) return;
  if (Platform.OS === 'web') {
    const element = node as unknown as HTMLElement;
    element.setAttribute('tabindex', '-1');
    element.focus({ preventScroll: true });
  } else {
    AccessibilityInfo.sendAccessibilityEvent(node, 'focus');
  }
}

export default function EventsScreen() {
  const { authedRequest, user } = useAuth();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const cardSheet = useRef<BottomSheet>(null);
  const listTitle = useRef<Text>(null);
  const cardTitle = useRef<Text>(null);

  // Where to search: the user if they are in NYC, otherwise the whole city.
  const [search, setSearch] = useState<{ center: Point; radiusM: number } | null>(null);
  const [mapCenter, setMapCenter] = useState<Point | null>(null);
  const [events, setEvents] = useState<NearbyEvent[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  // Development only: placeholder events shown while the API has none, so the layout can be seen.
  const [samples, setSamples] = useState<SampleEvent[] | null>(null);
  const [listIndex, setListIndex] = useState(0);
  const [listPlaced, setListPlaced] = useState(false);
  const [screenHeight, setScreenHeight] = useState(windowHeight);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The latest selection, for checking whether a response is still wanted after an await.
  const selectedRef = useRef<string | null>(null);
  const cardOpen = useRef(false);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  useAnnounce(listError);
  useAnnounce(cardError);

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

  // Move screen reader focus with the selection, once the list is shown or hidden again: to the new title
  // when another pin is picked while the card is open, and back to the list when the card closes.
  const hadSelection = useRef(false);
  useEffect(() => {
    if (selectedId) {
      if (cardOpen.current) focus(cardTitle);
    } else if (hadSelection.current) {
      focus(listTitle);
    }
    hadSelection.current = selectedId !== null;
  }, [selectedId]);

  const closeCard = useCallback(() => cardSheet.current?.close(), []);

  // Swiping the card down, tapping the dimmed map, or pressing Close goes back to the list.
  const deselect = useCallback(() => {
    selectedRef.current = null;
    setSelectedId(null);
    setDetail(null);
    setCardError(null);
  }, []);

  const onCardChange = useCallback((index: number) => {
    const wasOpen = cardOpen.current;
    cardOpen.current = index >= 0;
    if (!wasOpen && cardOpen.current) focus(cardTitle);
  }, []);

  // Android's back button closes the card before leaving the screen.
  useFocusEffect(
    useCallback(() => {
      if (!selectedId) return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        closeCard();
        return true;
      });
      return () => subscription.remove();
    }, [selectedId, closeCard]),
  );

  async function changeAttendance(method: 'POST' | 'DELETE') {
    if (!selectedId) return;
    const joining = method === 'POST';
    if (isSampleEvent(selectedId)) {
      const sample = samples?.find((e) => e.id === selectedId);
      if (!sample || !user) return;
      const updated = setSampleAttendance(sample, user, joining);
      setSamples((list) => list?.map((e) => (e.id === updated.id ? updated : e)) ?? null);
      setDetail(updated);
      AccessibilityInfo.announceForAccessibility(joining ? 'You joined the party' : 'You left the party');
      return;
    }
    setBusy(true);
    setCardError(null);
    try {
      const updated = await authedRequest<EventDetail>(`/events/${selectedId}/join`, { method });
      setDetail(updated);
      setEvents(
        (list) =>
          list?.map((e) =>
            e.id === updated.id ? { ...e, joined: updated.joined, attendeeCount: updated.attendeeCount } : e,
          ) ?? null,
      );
      AccessibilityInfo.announceForAccessibility(joining ? 'You joined the party' : 'You left the party');
    } catch (err) {
      setCardError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const selected = detail ?? shown?.find((e) => e.id === selectedId) ?? null;

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.5}
        pressBehavior="close"
        // The card has its own Close button, so screen readers skip the backdrop.
        accessible={false}
      />
    ),
    [],
  );

  const renderListHandle = useCallback(
    (props: BottomSheetHandleProps) => <ListHandle {...props} index={listIndex} />,
    [listIndex],
  );

  const renderItem = useCallback(
    ({ item }: { item: NearbyEvent }) => <EventRow event={item} onSelect={select} />,
    [select],
  );

  const sheetProps = useMemo(
    () => ({
      backgroundStyle: { backgroundColor: theme.background },
      bottomInset: BottomTabInset,
      topInset: insets.top,
      enableDynamicSizing: false,
      // The library makes the whole sheet one accessible element by default, which hides its
      // rows and buttons from VoiceOver. Leave the sheet itself out so its contents are reachable.
      accessible: false,
      accessibilityRole: null,
      accessibilityLabel: null,
    }),
    [theme.background, insets.top],
  );

  const onListChange = useCallback((index: number) => {
    setListIndex(Math.max(0, index));
    if (index >= 0) setListPlaced(true);
  }, []);
  const onLayout = useCallback((e: LayoutChangeEvent) => setScreenHeight(e.nativeEvent.layout.height), []);
  const isCardOpen = selectedId !== null;

  return (
    <ThemedView style={styles.container} onLayout={onLayout}>
      {/* While the card is open, screen readers stay inside it instead of wandering onto the map and list. */}
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
        accessibilityElementsHidden={isCardOpen}
        importantForAccessibility={isCardOpen ? 'no-hide-descendants' : 'auto'}>
        <EventsMap
          events={shown ?? []}
          selectedId={selectedId}
          onSelect={select}
          center={mapCenter}
          bottomPadding={screenHeight * LIST_COVER[listIndex] + BottomTabInset}
        />

        <BottomSheet
          {...sheetProps}
          snapPoints={LIST_SNAP_POINTS}
          index={0}
          // The list is part of the screen, so its first placement is instant instead of sliding up from the
          // bottom. Later moves animate as usual, following the system's Reduce Motion setting.
          overrideReduceMotion={listPlaced ? ReduceMotion.System : ReduceMotion.Always}
          onChange={onListChange}
          handleComponent={renderListHandle}>
          <BottomSheetFlatList
            data={shown ?? []}
            keyExtractor={(event: NearbyEvent) => event.id}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.listHeader}>
                <ThemedText
                  ref={listTitle}
                  accessibilityRole="header"
                  themeColor="ink"
                  style={[displayStyles.base, styles.listTitle]}>
                  Quests near you
                </ThemedText>
                {shown && shown.length > 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {shown.length} {shown.length === 1 ? 'quest' : 'quests'} to join
                  </ThemedText>
                ) : null}
                {samples ? (
                  <View style={[styles.sampleBanner, { backgroundColor: theme.surface }]} accessible>
                    <ThemedText type="smallBold">Sample quests</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      Placeholders for the layout, shown in development until real quests exist.
                      {listError ? ` (${listError})` : ''}
                    </ThemedText>
                  </View>
                ) : null}
              </View>
            }
            ListEmptyComponent={
              listError ? (
                <View style={styles.status}>
                  <ThemedText themeColor="error" style={styles.centered}>
                    {listError}
                  </ThemedText>
                  <Pressable
                    onPress={loadEvents}
                    accessibilityRole="button"
                    style={squish(styles.retry)}>
                    <ThemedText type="smallBold" themeColor="tint">
                      Try again
                    </ThemedText>
                  </Pressable>
                </View>
              ) : events ? (
                <ThemedText themeColor="textSecondary" style={[styles.status, styles.centered]}>
                  No quests nearby yet.
                </ThemedText>
              ) : (
                <ActivityIndicator style={styles.status} color={theme.textSecondary} accessibilityLabel="Loading quests" />
              )
            }
          />
        </BottomSheet>
      </View>

      <BottomSheet
        {...sheetProps}
        ref={cardSheet}
        snapPoints={CARD_SNAP_POINTS}
        index={-1}
        enablePanDownToClose
        onChange={onCardChange}
        onClose={deselect}
        handleComponent={CardHandle}
        backdropComponent={renderBackdrop}>
        <BottomSheetScrollView contentContainerStyle={styles.card} accessibilityViewIsModal={isCardOpen}>
          {selected ? (
            <EventCard
              event={selected}
              detail={detail}
              busy={busy}
              error={cardError}
              onJoin={() => changeAttendance('POST')}
              onLeave={() => changeAttendance('DELETE')}
              onClose={closeCard}
              titleRef={cardTitle}
            />
          ) : cardError ? (
            <ThemedText themeColor="error">{cardError}</ThemedText>
          ) : null}
        </BottomSheetScrollView>
      </BottomSheet>
    </ThemedView>
  );
}

// The list sheet's drag handle. Screen readers announce it as adjustable, so swiping up or down on it
// resizes the list, which a drag gesture can't do with VoiceOver or TalkBack on.
function ListHandle({ index }: BottomSheetHandleProps & { index: number }) {
  const theme = useTheme();
  const { snapToIndex } = useBottomSheet();
  return (
    <View
      style={styles.handle}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Quest list size"
      accessibilityValue={{ text: LIST_SIZE_NAMES[index] }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={({ nativeEvent }) => {
        const next = index + (nativeEvent.actionName === 'increment' ? 1 : -1);
        if (next >= 0 && next < LIST_SNAP_POINTS.length) snapToIndex(next);
      }}>
      <View style={[styles.handleBar, { backgroundColor: theme.textSecondary }]} />
    </View>
  );
}

// The card's drag handle is only a visual cue; screen readers use the card's Close button instead.
function CardHandle(_props: BottomSheetHandleProps) {
  const theme = useTheme();
  return (
    <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.handleBar, { backgroundColor: theme.textSecondary }]} />
    </View>
  );
}

const EventRow = memo(function EventRow({
  event,
  onSelect,
}: {
  event: NearbyEvent;
  onSelect: (id: string) => void;
}) {
  const party = `Party of ${event.attendeeCount}`;
  const status = event.joined ? (event.isOrganizer ? "You're the leader" : "You're in the party") : null;
  // One sentence for screen readers, with full dates and units instead of the visual shorthand.
  const label = [
    event.title,
    `${TIER_LABELS[event.difficultyTier]} difficulty`,
    xpText(event.maxXp),
    describeEventTime(event.scheduledStart, event.scheduledEnd),
    describeDistance(event.distanceM),
    party,
    status,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable
      onPress={() => onSelect(event.id)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the quest details"
      style={squish(styles.row)}>
      <SitePhoto photo={event.photo} tier={event.difficultyTier} style={styles.thumbnail} />
      <View style={styles.rowText}>
        <ThemedText themeColor="ink" style={[displayStyles.base, styles.rowTitle]} numberOfLines={2}>
          {event.title}
        </ThemedText>
        <View style={styles.rowBadges}>
          <TierBadge tier={event.difficultyTier} />
          <XpBadge maxXp={event.maxXp} />
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {formatEventTime(event.scheduledStart, event.scheduledEnd)}
        </ThemedText>
        <View style={styles.meta}>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDistance(event.distanceM)}
          </ThemedText>
          <ThemedText type="smallBold" themeColor="ink">
            {party}
          </ThemedText>
        </View>
        {status ? (
          <ThemedText type="smallBold" themeColor="tint">
            {status}
          </ThemedText>
        ) : null}
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  handle: {
    alignItems: 'center',
    paddingVertical: Spacing.two + Spacing.one,
  },
  handleBar: {
    width: 44,
    height: 6,
    borderRadius: 3,
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
    fontSize: 26,
    lineHeight: 32,
  },
  status: {
    marginTop: Spacing.four,
    alignItems: 'center',
    gap: Spacing.two,
  },
  centered: {
    textAlign: 'center',
  },
  retry: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  thumbnail: {
    width: 84,
    height: 84,
    borderRadius: 18,
  },
  rowText: {
    flex: 1,
    gap: Spacing.one + Spacing.half,
  },
  rowTitle: {
    fontSize: 19,
    lineHeight: 24,
  },
  rowBadges: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one + Spacing.half,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: Spacing.three,
  },
  card: {
    paddingHorizontal: Spacing.four,
    paddingBottom: Spacing.five,
  },
});
