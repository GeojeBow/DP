import { useAppStore } from '../store/useAppStore';

/**
 * Color themes the user picks in settings. Each is a full palette; status
 * colors (ok/warn/block) keep their meaning in every theme.
 */
const peach = {
  dark: false,
  background: '#FFF6F3',
  surface: '#FFFFFF',
  border: '#F7DCD6',
  text: '#2B1B2E',
  textMuted: '#8C7287',
  brand: '#FF5C8A',
  /** Tinted fill behind brand icons and selected chips. */
  brandSoft: '#FFE3EC',
  /** Text and icons drawn on a brand-colored surface. */
  onBrand: '#FFFFFF',
  /** Second hero color; the hero blends brand into this. */
  accent: '#FF9A62',
  /** Soft background blobs behind every screen. */
  blobs: ['#FFC6D9', '#FFD9B8', '#D9CCFF'],
  ok: '#16A34A',
  warn: '#D97706',
  block: '#E11D48',
  /** Chart series, in order; categories pick by index. */
  chart: ['#FF5C8A', '#FF9A62', '#8B7CF6', '#2EC4B6', '#FFC93C', '#5BC0EB', '#F15BB5', '#A3A3B5'],
};

export type Palette = typeof peach;

const lavender: Palette = {
  ...peach,
  background: '#F7F4FF',
  border: '#E4DCFA',
  text: '#221B3A',
  textMuted: '#7B7396',
  brand: '#8B5CF6',
  brandSoft: '#EEE7FF',
  accent: '#EC6FCF',
  blobs: ['#DCCEFF', '#FFD1F0', '#C9E8FF'],
  chart: ['#8B5CF6', '#EC6FCF', '#5BC0EB', '#FFB86B', '#2EC4B6', '#FF7A9C', '#B9A6FF', '#A3A3B5'],
};

const mint: Palette = {
  ...peach,
  background: '#F2FBF7',
  border: '#D3EFE3',
  text: '#13302A',
  textMuted: '#5F8279',
  brand: '#10B39A',
  brandSoft: '#D9F6EE',
  accent: '#7BD389',
  blobs: ['#BFF0E0', '#E3F7B5', '#BDE3FF'],
  chart: ['#10B39A', '#7BD389', '#5BC0EB', '#FFB86B', '#FF7A9C', '#8B7CF6', '#FFD95A', '#A3A3B5'],
};

const ocean: Palette = {
  ...peach,
  background: '#F2F7FF',
  border: '#D6E4FA',
  text: '#0F1E3A',
  textMuted: '#62749A',
  brand: '#3B82F6',
  brandSoft: '#E0ECFF',
  accent: '#22C3E6',
  blobs: ['#C5DBFF', '#BDF1FF', '#E2D6FF'],
  chart: ['#3B82F6', '#22C3E6', '#8B7CF6', '#FFB86B', '#2EC4B6', '#FF7A9C', '#FFD95A', '#A3A3B5'],
};

const midnight: Palette = {
  dark: true,
  background: '#12101C',
  surface: '#1D1A2B',
  border: '#2E2A42',
  text: '#F5F2FF',
  textMuted: '#A49DC0',
  brand: '#FF6FB1',
  brandSoft: '#3A2140',
  onBrand: '#FFFFFF',
  accent: '#8B6CFF',
  blobs: ['#5B2A6E', '#2A3A7A', '#6B2A4A'],
  ok: '#4ADE80',
  warn: '#FBBF24',
  block: '#FB7185',
  chart: ['#FF6FB1', '#8B6CFF', '#2EE6C5', '#FFC24B', '#5BC0EB', '#FF8A5B', '#C084FC', '#8E89A8'],
};

export const THEMES = { peach, lavender, mint, ocean, midnight } as const;
export type ThemeId = keyof typeof THEMES;
export const THEME_IDS = Object.keys(THEMES) as ThemeId[];

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { card: 24, control: 16, chip: 999 } as const;
export const type = {
  display: { fontSize: 30, fontWeight: '800' as const, lineHeight: 36, letterSpacing: -0.5 },
  hero: { fontSize: 38, fontWeight: '800' as const, lineHeight: 44, letterSpacing: -1 },
  title: { fontSize: 20, fontWeight: '700' as const, lineHeight: 26 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '500' as const, lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
  /** Amounts line up in columns. */
  numeric: { fontVariant: ['tabular-nums' as const] },
};

/** Soft lift for cards; elevation on Android, shadow elsewhere. */
export const shadow = {
  shadowColor: '#7A3B5C',
  shadowOpacity: 0.08,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const;

export function usePalette(): Palette {
  return THEMES[useAppStore((s) => s.theme)] ?? peach;
}
