/**
 * Thème YouMe Intelligente — « Nuit Rose » (dark) / « Rose Clair » (light)
 * Palette rose fuchsia sur fond sombre (dark) et fond crème rose (light).
 */
import { MD3DarkTheme, MD3LightTheme } from 'react-native-paper';
import type { MD3Theme } from 'react-native-paper';
import { useMemo } from 'react';
import { useUIStore } from '../../presentation/stores/uiStore';

// ─── Couleurs brand/accent ────────────────────────────────────────────────────

export const YOUME_COLORS = {
  // Dégradé principal (rose fuchsia)
  gradientStart: '#E91E8C',
  gradientMid:   '#C2185B',
  gradientEnd:   '#120818',

  primary:      '#E91E8C',
  primaryDark:  '#C2185B',
  primaryLight: '#F48FB1',
  secondary:    '#1C0D24',

  // Surfaces & fonds — mode SOMBRE (Nuit Rose)
  background:     '#120818',
  surface:        '#1C0D24',
  surfaceVariant: '#2A1535',

  // Bulles de chat — mode SOMBRE
  bubbleOwn:      '#C2185B',
  bubbleOther:    '#2A1535',
  bubbleOwnText:  '#FFFFFF',
  bubbleOtherText:'#E8D5F0',

  // Textes — mode SOMBRE
  textPrimary:   '#E8D5F0',
  textSecondary: '#C9A8D8',
  textMuted:     '#9B7FB0',
  textLink:      '#F48FB1',

  // États & feedback
  online:    '#6EE089',
  delivered: '#F48FB1',
  read:      '#E91E8C',
  error:     '#E06A6A',
  warning:   '#E0A24C',
  success:   '#6EE089',

  // Émotions (inchangé)
  emotionJoy:      '#FFD700',
  emotionSadness:  '#6495ED',
  emotionAnger:    '#FF4444',
  emotionFear:     '#9370DB',
  emotionSurprise: '#FF8C00',
  emotionNeutral:  '#9E9E9E',

  // Cohérence IA
  coherenceHigh:   '#6EE089',
  coherenceMedium: '#E0A24C',
  coherenceLow:    '#E06A6A',

  // Interface — mode SOMBRE
  divider:         '#2E1840',
  inputBackground: '#1C0D24',
  placeholder:     '#6B5480',
  badge:           '#F9C74F',

  // Legacy light mode fields (kept for backwards compat)
  lightBackground:  '#FFF5F8',
  lightSurface:     '#FFFFFF',
  lightBubbleOwn:   '#E91E8C',
  lightBubbleOther: '#FFFFFF',
  lightTextPrimary: '#1A1A2E',
} as const;

export type YoumeColors = typeof YOUME_COLORS;

// ─── Surcharges Light (Rose Clair) ────────────────────────────────────────────

const LIGHT_OVERRIDES: Partial<YoumeColors> = {
  secondary:      '#FFF0F4',
  background:     '#FFF5F8',
  surface:        '#FFFFFF',
  surfaceVariant: '#FBDCEB',
  divider:        '#F5D0DF',
  inputBackground:'#FFFFFF',
  placeholder:    '#B07090',
  textPrimary:    '#1A1A2E',
  textSecondary:  '#8B4060',
  textMuted:      '#B07090',
  textLink:       '#C2185B',
  bubbleOwn:      '#E91E8C',
  bubbleOther:    '#FFFFFF',
  bubbleOwnText:  '#FFFFFF',
  bubbleOtherText:'#1A1A2E',
};

export function getYoumeColors(isDarkMode: boolean): YoumeColors {
  if (isDarkMode) return YOUME_COLORS;
  return { ...YOUME_COLORS, ...LIGHT_OVERRIDES } as YoumeColors;
}

export function useYoumeColors(): YoumeColors {
  const isDarkMode = useUIStore((s) => s.isDarkMode);
  return useMemo(() => getYoumeColors(isDarkMode), [isDarkMode]);
}

// ─── Thèmes React-Native-Paper ───────────────────────────────────────────────

export const YOUME_DARK_THEME: MD3Theme = {
  ...MD3DarkTheme,
  colors: {
    ...MD3DarkTheme.colors,
    primary:          YOUME_COLORS.primary,
    onPrimary:        '#FFFFFF',
    primaryContainer: YOUME_COLORS.primaryDark,
    secondary:        YOUME_COLORS.secondary,
    tertiary:         YOUME_COLORS.primaryLight,
    background:       YOUME_COLORS.background,
    surface:          YOUME_COLORS.surface,
    surfaceVariant:   YOUME_COLORS.surfaceVariant,
    onSurface:        YOUME_COLORS.textPrimary,
    onSurfaceVariant: YOUME_COLORS.textSecondary,
    outline:          YOUME_COLORS.divider,
    error:            YOUME_COLORS.error,
  },
};

export const YOUME_LIGHT_THEME: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary:          YOUME_COLORS.primary,
    onPrimary:        '#FFFFFF',
    primaryContainer: LIGHT_OVERRIDES.bubbleOwn as string,
    secondary:        LIGHT_OVERRIDES.secondary as string,
    tertiary:         YOUME_COLORS.primaryLight,
    background:       LIGHT_OVERRIDES.background as string,
    surface:          LIGHT_OVERRIDES.surface as string,
    surfaceVariant:   LIGHT_OVERRIDES.surfaceVariant as string,
    onSurface:        LIGHT_OVERRIDES.textPrimary as string,
    onSurfaceVariant: LIGHT_OVERRIDES.textSecondary as string,
    outline:          LIGHT_OVERRIDES.divider as string,
    error:            YOUME_COLORS.error,
  },
};

// ─── Autres constantes (inchangées) ──────────────────────────────────────────

export const SPACING = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
} as const;

export const BORDER_RADIUS = {
  sm:     8,
  md:     12,
  lg:     16,
  xl:     24,
  round:  50,
  bubble: 18,
} as const;

export const TYPOGRAPHY = {
  fontFamily: {
    regular: 'System',
    medium:  'System',
    bold:    'System',
    script:  'DancingScript_700Bold',
  },
  size: {
    xs:      11,
    sm:      12,
    md:      14,
    lg:      16,
    xl:      18,
    xxl:     24,
    heading: 28,
  },
} as const;

export const SHADOW = {
  sm: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius:  2,
    elevation:     2,
  },
  md: {
    shadowColor:   '#000',
    shadowOffset:  { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius:  4,
    elevation:     4,
  },
  glow: {
    shadowColor:   '#E91E8C',
    shadowOffset:  { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius:  10,
    elevation:     6,
  },
} as const;
