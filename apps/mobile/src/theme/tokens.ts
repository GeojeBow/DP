import { useColorScheme } from 'react-native';

/** Design tokens: quiet surfaces, 1px borders, status colors used only for meaning. */
const light = {
  background: '#F3F5F9',
  surface: '#FFFFFF',
  border: '#E4E8F0',
  text: '#0F172A',
  textMuted: '#64748B',
  brand: '#3049D9',
  /** Tinted fill behind brand icons and selected chips. */
  brandSoft: '#E8ECFD',
  /** Text and icons drawn on a brand-colored surface. */
  onBrand: '#FFFFFF',
  ok: '#15803D',
  warn: '#B45309',
  block: '#B91C1C',
  /** Chart series, in order; categories pick by index. */
  chart: ['#3049D9', '#0EA5A4', '#F59E0B', '#EC4899', '#8B5CF6', '#10B981', '#F97316', '#64748B'],
};

const dark: typeof light = {
  background: '#0A0E17',
  surface: '#131A26',
  border: '#222C3D',
  text: '#F1F5F9',
  textMuted: '#94A3B8',
  brand: '#7C93FF',
  brandSoft: '#1C2547',
  onBrand: '#0A0E17',
  ok: '#4ADE80',
  warn: '#FBBF24',
  block: '#F87171',
  chart: ['#7C93FF', '#2DD4BF', '#FBBF24', '#F472B6', '#A78BFA', '#34D399', '#FB923C', '#94A3B8'],
};

export type Palette = typeof light;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { card: 18, control: 12, chip: 999 } as const;
export const type = {
  display: { fontSize: 30, fontWeight: '800' as const, lineHeight: 36, letterSpacing: -0.5 },
  hero: { fontSize: 38, fontWeight: '800' as const, lineHeight: 44, letterSpacing: -1 },
  title: { fontSize: 20, fontWeight: '600' as const, lineHeight: 26 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '500' as const, lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
  /** Amounts line up in columns. */
  numeric: { fontVariant: ['tabular-nums' as const] },
};

/** Soft lift for cards; elevation on Android, shadow elsewhere. */
export const shadow = {
  shadowColor: '#0F172A',
  shadowOpacity: 0.06,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2,
} as const;

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
