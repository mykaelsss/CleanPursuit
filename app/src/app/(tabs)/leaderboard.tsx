import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, MIN_TOUCH, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, type Leaderboard, type LeaderboardEntry, type LeaderboardPeriod } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// Gold, silver and bronze for the top three ranks.
const MEDALS: Record<number, string> = { 1: '#D4A017', 2: '#9BA4AE', 3: '#B8733D' };
const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'day', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'all', label: 'All time' },
];
const PERIOD_DESCRIPTIONS: Record<LeaderboardPeriod, string> = {
  day: 'XP earned today (UTC)',
  week: 'XP earned this week (UTC, starting Monday)',
  month: 'XP earned this month (UTC)',
  all: 'All-time XP',
};
const EMPTY_ENTRIES: LeaderboardEntry[] = [];
const entryKey = (entry: LeaderboardEntry) => entry.userId;

export default function LeaderboardScreen() {
  const { user, authedRequest } = useAuth();
  const theme = useTheme();
  const [period, setPeriod] = useState<LeaderboardPeriod>('all');
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  // A slow response must not replace a newer period or refresh, or update a blurred screen.
  const requestId = useRef(0);

  const load = useCallback(
    async (isRefresh = false) => {
      const id = ++requestId.current;
      setLoading(true);
      setRefreshing(isRefresh);
      setError(null);
      try {
        const result = await authedRequest<Leaderboard>(`/leaderboards?period=${period}&limit=100`);
        if (id === requestId.current) setBoard(result);
      } catch (err) {
        if (id === requestId.current) {
          setError(err instanceof ApiError ? err.message : "Can't reach CleanPursuit. Check your connection.");
        }
      } finally {
        if (id === requestId.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [authedRequest, period],
  );

  // Reload whenever the tab is opened, so XP earned elsewhere shows up.
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => {
        requestId.current += 1;
      };
    }, [load]),
  );

  function selectPeriod(next: LeaderboardPeriod) {
    if (next === period) return;
    requestId.current += 1;
    setBoard(null);
    setError(null);
    setLoading(true);
    setRefreshing(false);
    setPeriod(next);
  }

  const refresh = useCallback(() => {
    void load(true);
  }, [load]);
  const retry = useCallback(() => {
    void load();
  }, [load]);
  const renderItem = useCallback(
    ({ item }: { item: LeaderboardEntry }) => <Row entry={item} isMe={item.userId === user?.id} />,
    [user?.id],
  );

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <FlatList
          data={board?.entries ?? EMPTY_ENTRIES}
          keyExtractor={entryKey}
          renderItem={renderItem}
          extraData={user?.id}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.textSecondary} />}
          ListHeaderComponent={
            <View style={styles.header}>
              <View>
                <ThemedText type="subtitle">Leaderboard</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {PERIOD_DESCRIPTIONS[period]}
                </ThemedText>
              </View>
              <View style={styles.periods}>
                {PERIODS.map(({ value, label }) => (
                  <Pressable
                    key={value}
                    accessibilityRole="button"
                    accessibilityLabel={`${label} leaderboard`}
                    accessibilityState={{ selected: period === value }}
                    onPress={() => selectPeriod(value)}
                    style={({ pressed }) => [
                      styles.period,
                      { backgroundColor: period === value ? theme.tint : theme.backgroundElement },
                      pressed && styles.pressed,
                    ]}>
                    <ThemedText type="smallBold" style={{ color: period === value ? theme.onTint : theme.text }}>
                      {label}
                    </ThemedText>
                  </Pressable>
                ))}
              </View>
              {board ? (
                <ThemedView type="backgroundElement" style={styles.meCard}>
                  <View>
                    <ThemedText type="small" themeColor="textSecondary">
                      Your rank
                    </ThemedText>
                    <ThemedText type={board.me.rank === null ? 'default' : 'subtitle'}>
                      {board.me.rank === null ? 'Unranked' : `#${board.me.rank}`}
                    </ThemedText>
                  </View>
                  <View style={styles.meXp}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {period === 'all' ? 'Your XP' : 'Your period XP'}
                    </ThemedText>
                    <ThemedText type="subtitle">{board.me.xp.toLocaleString()}</ThemedText>
                    {period !== 'all' ? (
                      <ThemedText type="small" themeColor="textSecondary">
                        {board.me.totalXp.toLocaleString()} all-time XP
                      </ThemedText>
                    ) : null}
                  </View>
                </ThemedView>
              ) : null}
              {board?.me.rank === null ? (
                <ThemedText type="small" themeColor="textSecondary">
                  Earn XP from a cleanup to rank {period === 'all' ? 'on the board' : 'in this period'}.
                </ThemedText>
              ) : null}
              {loading && board && !refreshing ? (
                <ActivityIndicator color={theme.textSecondary} accessibilityLabel="Updating leaderboard" />
              ) : null}
              {error ? (
                <View style={styles.error}>
                  <ThemedText themeColor="error" style={styles.centered} accessibilityRole="alert">
                    {board ? `Couldn't update the leaderboard. Showing the last loaded results. ${error}` : error}
                  </ThemedText>
                  <Pressable
                    onPress={retry}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.retry, pressed && styles.pressed]}>
                    <ThemedText type="smallBold" style={{ color: theme.tint }}>
                      Try again
                    </ThemedText>
                  </Pressable>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            loading && !board ? (
              <ActivityIndicator style={styles.status} color={theme.textSecondary} accessibilityLabel="Loading leaderboard" />
            ) : !error && board ? (
              <ThemedText themeColor="textSecondary" style={[styles.status, styles.centered]}>
                No one has earned XP {period === 'all' ? 'yet' : 'in this period'}. Join a cleanup to get on the board.
              </ThemedText>
            ) : null
          }
          ListFooterComponent={
            board && board.entries.length === board.limit ? (
              <ThemedText type="small" themeColor="textSecondary" style={[styles.status, styles.centered]}>
                Showing the top {board.limit} cleaners. Your rank includes everyone in this period.
              </ThemedText>
            ) : null
          }
        />
      </SafeAreaView>
    </ThemedView>
  );
}

