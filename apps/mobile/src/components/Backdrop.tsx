import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';

import { usePalette } from '../theme/tokens';

// Spots for the theme's doodles, scattered like stickers on a notebook.
const SPOTS: Array<{ top: string; left: string; size: number; rotate: string }> = [
  { top: '4%', left: '78%', size: 44, rotate: '-20deg' },
  { top: '14%', left: '6%', size: 26, rotate: '10deg' },
  { top: '30%', left: '84%', size: 34, rotate: '0deg' },
  { top: '44%', left: '4%', size: 32, rotate: '-12deg' },
  { top: '56%', left: '88%', size: 24, rotate: '14deg' },
  { top: '68%', left: '8%', size: 30, rotate: '8deg' },
  { top: '78%', left: '80%', size: 38, rotate: '0deg' },
  { top: '90%', left: '14%', size: 28, rotate: '-8deg' },
  { top: '94%', left: '60%', size: 22, rotate: '18deg' },
];

/** Soft color blobs and faint travel doodles behind a screen. */
export function Backdrop() {
  const palette = usePalette();
  const [a, b, c] = palette.blobs;
  const blob = [styles.blob, { opacity: palette.blobOpacity }, palette.sharp ? styles.sharp : null];
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[...blob, { backgroundColor: a, top: -120, right: -100, width: 320, height: 320 }]} />
      <View style={[...blob, { backgroundColor: b, top: 260, left: -140, width: 300, height: 300 }]} />
      <View style={[...blob, { backgroundColor: c, bottom: -120, right: -80, width: 280, height: 280 }]} />
      {SPOTS.map((d, i) => (
        <Ionicons
          key={i}
          name={palette.doodles[i % palette.doodles.length]}
          size={d.size}
          color={palette.brand}
          style={[styles.doodle, { opacity: palette.doodleOpacity, top: d.top as `${number}%`, left: d.left as `${number}%`, transform: [{ rotate: d.rotate }] }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  blob: { position: 'absolute', borderRadius: 999 },
  sharp: { borderRadius: 0, transform: [{ rotate: '45deg' }] },
  doodle: { position: 'absolute' },
});
