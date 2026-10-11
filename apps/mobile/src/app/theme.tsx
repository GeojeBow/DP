import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { useT } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { radius, spacing, THEME_IDS, THEMES, type, usePalette } from '../theme/tokens';

export default function ThemeScreen() {
  const palette = usePalette();
  const t = useT();
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content}>
      <Text style={[type.caption, { color: palette.textMuted }]}>{t('settings.themeHint')}</Text>
      <View style={styles.themes}>
        {THEME_IDS.map((id) => {
          const p = THEMES[id];
          const selected = id === theme;
          return (
            <Pressable
              key={id}
              onPress={() => setTheme(id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                styles.theme,
                { backgroundColor: p.background, borderColor: selected ? palette.brand : palette.border, borderWidth: selected ? 2 : 1 },
              ]}
            >
              <View style={styles.swatches}>
                <View style={[styles.swatch, { backgroundColor: p.brand }]} />
                <View style={[styles.swatch, styles.swatchOverlap, { backgroundColor: p.accent }]} />
                <View style={[styles.swatch, styles.swatchOverlap, { backgroundColor: p.blobs[0] }]} />
                <Ionicons name={p.doodles[0]} size={18} color={p.brand} style={styles.swatchIcon} />
              </View>
              <Text style={[type.caption, { color: p.text, fontWeight: '700' }]}>{t(`theme.${id}`)}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  themes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  theme: { flexBasis: '45%', flexGrow: 1, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.lg, borderRadius: radius.control },
  swatches: { flexDirection: 'row', alignItems: 'center' },
  swatchIcon: { marginLeft: spacing.xs },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#FFFFFF' },
  swatchOverlap: { marginLeft: -8 },
});
