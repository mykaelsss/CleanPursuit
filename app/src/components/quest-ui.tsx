import { StyleSheet, View, type PressableStateCallbackType, type StyleProp, type ViewStyle } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { AvatarColors, DisplayFont, Spacing, TIER_PIPS, Tiers } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { DifficultyTier } from '@/lib/api';
import { TIER_LABELS } from '@/lib/event-format';

// Pressables shrink a little while held, like a game button giving way under a thumb.
export function squish(base: StyleProp<ViewStyle>) {
  return ({ pressed }: PressableStateCallbackType) => [base, pressed && styles.squished];
}

export function xpText(maxXp: number) {
  return `Up to ${maxXp.toLocaleString()} XP`;
}

// A quest's difficulty as rarity: filled pips out of four, plus the tier name.
export function TierBadge({ tier, solid }: { tier: DifficultyTier; solid?: boolean }) {
  const colors = Tiers[tier];
  const background = solid ? colors.fill : colors.soft;
  const foreground = solid ? colors.onFill : colors.onSoft;
  const label = TIER_LABELS[tier];
  return (
    <View
      style={[styles.badge, { backgroundColor: background }]}
      accessible
      accessibilityLabel={`${label} difficulty, ${colors.pips} of ${TIER_PIPS}`}>
      <View style={styles.pips}>
        {Array.from({ length: TIER_PIPS }, (_, i) => (
          <View
            key={i}
            style={[styles.pip, { borderColor: foreground }, i < colors.pips && { backgroundColor: foreground }]}
          />
        ))}
      </View>
      <ThemedText style={[styles.badgeText, { color: foreground }]}>{label}</ThemedText>
    </View>
  );
}

// Gold XP on ink, the reward color everywhere on the quests screen.
export function XpBadge({ maxXp }: { maxXp: number }) {
  const theme = useTheme();
  return (
    <View style={[styles.badge, { backgroundColor: theme.ink }]}>
      <ThemedText style={[styles.badgeText, { color: theme.xp }]}>{xpText(maxXp)}</ThemedText>
    </View>
  );
}

// A round avatar with the member's first initial. The color comes from the username, so it stays put.
export function Avatar({ username, size = 40 }: { username: string; size?: number }) {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) | 0;
  const color = AvatarColors[Math.abs(hash) % AvatarColors.length];
  return (
    <View
      style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants">
      <ThemedText style={[styles.avatarText, { fontSize: size * 0.45, lineHeight: size * 0.6 }]}>
        {username.charAt(0).toUpperCase()}
      </ThemedText>
    </View>
  );
}

export const displayStyles = StyleSheet.create({
  // Lilita One has a single weight, so fontWeight stays normal.
  base: {
    fontFamily: DisplayFont,
    fontWeight: 'normal',
  },
});

const styles = StyleSheet.create({
  squished: {
    transform: [{ scale: 0.97 }],
    opacity: 0.9,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: Spacing.one + Spacing.half,
    paddingVertical: Spacing.half,
    paddingHorizontal: Spacing.two + Spacing.half,
    borderRadius: Spacing.two,
  },
  badgeText: {
    fontFamily: DisplayFont,
    fontWeight: 'normal',
    fontSize: 15,
    lineHeight: 22,
  },
  pips: {
    flexDirection: 'row',
    gap: 3,
  },
  pip: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: DisplayFont,
    fontWeight: 'normal',
    color: '#FFFFFF',
  },
});
