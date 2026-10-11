import { useColorScheme } from 'react-native';

/** Design tokens: quiet surfaces, 1px borders, status colors used only for meaning. */
const light = {
  background: '#F6F7F9',
  surface: '#FFFFFF',
  border: '#E3E6EB',
  text: '#111827',
  textMuted: '#6B7280',
  brand: '#1F3A5F',
  ok: '#15803D',
  warn: '#B45309',
  block: '#B91C1C',
};

const dark: typeof light = {
  background: '#0B0F14',
  surface: '#141A21',
  border: '#232B35',
  text: '#F3F4F6',
  textMuted: '#9CA3AF',
  brand: '#8FB3E0',
  ok: '#4ADE80',
  warn: '#FBBF24',
  block: '#F87171',
};

export type Palette = typeof light;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { card: 12, chip: 999 } as const;
export const type = {
  display: { fontSize: 28, fontWeight: '700' as const, lineHeight: 34 },
  title: { fontSize: 20, fontWeight: '600' as const, lineHeight: 26 },
  body: { fontSize: 16, fontWeight: '400' as const, lineHeight: 22 },
  label: { fontSize: 14, fontWeight: '500' as const, lineHeight: 20 },
  caption: { fontSize: 12, fontWeight: '400' as const, lineHeight: 16 },
  /** Amounts line up in columns. */
  numeric: { fontVariant: ['tabular-nums' as const] },
};

export function usePalette(): Palette {
  return useColorScheme() === 'dark' ? dark : light;
}
