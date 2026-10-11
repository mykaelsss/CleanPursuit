import { Pressable, StyleSheet, View } from 'react-native';

import QuestIcon from '@/components/create-quest/quest-icon';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export function CreateQuestHero() {
  const theme = useTheme();

  return (
    <View style={[styles.hero, { backgroundColor: theme.onTint }]}>
      <View style={[styles.heroIcon, { backgroundColor: theme.primary }]}>
        <QuestIcon name="sparkle" color={theme.onPrimary} size={26} />
      </View>
      <View style={styles.heroCopy}>
        <ThemedText type="smallBold" style={{ color: theme.text }}>
          NEW COMMUNITY MISSION
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          Complete the details to unlock your quest
        </ThemedText>
      </View>
      <View style={[styles.stepPill, { backgroundColor: theme.reward }]}>
        <ThemedText type="smallBold" style={{ color: theme.onReward }}>
          4 STEPS
        </ThemedText>
      </View>
    </View>
  );
}

export function QuestReadiness({ completedSteps }: { completedSteps: number }) {
  const theme = useTheme();

  return (
    <View style={styles.readiness}>
      <View style={styles.readinessCopy}>
        <ThemedText type="smallBold">Quest readiness</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {completedSteps} of 4 steps complete
        </ThemedText>
      </View>
      <View style={[styles.progressTrack, { backgroundColor: theme.border }]}>
        <View
          style={[
            styles.progressFill,
            { backgroundColor: theme.accent, width: `${(completedSteps / 4) * 100}%` },
          ]}
        />
      </View>
    </View>
  );
}

export function QuestReward() {
  const theme = useTheme();

  return (
    <View style={[styles.reward, { backgroundColor: theme.reward }]}>
      <View style={styles.rewardCopy}>
        <ThemedText type="smallBold" style={{ color: theme.onReward }}>
          PARTY REWARD
        </ThemedText>
        <ThemedText type="small" style={{ color: theme.onReward }}>
          Checked-in volunteers earn XP when the cleanup is completed.
        </ThemedText>
      </View>
      <View style={[styles.rewardIcon, { backgroundColor: theme.backgroundElement }]}>
        <QuestIcon name="sparkle" color={theme.onReward} size={24} />
      </View>
    </View>
  );
}

export function CreateQuestButton({ ready, onPress }: { ready: boolean; onPress: () => void }) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.createButton,
        { backgroundColor: ready ? theme.tint : theme.border },
        pressed && ready && styles.createButtonPressed,
      ]}>
      <QuestIcon name="sparkle" color={ready ? theme.onTint : theme.textSecondary} size={22} />
      <ThemedText
        type="smallBold"
        style={{ color: ready ? theme.onTint : theme.textSecondary, fontSize: 16 }}>
        Create quest
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hero: {
    minHeight: 82,
    borderRadius: 20,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroCopy: {
    flex: 1,
    gap: 2,
  },
  stepPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  readiness: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  readinessCopy: {
    gap: 1,
  },
  progressTrack: {
    flex: 1,
    height: 9,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  reward: {
    minHeight: 76,
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  rewardCopy: {
    flex: 1,
    gap: 2,
  },
  rewardIcon: {
    width: 46,
    height: 46,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createButton: {
    minHeight: 58,
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.13,
    shadowRadius: 8,
    elevation: 3,
  },
  createButtonPressed: {
    opacity: 0.84,
    transform: [{ scale: 0.99 }],
  },
});
