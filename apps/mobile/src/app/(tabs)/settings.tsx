import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Button, Chips } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { LANGUAGE_NAMES, LANGUAGES, useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { radius, spacing, THEME_IDS, THEMES, type, usePalette } from '../../theme/tokens';

export default function SettingsScreen() {
  const palette = usePalette();
  const t = useT();
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const trips = useAppStore((s) => s.trips);
  const activeTripId = useAppStore((s) => s.activeTripId);
  const setActiveTrip = useAppStore((s) => s.setActiveTrip);

  return (
    <Screen title={t('tab.settings')} subtitle={t('settings.subtitle')}>
      <Card title={t('settings.theme')}>
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
                </View>
                <Text style={[type.caption, { color: p.text, fontWeight: '700' }]}>{t(`theme.${id}`)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>
      <Card title={t('settings.language')}>
        <Chips label="Language / 언어" options={LANGUAGES} value={language} labelOf={(l) => LANGUAGE_NAMES[l]} onChange={setLanguage} />
      </Card>
      <Card title={t('settings.myTrips')}>
        {[...trips]
          .sort((a, b) => b.startDate.localeCompare(a.startDate))
          .map((trip) => {
            const active = trip.id === activeTripId;
            return (
              <Pressable
                key={trip.id}
                onPress={() => setActiveTrip(trip.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.trip, { borderColor: active ? palette.brand : palette.border }]}
              >
                <Text style={[type.body, { color: palette.text, fontWeight: active ? '600' : '400' }]}>{trip.title}</Text>
                <Text style={[type.caption, { color: palette.textMuted }]}>
                  {trip.startDate} ~ {trip.endDate} · {trip.baseCurrency}
                  {active ? t('settings.active') : ''}
                </Text>
              </Pressable>
            );
          })}
        <Button title={t('settings.newTrip')} variant="secondary" onPress={() => router.push('/trip/new')} />
      </Card>
      <Card title={t('settings.data')}>
        <Text style={[type.body, { color: palette.textMuted }]}>{t('settings.dataBody')}</Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  themes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  theme: { flexBasis: '30%', flexGrow: 1, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderRadius: radius.control },
  swatches: { flexDirection: 'row' },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#FFFFFF' },
  swatchOverlap: { marginLeft: -8 },
  trip: { borderWidth: 1, borderRadius: 10, padding: spacing.md, gap: 2 },
});