function Row({ entry, isMe }: { entry: LeaderboardEntry; isMe: boolean }) {
  const theme = useTheme();
  const medal = MEDALS[entry.rank];
  return (
    <ThemedView
      type={isMe ? 'backgroundSelected' : 'background'}
      style={styles.row}
      accessible
      accessibilityLabel={`Rank ${entry.rank}, ${entry.username}${isMe ? ' (you)' : ''}, ${entry.xp} XP`}>
      <ThemedText type="smallBold" style={[styles.rank, { color: medal ?? theme.textSecondary }]}>
        {entry.rank}
      </ThemedText>
      <ThemedText style={styles.username} numberOfLines={1}>
        {entry.username}
        {isMe && <ThemedText themeColor="textSecondary"> (you)</ThemedText>}
      </ThemedText>
      <ThemedText type="smallBold">{entry.xp.toLocaleString()} XP</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    maxWidth: MaxContentWidth,
  },
  list: {
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
  },
  header: {
    gap: Spacing.three,
    marginBottom: Spacing.three,
  },
  periods: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  period: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
  },
  error: {
    alignItems: 'center',
    gap: Spacing.two,
  },
  retry: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  meCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: Spacing.three,
    borderRadius: Spacing.three,
  },
  meXp: {
    alignItems: 'flex-end',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: Spacing.two + Spacing.one,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two + Spacing.one,
  },
  rank: {
    width: 32,
    fontSize: 16,
  },
  username: {
    flex: 1,
  },
  status: {
    marginTop: Spacing.five,
    alignItems: 'center',
    gap: Spacing.two,
  },
  centered: {
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
});
