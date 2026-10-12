import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { usePalette } from '../theme/tokens';

/** The app's name as a logo: "trip" in ink, "cut" in the brand color, with a small scissors mark. */
export function Wordmark({ size = 22 }: { size?: number }) {
  const palette = usePalette();
  return (
    <View style={styles.row} accessibilityRole="header" accessibilityLabel="Tripcut">
      <View style={[styles.badge, { backgroundColor: palette.brand, width: size * 1.15, height: size * 1.15, borderRadius: size * 0.36 }]}>
        <Ionicons name="cut" size={size * 0.72} color={palette.onBrand} style={styles.scissors} />
      </View>
      <Text style={[styles.word, { fontSize: size, lineHeight: size * 1.2, color: palette.text }]}>
        trip
        <Text style={{ color: palette.brand }}>cut</Text>
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: { alignItems: 'center', justifyContent: 'center' },
  scissors: { transform: [{ rotate: '-45deg' }] },
  word: { fontWeight: '800', letterSpacing: -0.8 },
});
