import { useEffect, useState } from 'react';
import { AccessibilityInfo, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { displayStyles, squish } from '@/components/quest-ui';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Reward } from '@/lib/api';

// The XP counts up after the card pops in, then lands with a bump and a burst of sparkles.
const COUNT_DELAY_MS = 250;
const COUNT_MS = 900;
const LAND_MS = COUNT_DELAY_MS + COUNT_MS;
const RAYS = 12;
const SPARKLES = 12;

interface RewardPopupProps {
  // The reward to show, or null for none.
  reward: Reward | null;
  // Whether the signed-in user led the cleanup and ended it themselves.
  isLeader: boolean;
  onCollect: (reward: Reward) => void;
}

function minutesText(minutes: number) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function headline(reward: Reward) {
  return reward.outcome === 'completed' ? 'Quest complete' : 'Cleanup ended';
}

// The XP a cleanup earned the user, shown once over whatever screen is open.
export function RewardPopup({ reward, isLeader, onCollect }: RewardPopupProps) {
  return (
    <Modal
      visible={reward !== null}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => reward && onCollect(reward)}>
      <View style={styles.backdrop}>
        {/* A new reward starts its animation over. */}
        {reward ? <RewardCard key={reward.partyId} reward={reward} isLeader={isLeader} onCollect={onCollect} /> : null}
      </View>
    </Modal>
  );
}

