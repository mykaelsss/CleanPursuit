import '@/global.css';

import { Platform } from 'react-native';

// App colors for light and dark mode.
// Text colors keep at least 4.5:1 contrast (WCAG AA) against background and backgroundElement.
export const Colors = {
  light: {
    text: '#243B35',
    textSecondary: '#58736A',

    background: '#F0FAE9',
    backgroundElement: '#FFFFFF',
    backgroundSelected: '#D5F1FF',

    tint: '#187A42',
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

    // Quest reward panels: deep forest green holding the gold XP and the join button, like a game's reward screen.
    ink: '#1F4A36',
    onInk: '#FFFFFF',
    onInkSoft: '#C5E5AE',

    earth: '#B58B62',
    border: '#CBE5BB',

    badge: '#8DD9C0',
    onBadge: '#243B35',

    poster: '#DABF8F',
    posterFiber: '#EFE3C8',
    posterStain: '#7A4416',
    posterInk: '#3A2414',
    posterPhoto: 'rgba(122, 74, 30, 0.12)',
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

    ink: '#2A6247',
    onInk: '#FFFFFF',
    onInkSoft: '#C5E5AE',

    earth: '#C9A37A',
    border: '#466273',

    badge: '#8DD9C0',
    onBadge: '#243B35',

    poster: '#DABF8F',
    posterFiber: '#EFE3C8',
    posterStain: '#7A4416',
    posterInk: '#3A2414',
    posterPhoto: 'rgba(122, 74, 30, 0.12)',
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
// that reads on it, and a soft fill with its text color for badges, per color scheme. All text pairs pass
// WCAG AA. Tiers also show as 1 to 4 pips, so they never rely on color alone.
export const Tiers = {
  easy: {
    pips: 1,
    fill: '#237032',
    onFill: '#FFFFFF',
    soft: { light: '#E3F5E7', dark: '#24503A' },
    onSoft: { light: '#1B5E2A', dark: '#A8EBBA' },
  },
  medium: {
    pips: 2,
    fill: '#1971C2',
    onFill: '#FFFFFF',
    soft: { light: '#E2EEFB', dark: '#1F4570' },
    onSoft: { light: '#155EA6', dark: '#B4D6FA' },
  },
  hard: {
    pips: 3,
    fill: '#6741D9',
    onFill: '#FFFFFF',
    soft: { light: '#EEE9FC', dark: '#3E3373' },
    onSoft: { light: '#5530C4', dark: '#D4C8FE' },
  },
  legendary: {
    pips: 4,
    fill: '#FAB005',
    onFill: '#243B35',
    soft: { light: '#FFF1C9', dark: '#4A3A10' },
    onSoft: { light: '#7A4200', dark: '#FFD568' },
  },
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
