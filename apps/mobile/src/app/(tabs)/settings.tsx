import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Card } from '../../components/Card';
import { Button, Chips } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { LANGUAGE_NAMES, LANGUAGES, useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { spacing, type, usePalette } from '../../theme/tokens';

export default function SettingsScreen() {
  const palette = usePalette();
  const t = useT();
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const trips = useAppStore((s) => s.trips);
  const activeTripId = useAppStore((s) => s.activeTripId);
  const setActiveTrip = useAppStore((s) => s.setActiveTrip);

  return (
    <Screen title={t('tab.settings')} subtitle={t('settings.subtitle')}>
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
  trip: { borderWidth: 1, borderRadius: 10, padding: spacing.md, gap: 2 },
});
