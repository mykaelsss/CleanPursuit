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

import AppHeader, { COMPACT_HEADER_HEIGHT } from '@/components/app-header';
import { EventCard, SitePhoto } from '@/components/event-card';
import { displayStyles, LiveBadge, onSiteText, squish, TierBadge, XpBadge, xpText } from '@/components/quest-ui';
import { EventsMap } from '@/components/events-map';
import { HotspotBadge, QuestCard } from '@/components/quest-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import type { WalkUpChange } from '@/components/walk-up-panel';
import { BottomTabInset, MIN_TOUCH, Spacing } from '@/constants/theme';
import { useAnnounce } from '@/hooks/use-announce';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, type EventDetail, type HotspotArea, type NearbyEvent, type NearbyQuest, type Quest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { describeDistance, describeEventTime, formatDistance, formatEventTime, TIER_LABELS } from '@/lib/event-format';
import type { MapSelection, PinKind } from '@/lib/leaflet-map-html';
import { isInNyc, NYC_REGION } from '@/lib/nyc';

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
// The most areas /hotspots returns.
const HOTSPOT_LIMIT = 250;

// The list shows scheduled parties first, then open quests that still need one.
type ListRow =
  | { kind: 'event'; item: NearbyEvent }
  | { kind: 'questsHeading' }
  | { kind: 'quest'; item: NearbyQuest };

function rowKey(row: ListRow): string {
  return row.kind === 'questsHeading' ? row.kind : `${row.kind}:${row.item.id}`;
}

