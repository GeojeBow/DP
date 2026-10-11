import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Button, Chips } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { currentEmail } from '../../features/sync/account';
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
  const ruleCount = useAppStore((s) => s.companyRules.length);
  const fieldCount = useAppStore((s) => s.customFields.length);
  const reminders = useAppStore((s) => s.reminders);
  const setReminders = useAppStore((s) => s.setReminders);
  const rememberFx = useAppStore((s) => s.rememberFx);
  const setRememberFx = useAppStore((s) => s.setRememberFx);
  // Re-read when the screen regains focus, e.g. after signing in.
  const [email, setEmail] = useState<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      currentEmail().then(setEmail);
    }, []),
  );

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
                  <Ionicons name={p.doodles[0]} size={18} color={p.brand} style={styles.swatchIcon} />
                </View>
                <Text style={[type.caption, { color: p.text, fontWeight: '700' }]}>{t(`theme.${id}`)}</Text>
              </Pressable>
            );
          })}
        </View>
      </Card>
      <Card title={t('settings.rememberFx')}>
        <Text style={[type.body, { color: palette.textMuted }]}>{t('settings.rememberFxBody')}</Text>
        <Chips
          label={t('settings.rememberFx')}
          options={['on', 'off'] as const}
          value={rememberFx ? 'on' : 'off'}
          labelOf={(v) => t(v === 'on' ? 'settings.rememberFxOn' : 'settings.rememberFxOff')}
          onChange={(v) => setRememberFx(v === 'on')}
        />
      </Card>
      <Card title={t('settings.company')}>
        <Text style={[type.body, { color: palette.textMuted }]}>{t('settings.companyBody')}</Text>
        <Button title={t('settings.companyOpen')} variant="secondary" onPress={() => router.push('/company')} />
      </Card>
      <Card title={t('settings.rules')}>
        <Text style={[type.body, { color: palette.textMuted }]}>
          {ruleCount ? t('settings.rulesCount', { n: ruleCount }) : t('settings.rulesBody')}
        </Text>
        <Button title={t('settings.rulesOpen')} variant="secondary" onPress={() => router.push({ pathname: '/rules', params: { scope: 'company' } })} />
      </Card>
      <Card title={t('settings.fields')}>
        <Text style={[type.body, { color: palette.textMuted }]}>
          {fieldCount ? t('settings.fieldsCount', { n: fieldCount }) : t('settings.fieldsBody')}
        </Text>
        <Button title={t('settings.fieldsOpen')} variant="secondary" onPress={() => router.push('/fields')} />
      </Card>
      {Platform.OS !== 'web' ? (
        <Card title={t('settings.reminders')}>
          <Text style={[type.body, { color: palette.textMuted }]}>{t('settings.remindersBody')}</Text>
          <Chips
            label={t('settings.reminders')}
            options={['on', 'off'] as const}
            value={reminders ? 'on' : 'off'}
            labelOf={(v) => t(v === 'on' ? 'settings.remindersOn' : 'settings.remindersOff')}
            onChange={(v) => setReminders(v === 'on')}
          />
        </Card>
      ) : null}
      <Card title={t('settings.language')}>
        <Chips label="Language / 언어 / 言語" options={LANGUAGES} value={language} labelOf={(l) => LANGUAGE_NAMES[l]} onChange={setLanguage} />
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
                <Pressable
                  onPress={() => router.push({ pathname: '/trip/settings', params: { id: trip.id } })}
                  accessibilityRole="button"
                  hitSlop={8}
                  style={styles.tripEdit}
                >
                  <Text style={[type.label, { color: palette.brand }]}>{t('settings.editTrip')}</Text>
                </Pressable>
              </Pressable>
            );
          })}
        <Button title={t('settings.newTrip')} variant="secondary" onPress={() => router.push('/trip/new')} />
      </Card>
      <Card title={t('settings.account')}>
        <Text style={[type.body, { color: palette.textMuted }]}>
          {email ? t('settings.accountOn', { email }) : t('settings.accountGuest')}
        </Text>
        <Button title={email ? t('settings.accountManage') : t('settings.accountOpen')} variant="secondary" onPress={() => router.push('/account')} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  themes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  theme: { flexBasis: '30%', flexGrow: 1, alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.md, borderRadius: radius.control },
  swatches: { flexDirection: 'row', alignItems: 'center' },
  swatchIcon: { marginLeft: spacing.xs },
  swatch: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#FFFFFF' },
  swatchOverlap: { marginLeft: -8 },
  trip: { borderWidth: 1, borderRadius: 10, padding: spacing.md, gap: 2 },
  tripEdit: { position: 'absolute', right: spacing.md, top: spacing.md },
});
