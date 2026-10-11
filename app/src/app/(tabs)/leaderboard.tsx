import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ApiError, type Leaderboard, type LeaderboardEntry } from '@/lib/api';
import { useAuth } from '@/lib/auth';

// Gold, silver and bronze for the top three ranks.
const MEDALS: Record<number, string> = { 1: '#D4A017', 2: '#9BA4AE', 3: '#B8733D' };

export default function LeaderboardScreen() {
  const { user, authedRequest } = useAuth();
  const theme = useTheme();
  const [board, setBoard] = useState<Leaderboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      setBoard(await authedRequest<Leaderboard>('/leaderboard?limit=100'));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Can't reach CleanPursuit. Check your connection.");
    }
  }, [authedRequest]);

  // Reload whenever the tab is opened, so XP earned elsewhere shows up.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
        <FlatList
          data={board?.entries ?? []}
          keyExtractor={(entry) => entry.user.id}
          renderItem={({ item }) => <Row entry={item} isMe={item.user.id === user?.id} />}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={theme.textSecondary} />}
          ListHeaderComponent={
            <View style={styles.header}>
              <View>
                <ThemedText type="subtitle">Leaderboard</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  All-time XP
                </ThemedText>
              </View>
              {board && (
                <ThemedView type="backgroundElement" style={styles.meCard}>
                  <View>
                    <ThemedText type="small" themeColor="textSecondary">
                      Your rank
                    </ThemedText>
                    <ThemedText type="subtitle">#{board.me.rank}</ThemedText>
                  </View>
                  <View style={styles.meXp}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Your XP
                    </ThemedText>
                    <ThemedText type="subtitle">{board.me.totalXp.toLocaleString()}</ThemedText>
                  </View>
                </ThemedView>
              )}
            </View>
          }
          ListEmptyComponent={
            error ? (
              <View style={styles.status}>
                <ThemedText themeColor="error" style={styles.centered}>
                  {error}
                </ThemedText>
                <Pressable onPress={load} accessibilityRole="button" style={({ pressed }) => pressed && styles.pressed}>
                  <ThemedText type="smallBold" style={{ color: theme.tint }}>
                    Try again
                  </ThemedText>
                </Pressable>
              </View>
            ) : board ? (
              <ThemedText themeColor="textSecondary" style={[styles.status, styles.centered]}>
                No one has earned XP yet. Join a cleanup to get on the board.
              </ThemedText>
            ) : (
              <ActivityIndicator style={styles.status} color={theme.textSecondary} />
            )
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
      accessibilityLabel={`Rank ${entry.rank}, ${entry.user.username}${isMe ? ' (you)' : ''}, ${entry.totalXp} XP`}>
      <ThemedText type="smallBold" style={[styles.rank, { color: medal ?? theme.textSecondary }]}>
        {entry.rank}
      </ThemedText>
      <ThemedText style={styles.username} numberOfLines={1}>
        {entry.user.username}
        {isMe && <ThemedText themeColor="textSecondary"> (you)</ThemedText>}
      </ThemedText>
      <ThemedText type="smallBold">{entry.totalXp.toLocaleString()} XP</ThemedText>
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
