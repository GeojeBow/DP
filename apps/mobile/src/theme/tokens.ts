import type Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';

import { useAppStore } from '../store/useAppStore';

export type IconName = ComponentProps<typeof Ionicons>['name'];

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
  /** Faint icons scattered behind every screen; nine of them. */
  doodles: ['airplane', 'sparkles', 'earth', 'camera', 'heart', 'cafe', 'sunny', 'location', 'star'] as IconName[],
  doodleOpacity: 0.09,
  blobOpacity: 0.55,
  /** Blobs drawn as tilted squares instead of circles, for harder themes. */
  sharp: false,
  cardRadius: 24,
  cardBorder: 0.5,
  /** Cards glow in this color instead of casting a soft shadow. */
  glow: null as string | null,
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
  ...peach,
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

/** Quiet anime afternoon: summer sky, grass and cream paper. */
const breeze: Palette = {
  ...peach,
  background: '#F4F8F1',
  surface: '#FFFDF6',
  border: '#DCE8D5',
  text: '#2E3A2F',
  textMuted: '#7A8A78',
  brand: '#5B9BD5',
  brandSoft: '#E1EEF9',
  accent: '#8CC084',
  blobs: ['#CDE6F7', '#E2F1C9', '#FBE7C6'],
  chart: ['#5B9BD5', '#8CC084', '#F2B880', '#E89AAE', '#9DB4E0', '#C9B26B', '#7FC6B8', '#B5B5A8'],
  doodles: ['cloudy', 'leaf', 'flower', 'train', 'sunny', 'umbrella', 'bicycle', 'partly-sunny', 'sparkles'],
  doodleOpacity: 0.12,
  blobOpacity: 0.7,
};

/** Japanese city pop at night: sunset pink and teal over navy. */
const citypop: Palette = {
  ...peach,
  dark: true,
  background: '#1B1838',
  surface: '#26224A',
  border: '#3A3466',
  text: '#FFF4F8',
  textMuted: '#B4AACF',
  brand: '#FF7EB6',
  brandSoft: '#4A2550',
  onBrand: '#1B1838',
  accent: '#3FD7D0',
  blobs: ['#FF7EB6', '#FFB26B', '#3FD7D0'],
  ok: '#5EE6A0',
  warn: '#FFC857',
  block: '#FF6B8B',
  chart: ['#FF7EB6', '#3FD7D0', '#FFB26B', '#A88BFF', '#FFE066', '#6FB7FF', '#FF8A65', '#8E89A8'],
  doodles: ['moon', 'car-sport', 'musical-notes', 'sparkles', 'radio', 'glasses', 'star', 'water', 'planet'],
  doodleOpacity: 0.12,
  blobOpacity: 0.28,
  glow: '#FF7EB6',
};

/** Club night: black floor, neon lime and magenta. */
const neon: Palette = {
  ...peach,
  dark: true,
  background: '#0A0A0F',
  surface: '#15151F',
  border: '#2A2A3A',
  text: '#F7F7FF',
  textMuted: '#9A9AB5',
  brand: '#C6FF3D',
  brandSoft: '#2A3312',
  onBrand: '#0A0A0F',
  accent: '#FF2E9A',
  blobs: ['#FF2E9A', '#7B2CFF', '#00E5FF'],
  ok: '#4ADE80',
  warn: '#FFD23D',
  block: '#FF4D6D',
  chart: ['#C6FF3D', '#FF2E9A', '#00E5FF', '#FFD23D', '#7B2CFF', '#FF8A3D', '#4ADE80', '#8E8EA8'],
  doodles: ['headset', 'mic', 'disc', 'flash', 'diamond', 'musical-notes', 'flame', 'game-controller', 'sparkles'],
  doodleOpacity: 0.16,
  blobOpacity: 0.22,
  cardRadius: 18,
  cardBorder: 1,
  glow: '#C6FF3D',
};

/** Heavy metal: black iron, blood red and steel, hard edges. */
const metal: Palette = {
  ...peach,
  dark: true,
  background: '#0B0B0B',
  surface: '#171717',
  border: '#3A3A3A',
  text: '#EDEDED',
  textMuted: '#9C9C9C',
  brand: '#D7192A',
  brandSoft: '#3A0E12',
  onBrand: '#FFFFFF',
  accent: '#8E8E8E',
  blobs: ['#5A0A10', '#2B2B2B', '#3D0F0F'],
  ok: '#5FBF6A',
  warn: '#E0A030',
  block: '#FF3B3B',
  chart: ['#D7192A', '#B0B0B0', '#E0A030', '#6E6E6E', '#FF5A36', '#8A1C1C', '#D9D9D9', '#4A4A4A'],
  doodles: ['skull', 'flame', 'flash', 'thunderstorm', 'bonfire', 'skull-outline', 'nuclear', 'rose', 'moon'],
  doodleOpacity: 0.11,
  blobOpacity: 0.45,
  sharp: true,
  cardRadius: 4,
  cardBorder: 1.5,
  glow: '#D7192A',
};

export const THEMES = { peach, lavender, mint, ocean, midnight, breeze, citypop, neon, metal } as const;
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
