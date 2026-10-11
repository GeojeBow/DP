import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';

import { usePalette } from '../theme/tokens';

type IconName = ComponentProps<typeof Ionicons>['name'];

// Travel doodles scattered behind the content, like stickers on a notebook.
const DOODLES: Array<{ icon: IconName; top: string; left: string; size: number; rotate: string }> = [
  { icon: 'airplane', top: '4%', left: '78%', size: 44, rotate: '-20deg' },
  { icon: 'sparkles', top: '14%', left: '6%', size: 26, rotate: '10deg' },
  { icon: 'earth', top: '30%', left: '84%', size: 34, rotate: '0deg' },
  { icon: 'camera', top: '44%', left: '4%', size: 32, rotate: '-12deg' },
  { icon: 'heart', top: '56%', left: '88%', size: 24, rotate: '14deg' },
  { icon: 'cafe', top: '68%', left: '8%', size: 30, rotate: '8deg' },
  { icon: 'sunny', top: '78%', left: '80%', size: 38, rotate: '0deg' },
  { icon: 'location', top: '90%', left: '14%', size: 28, rotate: '-8deg' },
  { icon: 'star', top: '94%', left: '60%', size: 22, rotate: '18deg' },
];

/** Soft color blobs and faint travel doodles behind a screen. */
export function Backdrop() {
  const palette = usePalette();
  const [a, b, c] = palette.blobs;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.blob, { backgroundColor: a, top: -120, right: -100, width: 320, height: 320 }]} />
      <View style={[styles.blob, { backgroundColor: b, top: 260, left: -140, width: 300, height: 300 }]} />
      <View style={[styles.blob, { backgroundColor: c, bottom: -120, right: -80, width: 280, height: 280 }]} />
      {DOODLES.map((d) => (
        <Ionicons
          key={d.icon}
          name={d.icon}
          size={d.size}
          color={palette.brand}
          style={[styles.doodle, { top: d.top as `${number}%`, left: d.left as `${number}%`, transform: [{ rotate: d.rotate }] }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  blob: { position: 'absolute', borderRadius: 999, opacity: 0.55 },
  doodle: { position: 'absolute', opacity: 0.09 },
});