function countText(parties: number, quests: number): string {
  const part = (n: number, one: string, many: string) => (n === 0 ? null : `${n} ${n === 1 ? one : many}`);
  return [part(parties, 'party', 'parties'), part(quests, 'open quest', 'open quests')].filter(Boolean).join(' and ');
}

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
  const { authedRequest } = useAuth();
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
  const [quests, setQuests] = useState<NearbyQuest[] | null>(null);
  const [hotspots, setHotspots] = useState<HotspotArea[]>([]);
  const [listError, setListError] = useState<string | null>(null);
  const [listIndex, setListIndex] = useState(0);
  const [listPlaced, setListPlaced] = useState(false);
  const [screenHeight, setScreenHeight] = useState(windowHeight);

  const [selected, setSelected] = useState<MapSelection | null>(null);
  // The latest selection, for checking whether a response is still wanted after an await.
  const selectedRef = useRef<MapSelection | null>(null);
  const cardOpen = useRef(false);
  const [detail, setDetail] = useState<EventDetail | null>(null);
  const [questDetail, setQuestDetail] = useState<Quest | null>(null);
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
    const near = `latitude=${center.latitude}&longitude=${center.longitude}&radiusM=${radiusM}`;
    // Hotspots only decorate the map, so a failure keeps the last ones instead of blocking the list.
    authedRequest<{ areas: HotspotArea[] }>(`/hotspots?${near}&limit=${HOTSPOT_LIMIT}`)
      .then(({ areas }) => setHotspots(areas))
      .catch(() => {});
    try {
      const [{ events }, { quests }] = await Promise.all([
        authedRequest<{ events: NearbyEvent[] }>(`/events?${near}`),
        authedRequest<{ quests: NearbyQuest[] }>(`/quests?${near}&limit=100`),
      ]);
      setEvents(events);
      setQuests(quests);
      setListError(null);
    } catch (err) {
      setListError(errorMessage(err));
    }
  }, [authedRequest, search]);

  // Reload when the tab is opened, so new quests, events and attendee counts show up.
  useFocusEffect(
    useCallback(() => {
      loadEvents();
    }, [loadEvents]),
  );

  // Quests with an upcoming party show as that party, so each spot appears once.
  const openQuests = useMemo(() => {
    if (!quests) return null;
    const scheduled = new Set(events?.map((event) => event.questId));
    return quests.filter((quest) => !scheduled.has(quest.id));
  }, [quests, events]);

  const hotAreas = useMemo(
    () => new Set(hotspots.filter((area) => area.isHotspot).map((area) => area.areaId)),
    [hotspots],
  );

  const select = useCallback(
    async (kind: PinKind, id: string) => {
      const selection = { kind, id };
      const isCurrent = () => selectedRef.current === selection;
      selectedRef.current = selection;
      setSelected(selection);
      setDetail(null);
      setQuestDetail(null);
      setCardError(null);
      cardSheet.current?.snapToIndex(0);
      try {
        // Ignore a slow response for a pin the user has already moved away from.
        if (kind === 'event') {
          const loaded = await authedRequest<EventDetail>(`/events/${id}`);
          if (isCurrent()) setDetail(loaded);
        } else {
          const loaded = await authedRequest<Quest>(`/quests/${id}`);
          if (isCurrent()) setQuestDetail(loaded);
        }
      } catch (err) {
        if (isCurrent()) setCardError(errorMessage(err));
      }
    },
    [authedRequest],
  );

  // Reloads the open card's details in place, such as after checking in to its walk-up.
  const reloadSelected = useCallback(async () => {
    const selection = selectedRef.current;
    if (!selection) return;
    try {
      if (selection.kind === 'event') {
        const loaded = await authedRequest<EventDetail>(`/events/${selection.id}`);
        if (selectedRef.current === selection) setDetail(loaded);
      } else {
        const loaded = await authedRequest<Quest>(`/quests/${selection.id}`);
        if (selectedRef.current === selection) setQuestDetail(loaded);
      }
    } catch {
      // The card keeps what it had; the list reload below shows any change.
    }
  }, [authedRequest]);

  // A completed quest leaves the list, so after a cleanup ends the list reloads when the card closes,
  // and the card can show the result until then.
  const reloadOnClose = useRef(false);
  const onWalkUpChange = useCallback(
    (change: WalkUpChange) => {
      if (change === 'ended') {
        reloadOnClose.current = true;
        return;
      }
      reloadSelected();
      loadEvents();
    },
    [reloadSelected, loadEvents],
  );

  // Move screen reader focus with the selection, once the list is shown or hidden again: to the new title
  // when another pin is picked while the card is open, and back to the list when the card closes.
  const hadSelection = useRef(false);
  useEffect(() => {
    if (selected) {
      if (cardOpen.current) focus(cardTitle);
    } else if (hadSelection.current) {
      focus(listTitle);
    }
    hadSelection.current = selected !== null;
  }, [selected]);

  const closeCard = useCallback(() => cardSheet.current?.close(), []);

  // Swiping the card down, tapping the dimmed map, or pressing Close goes back to the list.
  const deselect = useCallback(() => {
    selectedRef.current = null;
    setSelected(null);
    setDetail(null);
    setQuestDetail(null);
    setCardError(null);
    if (reloadOnClose.current) {
      reloadOnClose.current = false;
      loadEvents();
    }
  }, [loadEvents]);

  const onCardChange = useCallback((index: number) => {
    const wasOpen = cardOpen.current;
    cardOpen.current = index >= 0;
    if (!wasOpen && cardOpen.current) focus(cardTitle);
  }, []);

  // Android's back button closes the card before leaving the screen.
  useFocusEffect(
    useCallback(() => {
      if (!selected) return;
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        closeCard();
        return true;
      });
      return () => subscription.remove();
    }, [selected, closeCard]),
  );

  async function changeAttendance(method: 'POST' | 'DELETE') {
    if (selected?.kind !== 'event') return;
    const joining = method === 'POST';
    setBusy(true);
    setCardError(null);
    try {
      const updated = await authedRequest<EventDetail>(`/events/${selected.id}/join`, { method });
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

  // Schedules the first party on an open quest, then shows that party's card.
  async function scheduleParty(start: Date, end: Date) {
    if (selected?.kind !== 'quest') return;
    setBusy(true);
    setCardError(null);
    try {
      const event = await authedRequest<{ id: string }>(`/quests/${selected.id}/events`, {
        method: 'POST',
        body: { scheduledStart: start.toISOString(), scheduledEnd: end.toISOString() },
      });
      await loadEvents();
      select('event', event.id);
      AccessibilityInfo.announceForAccessibility("Party scheduled. You're the leader.");
    } catch (err) {
      setCardError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const selectedEvent =
    selected?.kind === 'event' ? (detail ?? events?.find((e) => e.id === selected.id) ?? null) : null;
  const selectedQuest = selected?.kind === 'quest' ? (openQuests?.find((q) => q.id === selected.id) ?? null) : null;

  const rows = useMemo<ListRow[]>(() => {
    const quests = openQuests ?? [];
    return [
      ...(events ?? []).map((item) => ({ kind: 'event' as const, item })),
      ...(quests.length > 0 && (events?.length ?? 0) > 0 ? [{ kind: 'questsHeading' as const }] : []),
      ...quests.map((item) => ({ kind: 'quest' as const, item })),
    ];
  }, [events, openQuests]);
  const loaded = events !== null && openQuests !== null;

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
    ({ item: row }: { item: ListRow }) =>
      row.kind === 'event' ? (
        <EventRow event={row.item} hot={hotAreas.has(row.item.areaId)} onSelect={select} />
      ) : row.kind === 'quest' ? (
        <QuestRow quest={row.item} hot={hotAreas.has(row.item.areaId)} onSelect={select} />
      ) : (
        <ThemedText accessibilityRole="header" themeColor="text" style={[displayStyles.base, styles.sectionTitle]}>
          Needs a party
        </ThemedText>
      ),
    [select, hotAreas],
  );

  const sheetProps = useMemo(
    () => ({
      backgroundStyle: { backgroundColor: theme.background },
      bottomInset: BottomTabInset,
      topInset: insets.top + COMPACT_HEADER_HEIGHT,
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
  const isCardOpen = selected !== null;

  return (
    <ThemedView style={styles.container} onLayout={onLayout}>
      <AppHeader
        accessibilityElementsHidden={isCardOpen}
        backgroundColor="backgroundElement"
        brandColor="text"
        importantForAccessibility={isCardOpen ? 'no-hide-descendants' : 'auto'}
        style={styles.appHeader}
      />

      {/* While the card is open, screen readers stay inside it instead of wandering onto the map and list. */}
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="box-none"
        accessibilityElementsHidden={isCardOpen}
        importantForAccessibility={isCardOpen ? 'no-hide-descendants' : 'auto'}>
        <EventsMap
          events={events ?? []}
          quests={openQuests ?? []}
          hotspots={hotspots}
          selected={selected}
          onSelect={select}
          center={mapCenter}
          // Only set when the user is in NYC, so it doubles as the location dot.
          userLocation={mapCenter}
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
            data={rows}
            keyExtractor={rowKey}
            renderItem={renderItem}
            contentContainerStyle={styles.list}
            ListHeaderComponent={
              <View style={styles.listHeader}>
                <ThemedText
                  ref={listTitle}
                  accessibilityRole="header"
                  themeColor="text"
                  style={[displayStyles.base, styles.listTitle]}>
                  Quests near you
                </ThemedText>
                {loaded && rows.length > 0 ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    {countText(events.length, openQuests.length)}
                  </ThemedText>
                ) : null}
                {hotspots.length > 0 ? <HotspotLegend /> : null}
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
              ) : loaded ? (
                <ThemedText themeColor="textSecondary" style={[styles.status, styles.centered]}>
                  No quests nearby yet. Spot some litter? Report it from the Create tab.
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
          {selectedEvent ? (
            <EventCard
              event={selectedEvent}
              detail={detail}
              hot={hotAreas.has(selectedEvent.areaId)}
              busy={busy}
              error={cardError}
              onJoin={() => changeAttendance('POST')}
              onLeave={() => changeAttendance('DELETE')}
              onWalkUpChange={onWalkUpChange}
              onClose={closeCard}
              titleRef={cardTitle}
            />
          ) : selectedQuest ? (
            <QuestCard
              // A different quest starts fresh, with the scheduler closed.
              key={selectedQuest.id}
              quest={selectedQuest}
              detail={questDetail}
              hot={hotAreas.has(selectedQuest.areaId)}
              busy={busy}
              error={cardError}
              onSchedule={scheduleParty}
              onWalkUpChange={onWalkUpChange}
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
  hot,
  onSelect,
}: {
  event: NearbyEvent;
  hot: boolean;
  onSelect: (kind: PinKind, id: string) => void;
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
    event.walkUp ? `Live now, ${onSiteText(event.walkUp.checkedInCount)}` : null,
    hot ? 'Hotspot, bonus XP' : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable
      onPress={() => onSelect('event', event.id)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the quest details"
      style={squish(styles.row)}>
      <SitePhoto photo={event.photo} tier={event.difficultyTier} style={styles.thumbnail} />
      <View style={styles.rowText}>
        <ThemedText themeColor="text" style={[displayStyles.base, styles.rowTitle]} numberOfLines={2}>
          {event.title}
        </ThemedText>
        <View style={styles.rowBadges}>
          <TierBadge tier={event.difficultyTier} />
          <XpBadge maxXp={event.maxXp} />
          {event.walkUp ? <LiveBadge count={event.walkUp.checkedInCount} /> : null}
          {hot ? <HotspotBadge /> : null}
        </View>
        <ThemedText type="small" themeColor="textSecondary">
          {formatEventTime(event.scheduledStart, event.scheduledEnd)}
        </ThemedText>
        <View style={styles.meta}>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDistance(event.distanceM)}
          </ThemedText>
          <ThemedText type="smallBold" themeColor="text">
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

const QuestRow = memo(function QuestRow({
  quest,
  hot,
  onSelect,
}: {
  quest: NearbyQuest;
  hot: boolean;
  onSelect: (kind: PinKind, id: string) => void;
}) {
  const label = [
    quest.title,
    `${TIER_LABELS[quest.difficultyTier]} difficulty`,
    quest.walkUp ? `Live now, ${onSiteText(quest.walkUp.checkedInCount)}` : 'No party yet',
    describeDistance(quest.distanceM),
    hot ? 'Hotspot, bonus XP' : null,
  ]
    .filter(Boolean)
    .join('. ');

  return (
    <Pressable
      onPress={() => onSelect('quest', quest.id)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint="Opens the quest details"
      style={squish(styles.row)}>
      <SitePhoto photo={quest.photo} tier={quest.difficultyTier} style={styles.thumbnail} />
      <View style={styles.rowText}>
        <ThemedText themeColor="text" style={[displayStyles.base, styles.rowTitle]} numberOfLines={2}>
          {quest.title}
        </ThemedText>
        <View style={styles.rowBadges}>
          <TierBadge tier={quest.difficultyTier} />
          {quest.walkUp ? <LiveBadge count={quest.walkUp.checkedInCount} /> : null}
          {hot ? <HotspotBadge /> : null}
        </View>
        <View style={styles.meta}>
          <ThemedText type="small" themeColor="textSecondary">
            {formatDistance(quest.distanceM)}
          </ThemedText>
          <ThemedText type="smallBold" themeColor="text">
            {quest.walkUp ? 'Check in to join' : 'No party yet'}
          </ThemedText>
        </View>
      </View>
    </Pressable>
  );
});

// Explains the glows on the map. The swatches echo them; the words carry the meaning.
function HotspotLegend() {
  const theme = useTheme();
  return (
    <View style={styles.legend}>
      <View style={styles.legendItem}>
        <View style={[styles.swatch, styles.swatchWarm]} />
        <ThemedText type="small" themeColor="textSecondary">
          Reported recently
        </ThemedText>
      </View>
      <View style={styles.legendItem}>
        <View style={[styles.swatch, { backgroundColor: theme.ember }]} />
        <ThemedText type="small" themeColor="textSecondary">
          Hotspot: reported by 3 or more people, earns bonus XP
        </ThemedText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  appHeader: {
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    zIndex: 10,
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
  listTitle: {
    fontSize: 26,
    lineHeight: 32,
  },
  sectionTitle: {
    fontSize: 20,
    lineHeight: 26,
    paddingTop: Spacing.three,
  },
  legend: {
    gap: Spacing.one,
    paddingTop: Spacing.two,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  swatchWarm: {
    // The map's glow for areas still warming up, matched by eye.
    backgroundColor: '#FFB27A',
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
