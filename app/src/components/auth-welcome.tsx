import { Pressable, StyleSheet, Text, View } from 'react-native';

import { squish } from '@/components/quest-ui';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { DisplayFont, MIN_TOUCH, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const STEPS = [
  {
    number: '1',
    title: 'Spot a quest',
    description: 'Find a cleanup near you or report a place that needs help.',
  },
  {
    number: '2',
    title: 'Rally your party',
    description: 'Pick a time and team up with neighbors ready to take action.',
  },
  {
    number: '3',
    title: 'Clean up and level up',
    description: 'Show up, restore the area together and earn XP.',
  },
] as const;

type AuthWelcomeProps = {
  onCreateAccount: () => void;
  onLogIn: () => void;
};

export default function AuthWelcome({ onCreateAccount, onLogIn }: AuthWelcomeProps) {
  const theme = useTheme();

  return (
    <View style={styles.screen}>
      <View style={[styles.hero, { backgroundColor: theme.ink, borderColor: theme.primary }]}> 
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.orb, styles.orbTop, { backgroundColor: theme.primary }]}
        />
        <View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.orb, styles.orbBottom, { backgroundColor: theme.accent }]}
        />

        <View style={styles.heroMeta}>
          <View style={[styles.questBadge, { backgroundColor: theme.reward }]}> 
            <ThemedText type="smallBold" style={{ color: theme.onReward }}>
              NEW ADVENTURE
            </ThemedText>
          </View>
          <ThemedText type="smallBold" style={{ color: theme.reward }}>
            EARN XP
          </ThemedText>
        </View>

        <Text accessibilityRole="header" style={[styles.heroTitle, { color: theme.onInk }]}> 
          Turn cleanup into an adventure.
        </Text>
        <ThemedText style={[styles.heroCopy, { color: theme.onInkSoft }]}> 
          Team up with neighbors, restore real places and level up your impact.
        </ThemedText>

        <View style={styles.heroStats}>
          <HeroStat value="LOCAL" label="quests" />
          <View style={[styles.statDivider, { backgroundColor: theme.onInkSoft }]} />
          <HeroStat value="REAL" label="impact" />
          <View style={[styles.statDivider, { backgroundColor: theme.onInkSoft }]} />
          <HeroStat value="TEAM" label="play" />
        </View>
      </View>

      <View style={styles.guide}>
        <View style={styles.sectionHeading}>
          <ThemedText type="smallBold" themeColor="tint">
            HOW TO PLAY
          </ThemedText>
          <ThemedText type="subtitle">Your first quest</ThemedText>
        </View>

        <ThemedView type="backgroundElement" style={[styles.stepsCard, { borderColor: theme.border }]}> 
          {STEPS.map((step, index) => (
            <View key={step.number}>
              <View style={styles.step}>
                <View style={[styles.stepNumber, { backgroundColor: theme.tint }]}> 
                  <Text style={[styles.stepNumberText, { color: theme.onTint }]}>{step.number}</Text>
                </View>
                <View style={styles.stepCopy}>
                  <ThemedText type="smallBold">{step.title}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {step.description}
                  </ThemedText>
                </View>
              </View>
              {index < STEPS.length - 1 ? (
                <View style={[styles.stepDivider, { backgroundColor: theme.border }]} />
              ) : null}
            </View>
          ))}
        </ThemedView>
      </View>

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityHint="Opens the account creation form"
          onPress={onCreateAccount}
          style={squish([styles.primaryButton, { backgroundColor: theme.tint }])}
        >
          <ThemedText type="smallBold" themeColor="onTint" selectable={false}>
            Start your adventure
          </ThemedText>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityHint="Opens the login form"
          onPress={onLogIn}
          style={squish([styles.secondaryButton, { borderColor: theme.border }])}
        >
          <ThemedText type="smallBold" themeColor="tint" selectable={false}>
            I already have an account
          </ThemedText>
        </Pressable>

        <ThemedText type="small" themeColor="textSecondary" style={styles.centered}>
          Free to join. Community powered.
        </ThemedText>
      </View>
    </View>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  const theme = useTheme();

  return (
    <View style={styles.heroStat}>
      <Text style={[styles.statValue, { color: theme.reward }]}>{value}</Text>
      <ThemedText type="small" style={{ color: theme.onInkSoft }}>
        {label}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    gap: Spacing.four,
  },
  hero: {
    borderRadius: Spacing.four,
    borderWidth: 1,
    gap: Spacing.three,
    overflow: 'hidden',
    padding: Spacing.four,
    position: 'relative',
  },
  orb: {
    borderRadius: 999,
    opacity: 0.12,
    position: 'absolute',
  },
  orbTop: {
    height: 150,
    right: -68,
    top: -68,
    width: 150,
  },
  orbBottom: {
    bottom: -44,
    height: 96,
    left: -42,
    width: 96,
  },
  heroMeta: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  questBadge: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two + Spacing.half,
    paddingVertical: Spacing.one,
  },
  heroTitle: {
    fontFamily: DisplayFont,
    fontSize: 40,
    fontWeight: 'normal',
    letterSpacing: 0.2,
    lineHeight: 42,
    maxWidth: 310,
  },
  heroCopy: {
    lineHeight: 23,
    maxWidth: 300,
  },
  heroStats: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: Spacing.one,
  },
  heroStat: {
    alignItems: 'center',
    flex: 1,
  },
  statValue: {
    fontFamily: DisplayFont,
    fontSize: 18,
    fontWeight: 'normal',
    lineHeight: 22,
  },
  statDivider: {
    height: 28,
    opacity: 0.35,
    width: StyleSheet.hairlineWidth,
  },
  guide: {
    gap: Spacing.three,
  },
  sectionHeading: {
    gap: Spacing.one,
  },
  stepsCard: {
    borderRadius: Spacing.three,
    borderWidth: 1,
    paddingHorizontal: Spacing.three,
  },
  step: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: Spacing.three,
    paddingVertical: Spacing.three,
  },
  stepNumber: {
    alignItems: 'center',
    borderRadius: 22,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  stepNumberText: {
    fontFamily: DisplayFont,
    fontSize: 21,
    fontWeight: 'normal',
  },
  stepCopy: {
    flex: 1,
    gap: Spacing.one,
  },
  stepDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 44 + Spacing.three,
  },
  actions: {
    gap: Spacing.two,
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: Spacing.three,
    justifyContent: 'center',
    minHeight: 54,
    paddingHorizontal: Spacing.three,
  },
  secondaryButton: {
    alignItems: 'center',
    borderRadius: Spacing.three,
    borderWidth: 1.5,
    justifyContent: 'center',
    minHeight: MIN_TOUCH,
    paddingHorizontal: Spacing.three,
  },
  centered: {
    textAlign: 'center',
  },
});
