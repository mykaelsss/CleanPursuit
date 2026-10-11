import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';

import AppHeader from '@/components/app-header';
import { displayStyles, squish } from '@/components/quest-ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { BottomTabInset, MIN_TOUCH, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useAuth } from '@/lib/auth';

export default function HomeScreen() {
  const { user } = useAuth();
  const theme = useTheme();
  const router = useRouter();

  if (!user) return null;

  const { level } = user;
  const nextLevelXp = level.xpForNextLevel;
  const atMaxLevel = nextLevelXp === null;
  const progress = atMaxLevel
    ? 1
    : Math.min(Math.max(level.xpIntoLevel / nextLevelXp, 0), 1);
  const xpRemaining = atMaxLevel
    ? 0
    : Math.max(nextLevelXp - level.xpIntoLevel, 0);
  const progressText = atMaxLevel
    ? 'Max level'
    : `${level.xpIntoLevel.toLocaleString()} / ${nextLevelXp.toLocaleString()} XP`;

  return (
    <ThemedView style={styles.container}>
      <AppHeader backgroundColor="backgroundElement" brandColor="tint" />

      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <View style={styles.greeting}>
            <ThemedText type="subtitle">Welcome back, {user.username}</ThemedText>
            <ThemedText themeColor="textSecondary">
              Choose your next move and help your neighborhood.
            </ThemedText>
          </View>

          <View
            style={[
              styles.playerCard,
              { backgroundColor: theme.gamePanel, borderColor: theme.questActionGlow },
            ]}
          >
            <View style={styles.playerCardTop}>
              <View style={[styles.levelBadge, { backgroundColor: theme.reward }]}>
                <Text style={[styles.levelBadgeText, { color: theme.onReward }]}>
                  Level {level.number}
                </Text>
              </View>
              <ThemedText type="smallBold" style={{ color: theme.onGamePanelSoft }}>
                {user.totalXp.toLocaleString()} total XP
              </ThemedText>
            </View>

            <View style={styles.progressSection}>
              <Text style={[styles.progressHeadline, { color: theme.onGamePanel }]}>
                {atMaxLevel
                  ? 'You reached the top level'
                  : `${xpRemaining.toLocaleString()} XP to level ${level.number + 1}`}
              </Text>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={
                  atMaxLevel ? 'Maximum level reached' : `Progress toward level ${level.number + 1}`
                }
                accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
                style={styles.progressTrack}
              >
                <View
                  style={[
                    styles.progressFill,
                    { backgroundColor: theme.reward, width: `${progress * 100}%` },
                  ]}
                />
              </View>
              <View style={styles.progressLabels}>
                <ThemedText type="small" style={{ color: theme.onGamePanelSoft }}>
                  {progressText}
                </ThemedText>
                <ThemedText type="small" style={{ color: theme.onGamePanelSoft }}>
                  {Math.round(progress * 100)}%
                </ThemedText>
              </View>
            </View>
          </View>

          <View style={[styles.section, { borderTopColor: theme.border }]}>
            <ThemedText style={styles.sectionTitle}>Choose your path</ThemedText>

            <View style={styles.actionGrid}>
              <QuestAction
                onPress={() => router.push('/events')}
                icon="compass"
                title="Find a quest"
                description="Join a cleanup happening near you."
                actionLabel="Browse quests"
                backgroundColor={theme.questAction}
                foregroundColor={theme.onQuestAction}
                iconBackgroundColor={theme.questActionGlow}
                iconColor={theme.gamePanel}
                borderColor={theme.questAction}
                buttonColor={theme.reward}
                onButtonColor={theme.onReward}
              />
              <QuestAction
                onPress={() => router.push('/create')}
                icon="flag"
                title="Create a quest"
                description="Mark a spot and rally your neighbors."
                actionLabel="Start a quest"
                backgroundColor={theme.backgroundElement}
                foregroundColor={theme.text}
                secondaryColor={theme.textSecondary}
                iconBackgroundColor={theme.backgroundSelected}
                iconColor={theme.text}
                borderColor={theme.border}
                buttonColor={theme.tint}
                onButtonColor={theme.onTint}
              />
            </View>
          </View>

          <View style={styles.linkRows}>
            <LinkRow
              onPress={() => router.push('/leaderboard')}
              title="Leaderboard"
              description="See how your all-time XP compares."
              actionLabel="View rankings"
            />
            <LinkRow
              onPress={() => router.push('/resources')}
              title="Safety resources"
              description="Who to call and where to take hazardous items in NYC."
              actionLabel="View resources"
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

type QuestActionProps = {
  onPress: () => void;
  icon: 'compass' | 'flag';
  title: string;
  description: string;
  actionLabel: string;
  backgroundColor: string;
  foregroundColor: string;
  secondaryColor?: string;
  iconBackgroundColor: string;
  iconColor: string;
  borderColor: string;
  buttonColor: string;
  onButtonColor: string;
};

function QuestAction({
  onPress,
  icon,
  title,
  description,
  actionLabel,
  backgroundColor,
  foregroundColor,
  secondaryColor = foregroundColor,
  iconBackgroundColor,
  iconColor,
  borderColor,
  buttonColor,
  onButtonColor,
}: QuestActionProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={actionLabel}
      accessibilityHint={description}
      onPress={onPress}
      style={squish([styles.actionCard, { backgroundColor, borderColor }])}
    >
      <View style={styles.actionTop}>
        <View style={styles.actionCopy}>
          <Text style={[styles.actionTitle, { color: foregroundColor }]}>{title}</Text>
          <ThemedText style={[styles.actionDescription, { color: secondaryColor }]}>
            {description}
          </ThemedText>
        </View>
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.actionIcon, { backgroundColor: iconBackgroundColor }]}
        >
          <QuestActionIcon name={icon} color={iconColor} />
        </View>
      </View>

      <View style={[styles.actionButton, { backgroundColor: buttonColor }]}>
        <Text style={[styles.actionButtonText, { color: onButtonColor }]}>{actionLabel}</Text>
      </View>
    </Pressable>
  );
}

