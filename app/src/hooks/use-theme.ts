/**
 * Learn more about light and dark modes:
 * https://docs.expo.dev/guides/color-schemes/
 */

import { Colors, Tiers } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export function useTheme() {
  return Colors[useColorScheme()];
}

// A difficulty tier's colors, with its soft fill for the current color scheme.
export function useTierColors(tier: keyof typeof Tiers) {
  const scheme = useColorScheme();
  const { soft, onSoft, ...colors } = Tiers[tier];
  return { ...colors, soft: soft[scheme], onSoft: onSoft[scheme] };
}
