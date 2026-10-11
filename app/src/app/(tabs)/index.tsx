import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AppHeader from '@/components/app-header';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MaxContentWidth, Spacing } from '@/constants/theme';
import { useAuth } from '@/lib/auth';

export default function HomeScreen() {
  const { user } = useAuth();

  return (
    <ThemedView style={styles.container}>
      <AppHeader backgroundColor="backgroundElement" brandColor="tint" />

      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
        <ThemedText type="subtitle">Hi, {user?.username}</ThemedText>

        <ThemedView type="backgroundElement" style={styles.card}>
          <ThemedText type="small" themeColor="textSecondary">
            Total XP
          </ThemedText>
          <ThemedText type="subtitle">{user?.totalXp ?? 0}</ThemedText>
        </ThemedView>

        {user && (
          <ThemedView type="backgroundElement" style={styles.card}>
            <ThemedText type="small" themeColor="textSecondary">
              Level
            </ThemedText>
            <ThemedText type="subtitle">{user.level.number}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {user.level.xpForNextLevel === null
                ? 'Max level'
                : `${user.level.xpIntoLevel} / ${user.level.xpForNextLevel} XP to level ${user.level.number + 1}`}
            </ThemedText>
          </ThemedView>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    alignSelf: 'center',
    flex: 1,
    maxWidth: MaxContentWidth,
    width: '100%',
    paddingHorizontal: Spacing.four,
    paddingTop: Spacing.four,
    paddingBottom: BottomTabInset + Spacing.three,
    gap: Spacing.three,
  },
  card: {
    padding: Spacing.three,
    borderRadius: Spacing.three,
    gap: Spacing.one,
  },
});
