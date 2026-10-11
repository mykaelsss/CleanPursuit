import { Link } from 'expo-router';
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
            <ThemedText type="smallBold" themeColor="tint">
              ADVENTURE HUB
            </ThemedText>
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
                  LEVEL {level.number}
                </Text>
              </View>
              <ThemedText type="smallBold" style={{ color: theme.onGamePanelSoft }}>
                {user.totalXp.toLocaleString()} TOTAL XP
              </ThemedText>
            </View>

            <View style={styles.progressSection}>
              <ThemedText type="subtitle" style={{ color: theme.onGamePanel }}>
                {atMaxLevel
                  ? 'You reached the top level'
                  : `${xpRemaining.toLocaleString()} XP to Level ${level.number + 1}`}
              </ThemedText>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={
                  atMaxLevel ? 'Maximum level reached' : `Progress toward level ${level.number + 1}`
                }
                accessibilityValue={{ min: 0, max: 100, now: Math.round(progress * 100) }}
                style={[styles.progressTrack, { backgroundColor: theme.onGamePanelSoft }]}
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
            <View style={styles.sectionHeading}>
              <ThemedText type="subtitle">Choose your path</ThemedText>
              <ThemedText type="small" themeColor="textSecondary">
                Every cleanup begins with one action.
              </ThemedText>
            </View>

            <View style={styles.actionGrid}>
              <QuestAction
                href="/events"
                eyebrow="EXPLORE"
                icon="compass"
                title="Find a quest"
                description="Join a cleanup happening near you."
                backgroundColor={theme.questAction}
                foregroundColor={theme.onQuestAction}
                iconBackgroundColor={theme.questActionGlow}
                iconColor={theme.gamePanel}
                borderColor={theme.questActionGlow}
              />
              <QuestAction
                href="/create"
                eyebrow="LEAD"
                icon="flag"
                title="Create a quest"
                description="Mark a spot and rally your neighbors."
                backgroundColor={theme.backgroundElement}
                foregroundColor={theme.text}
                iconBackgroundColor={theme.backgroundSelected}
                iconColor={theme.text}
                borderColor={theme.border}
              />
            </View>
          </View>

          <ThemedView
            type="backgroundElement"
            style={[styles.rankingCard, { borderColor: theme.border }]}
          >
            <View style={styles.rankingCopy}>
              <ThemedText type="smallBold" themeColor="tint">
                CLIMB THE RANKS
              </ThemedText>
              <ThemedText type="subtitle">Leaderboard</ThemedText>
              <ThemedText themeColor="textSecondary">
                See how your all-time XP compares.
              </ThemedText>
            </View>
            <Link href="/leaderboard" asChild>
              <Pressable
                accessibilityRole="button"
                style={squish([styles.rankingButton, { borderColor: theme.border }])}
              >
                <ThemedText type="smallBold" themeColor="tint" selectable={false}>
                  View rankings
                </ThemedText>
              </Pressable>
            </Link>
          </ThemedView>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

type QuestActionProps = {
  href: '/events' | '/create';
  eyebrow: string;
  icon: 'compass' | 'flag';
  title: string;
  description: string;
  backgroundColor: string;
  foregroundColor: string;
  iconBackgroundColor: string;
  iconColor: string;
  borderColor: string;
};

function QuestAction({
  href,
  eyebrow,
  icon,
  title,
  description,
  backgroundColor,
  foregroundColor,
  iconBackgroundColor,
  iconColor,
  borderColor,
}: QuestActionProps) {
  return (
    <Link href={href} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${title}. ${description}`}
        style={squish([styles.actionCard, { backgroundColor, borderColor }])}
      >
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.actionIcon, { backgroundColor: iconBackgroundColor }]}
        >
          <QuestActionIcon name={icon} color={iconColor} />
        </View>

        <View style={styles.actionTitleGroup}>
          <ThemedText type="smallBold" style={{ color: foregroundColor }}>
            {eyebrow}
          </ThemedText>
          <ThemedText type="subtitle" style={[styles.actionTitle, { color: foregroundColor }]}>
            {title}
          </ThemedText>
        </View>

        <ThemedText style={[styles.actionDescription, { color: foregroundColor }]}>
          {description}
        </ThemedText>
        <View style={[styles.goBadge, { borderColor: foregroundColor }]}>
          <ThemedText type="smallBold" style={{ color: foregroundColor }} selectable={false}>
            GO
          </ThemedText>
        </View>
      </Pressable>
    </Link>
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
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.three,
    paddingTop: Spacing.four,
  },
  sectionHeading: {
    gap: Spacing.one,
  },
  actionGrid: {
    gap: Spacing.four,
  },
  actionCard: {
    alignItems: 'flex-start',
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    gap: Spacing.three,
    minHeight: 176,
    padding: Spacing.four,
  },
  actionIcon: {
    alignItems: 'center',
    borderRadius: 28,
    height: 56,
    justifyContent: 'center',
    position: 'absolute',
    right: Spacing.four,
    top: Spacing.four,
    width: 56,
  },
  actionTitleGroup: {
    gap: Spacing.one,
    paddingRight: 72,
    width: '100%',
  },
  actionTitle: {
    fontSize: 28,
    lineHeight: 34,
  },
  actionDescription: {
    lineHeight: 22,
  },
  goBadge: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: Spacing.two,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: 40,
    minWidth: 48,
    paddingHorizontal: Spacing.two,
  },
  rankingCard: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    gap: Spacing.three,
    padding: Spacing.four,
  },
  rankingCopy: {
    gap: Spacing.one,
  },
  rankingButton: {
    alignItems: 'center',
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: MIN_TOUCH,
    paddingHorizontal: Spacing.three,
  },
});
