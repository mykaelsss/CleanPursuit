import '@/global.css';

import { Platform } from 'react-native';

// App colors for light and dark mode.
export const Colors = {
  light: {
    text: '#243B35',
    textSecondary: '#58736A',

    background: '#F0FAE9',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#D5F1FF',

    tint: '#1F8A4C',
    onTint: '#ffffff',
    error: '#CE2C31',

    primary: '#72C94B',
    onPrimary: '#243B35',
    header: '#A8E477',

    accent: '#18B9E0',
    highlight: '#D5F1FF',

    sage: '#C5E5AE',
    sageText: '#354B2C',

    reward: '#FFD568',
    onReward: '#49320C',

    earth: '#B58B62',
    border: '#CBE5BB',

    badge: '#8DD9C0',
    onBadge: '#243B35',

    poster: '#EBDFC4',
    posterFiber: '#F8F2E4',
    posterInk: '#3B2B20',
    posterPhoto: '#D9CBAE',
  },
  dark: {
    text: '#F3FAFF',
    textSecondary: '#B6CAD7',

    background: '#182733',
    backgroundElement: '#263C4B',
    backgroundSelected: '#285A73',

    tint: '#3DD68C',
    onTint: '#0B2A1A',
    error: '#FF9592',

    primary: '#97E56A',
    onPrimary: '#243B35',
    header: '#A8E477',

    accent: '#55D8FA',
    highlight: '#285A73',

    sage: '#C5E5AE',
    sageText: '#354B2C',

    reward: '#FFD568',
    onReward: '#49320C',

    earth: '#C9A37A',
    border: '#466273',

    badge: '#8DD9C0',
    onBadge: '#243B35',

    poster: '#EBDFC4',
    posterFiber: '#F8F2E4',
    posterInk: '#3B2B20',
    posterPhoto: '#D9CBAE',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;
