import '@/global.css';

import { Platform } from 'react-native';

// App colors for light and dark mode.
// Text colors keep at least 4.5:1 contrast (WCAG AA) against background and backgroundElement.
export const Colors = {
  light: {
    text: '#000000',
    background: '#ffffff',
    backgroundElement: '#F0F0F3',
    backgroundSelected: '#E0E1E6',
    textSecondary: '#60646C',
    tint: '#187A42',
    onTint: '#ffffff',
    error: '#CE2C31',
    // The selected map pin. Blue, so it stays distinct from the green pins with red-green color blindness.
    pinSelected: '#1F6FEB',
    // Quest screen: deep ink panels with gold XP, like a game's reward screen.
    ink: '#1E1B3A',
    onInk: '#FFFFFF',
    onInkSoft: '#C9C6E8',
    xp: '#FFD43B',
    surface: '#F1F0F7',
    textOnSurface: '#5A5873',
  },
  dark: {
    text: '#ffffff',
    background: '#000000',
    backgroundElement: '#212225',
    backgroundSelected: '#2E3135',
    textSecondary: '#B0B4BA',
    tint: '#3DD68C',
    onTint: '#0B2A1A',
    error: '#FF9592',
    pinSelected: '#58A6FF',
    ink: '#2A2650',
    onInk: '#FFFFFF',
    onInkSoft: '#C9C6E8',
    xp: '#FFD43B',
    surface: '#1A1830',
    textOnSurface: '#B9B5DE',
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

// Lilita One, loaded in the root layout. A chunky display face for quest titles, XP and buttons.
// It has one weight, so never pair it with fontWeight (Android would swap in a fallback).
export const DisplayFont = 'LilitaOne_400Regular';

// Difficulty works like loot rarity. Each tier has a solid fill (pins, photo frames) with the text color
// that reads on it, and a soft fill with its text color for badges. All text pairs pass WCAG AA.
// Tiers also show as 1 to 4 pips, so they never rely on color alone.
export const Tiers = {
  easy: { pips: 1, fill: '#237032', onFill: '#FFFFFF', soft: '#E3F5E7', onSoft: '#1B5E2A' },
  medium: { pips: 2, fill: '#1971C2', onFill: '#FFFFFF', soft: '#E2EEFB', onSoft: '#155EA6' },
  hard: { pips: 3, fill: '#6741D9', onFill: '#FFFFFF', soft: '#EEE9FC', onSoft: '#5530C4' },
  legendary: { pips: 4, fill: '#FAB005', onFill: '#1E1B3A', soft: '#FFF1C9', onSoft: '#7A4200' },
} as const;
export const TIER_PIPS = 4;

// Party member avatar colors, all with at least 4.5:1 contrast for white initials.
export const AvatarColors = ['#C2255C', '#1971C2', '#6741D9', '#237032', '#B83E0B', '#0B7285'] as const;

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