type LinkRowProps = {
  onPress: () => void;
  title: string;
  description: string;
  actionLabel: string;
};

function LinkRow({ onPress, title, description, actionLabel }: LinkRowProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={actionLabel}
      accessibilityHint={description}
      onPress={onPress}
      style={squish([
        styles.linkRow,
        { backgroundColor: theme.backgroundElement, borderColor: theme.border },
      ])}
    >
      <View style={styles.linkRowCopy}>
        <ThemedText style={styles.sectionTitle}>{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {description}
        </ThemedText>
      </View>
      <View style={[styles.linkRowButton, { borderColor: theme.tint }]}>
        <ThemedText type="smallBold" themeColor="tint" selectable={false}>
          {actionLabel}
        </ThemedText>
      </View>
    </Pressable>
  );
}

function QuestActionIcon({ name, color }: { name: 'compass' | 'flag'; color: string }) {
  return (
    <Svg
      width={28}
      height={28}
      viewBox="0 0 24 24"
      fill="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {name === 'compass' ? (
        <>
          <Circle cx="12" cy="12" r="8.5" stroke={color} strokeWidth="1.8" />
          <Path
            d="m15.5 8.5-2.1 4.9-4.9 2.1 2.1-4.9 4.9-2.1Z"
            stroke={color}
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
        </>
      ) : (
        <>
          <Path d="M6 21V4" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
          <Path
            d="M6 5h10l-2 3 2 3H6"
            stroke={color}
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Path d="M9 8h4M11 6v4" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
        </>
      )}
    </Svg>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
  scroll: {
    alignSelf: 'center',
    gap: Spacing.four,
    maxWidth: 520,
    paddingBottom: BottomTabInset + Spacing.four,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    width: '100%',
  },
  greeting: {
    gap: Spacing.two,
  },
  playerCard: {
    borderRadius: Spacing.four,
    borderWidth: 1,
    gap: Spacing.four,
    overflow: 'hidden',
    padding: Spacing.four,
  },
  playerCardTop: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    justifyContent: 'space-between',
  },
  levelBadge: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  levelBadgeText: {
    ...displayStyles.base,
    fontSize: 17,
    lineHeight: 20,
  },
  progressSection: {
    gap: Spacing.three,
  },
  progressTrack: {
    // A faint track so an empty bar never reads as a full one.
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderRadius: 6,
    height: 12,
    overflow: 'hidden',
  },
  progressFill: {
    borderRadius: 6,
    height: '100%',
  },
  progressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  progressHeadline: {
    ...displayStyles.base,
    fontSize: 26,
    lineHeight: 32,
  },
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    paddingTop: Spacing.four,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 700,
    lineHeight: 28,
  },
  actionGrid: {
    gap: Spacing.three,
  },
  actionCard: {
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    gap: Spacing.three,
    padding: Spacing.three + Spacing.one,
  },
  actionTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: Spacing.three,
  },
  actionCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  actionIcon: {
    alignItems: 'center',
    borderRadius: 26,
    height: 52,
    justifyContent: 'center',
    width: 52,
  },
  actionTitle: {
    ...displayStyles.base,
    fontSize: 26,
    lineHeight: 32,
  },
  actionDescription: {
    lineHeight: 22,
  },
  actionButton: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Spacing.three,
    justifyContent: 'center',
    minHeight: MIN_TOUCH,
    paddingHorizontal: Spacing.four,
  },
  actionButtonText: {
    ...displayStyles.base,
    fontSize: 18,
    lineHeight: 22,
  },
  linkRows: {
    gap: Spacing.three,
  },
  linkRow: {
    alignItems: 'center',
    borderRadius: Spacing.three,
    borderWidth: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.three,
    padding: Spacing.three + Spacing.one,
  },
  linkRowCopy: {
    flexBasis: 180,
    flexGrow: 1,
    gap: Spacing.half,
  },
  linkRowButton: {
    alignItems: 'center',
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: MIN_TOUCH,
    paddingHorizontal: Spacing.three,
  },
});