function RewardCard({ reward, isLeader, onCollect }: { reward: Reward; isLeader: boolean; onCollect: (r: Reward) => void }) {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const shown = useCountUp(reward.xp, !reduceMotion);
  const earned = reward.xp > 0;

  const entrance = useSharedValue(reduceMotion ? 1 : 0);
  const bump = useSharedValue(1);
  const spin = useSharedValue(0);

  useEffect(() => {
    const spoken = earned ? `You earned ${reward.xp.toLocaleString()} XP.` : 'No XP this time.';
    AccessibilityInfo.announceForAccessibility(`${headline(reward)}. ${spoken}`);
    if (reduceMotion) return;
    entrance.set(withSpring(1, { damping: 13, stiffness: 160 }));
    spin.set(withRepeat(withTiming(360, { duration: 24_000, easing: Easing.linear }), -1));
    if (earned) {
      bump.set(
        withDelay(LAND_MS, withSequence(withTiming(1.18, { duration: 120 }), withSpring(1, { damping: 8, stiffness: 220 }))),
      );
    }
  }, [reward, earned, reduceMotion, entrance, spin, bump]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: interpolate(entrance.get(), [0, 0.4], [0, 1], 'clamp'),
    transform: [{ scale: interpolate(entrance.get(), [0, 1], [0.8, 1]) }],
  }));
  const raysStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get()}deg` }] }));
  const numberStyle = useAnimatedStyle(() => ({ transform: [{ scale: bump.get() }] }));

  const sparkleColors = [theme.reward, theme.onInkSoft, theme.onInk];
  const details = [
    { label: 'Time on site', value: minutesText(reward.minutesOnSite) },
    ...(reward.bonusXp > 0 ? [{ label: 'Hotspot bonus', value: `+${reward.bonusXp.toLocaleString()} XP` }] : []),
    { label: 'Bags filled', value: reward.bagCount.toLocaleString() },
  ];

  return (
    <Animated.View style={[styles.card, { backgroundColor: theme.ink }, cardStyle]} accessibilityViewIsModal>
      <View style={styles.burst}>
        <Animated.View style={[styles.rays, raysStyle]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Rays color={theme.reward} />
        </Animated.View>
        {earned && !reduceMotion
          ? Array.from({ length: SPARKLES }, (_, i) => (
              <Sparkle
                key={i}
                angle={(i / SPARKLES) * 2 * Math.PI + (i % 2) * 0.2}
                distance={i % 3 === 0 ? 132 : 104}
                delay={LAND_MS + (i % 4) * 30}
                color={sparkleColors[i % sparkleColors.length]}
              />
            ))
          : null}
        <Animated.View
          style={[styles.amount, numberStyle]}
          accessible
          accessibilityLabel={`${reward.xp.toLocaleString()} XP earned`}>
          <ThemedText style={[displayStyles.base, styles.number, { color: theme.reward }]}>
            +{shown.toLocaleString()}
          </ThemedText>
          <ThemedText style={[displayStyles.base, styles.unit, { color: theme.reward }]}>XP</ThemedText>
        </Animated.View>
      </View>

      <View style={styles.text}>
        <ThemedText accessibilityRole="header" style={[displayStyles.base, styles.headline, { color: theme.onInk }]}>
          {headline(reward)}
        </ThemedText>
        <ThemedText type="smallBold" style={[styles.centered, { color: theme.onInkSoft }]} numberOfLines={2}>
          {reward.questTitle}
        </ThemedText>
        <ThemedText type="small" style={[styles.centered, { color: theme.onInkSoft }]}>
          {[
            isLeader ? null : `@${reward.leader.username} ended the cleanup.`,
            earned
              ? null
              : "XP comes from your time on site. Keep the app open while you clean so it can count you there.",
            reward.outcome === 'partial' ? 'The quest stays open for the next group.' : null,
          ]
            .filter(Boolean)
            .join(' ')}
        </ThemedText>
      </View>

      <View style={[styles.details, { borderColor: theme.onInkSoft }]}>
        {details.map((detail) => (
          <View key={detail.label} style={styles.detail} accessible accessibilityLabel={`${detail.label}: ${detail.value}`}>
            <ThemedText type="small" style={{ color: theme.onInkSoft }}>
              {detail.label}
            </ThemedText>
            <ThemedText type="smallBold" style={{ color: theme.onInk }}>
              {detail.value}
            </ThemedText>
          </View>
        ))}
      </View>

      <Pressable
        onPress={() => onCollect(reward)}
        accessibilityRole="button"
        style={squish([styles.collect, { backgroundColor: theme.reward }])}>
        <ThemedText style={[displayStyles.base, styles.collectLabel, { color: theme.onReward }]}>
          {earned ? 'Collect XP' : 'Done'}
        </ThemedText>
      </Pressable>
    </Animated.View>
  );
}

// Counts from 0 up to `target` with an ease-out, or shows `target` at once when `animate` is off.
function useCountUp(target: number, animate: boolean): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    let startedAt: number | null = null;
    const step = (time: number) => {
      startedAt ??= time;
      const progress = Math.min(1, (time - startedAt) / COUNT_MS);
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    const timeout = setTimeout(() => {
      frame = requestAnimationFrame(step);
    }, COUNT_DELAY_MS);
    return () => {
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
    };
  }, [target, animate]);
  return animate ? value : target;
}

// Light rays behind the XP, like a treasure chest opening.
function Rays({ color }: { color: string }) {
  const half = Math.PI / RAYS / 2;
  const wedges = Array.from({ length: RAYS }, (_, i) => {
    const angle = (i / RAYS) * 2 * Math.PI;
    const point = (a: number) => `${(Math.cos(a) * 100).toFixed(2)} ${(Math.sin(a) * 100).toFixed(2)}`;
    return `M0 0 L${point(angle - half)} L${point(angle + half)} Z`;
  });
  return (
    <Svg width="100%" height="100%" viewBox="-100 -100 200 200">
      {wedges.map((d) => (
        <Path key={d} d={d} fill={color} opacity={0.16} />
      ))}
    </Svg>
  );
}

function Sparkle({ angle, distance, delay, color }: { angle: number; distance: number; delay: number; color: string }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.set(withDelay(delay, withTiming(1, { duration: 700, easing: Easing.out(Easing.quad) })));
  }, [progress, delay]);
  const style = useAnimatedStyle(() => {
    const p = progress.get();
    return {
      opacity: interpolate(p, [0, 0.05, 0.7, 1], [0, 1, 1, 0]),
      transform: [
        { translateX: Math.cos(angle) * distance * p },
        { translateY: Math.sin(angle) * distance * p },
        { scale: interpolate(p, [0, 0.3, 1], [0.3, 1, 0.5]) },
        { rotate: '45deg' },
      ],
    };
  });
  return (
    <Animated.View
      style={[styles.sparkle, { backgroundColor: color }, style]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.three,
    backgroundColor: 'rgba(8, 24, 17, 0.72)',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 28,
    padding: Spacing.four,
    gap: Spacing.three,
    overflow: 'hidden',
  },
  burst: {
    height: 150,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rays: {
    position: 'absolute',
    width: 420,
    height: 420,
  },
  sparkle: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 2,
  },
  amount: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: Spacing.two,
  },
  number: {
    fontSize: 72,
    lineHeight: 84,
  },
  unit: {
    fontSize: 32,
    lineHeight: 40,
  },
  text: {
    alignItems: 'center',
    gap: Spacing.one + Spacing.half,
  },
  headline: {
    fontSize: 32,
    lineHeight: 38,
    textAlign: 'center',
  },
  centered: {
    textAlign: 'center',
  },
  details: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.three,
    gap: Spacing.two,
  },
  detail: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.three,
  },
  collect: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: 16,
  },
  collectLabel: {
    fontSize: 22,
    lineHeight: 28,
  },
});
