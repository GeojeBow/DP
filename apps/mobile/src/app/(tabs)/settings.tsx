import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { type Href, router, useFocusEffect } from 'expo-router';
import { type ComponentProps, type ReactNode, useCallback, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Chips } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { NavRow, ToggleRow } from '../../components/SettingRow';
import { companyPolicyOf, policyMode } from '../../features/policy/rules';
import { currentEmail } from '../../features/sync/account';
import { LANGUAGE_NAMES, LANGUAGES, useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { spacing, THEMES, type, usePalette } from '../../theme/tokens';

export default function SettingsScreen() {
  const palette = usePalette();
  const t = useT();
  const language = useAppStore((s) => s.language);
  const setLanguage = useAppStore((s) => s.setLanguage);
  const theme = useAppStore((s) => s.theme);
  const trips = useAppStore((s) => s.trips);
  const activeTripId = useAppStore((s) => s.activeTripId);
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

  const policy = useAppStore((s) => companyPolicyOf(s.policies));
  const active = trips.find((x) => x.id === activeTripId);
  const go = (path: Href) => () => router.push(path);

  return (
    <Screen title={t('tab.settings')} subtitle={t('settings.subtitle')}>
      <Section icon="person-circle-outline" title={t('settings.group.account')}>
        <NavRow
          icon={email ? 'cloud-done-outline' : 'cloud-offline-outline'}
          title={email ? t('settings.accountManage') : t('settings.accountOpen')}
          detail={email ? t('settings.accountOn', { email }) : t('settings.accountGuest')}
          onPress={go('/account')}
        />
        <NavRow icon="business-outline" title={t('settings.company')} detail={t('settings.companyShort')} onPress={go('/company')} last />
      </Section>

      <Section icon="briefcase-outline" title={t('settings.group.trips')}>
        <NavRow
          icon="time-outline"
          title={t('settings.history')}
          detail={t('settings.historyBody')}
          value={t('settings.historyCount', { n: trips.length })}
          onPress={go('/trips')}
          last
        />
      </Section>

      <Section icon="shield-checkmark-outline" title={t('settings.group.company')}>
        <NavRow
          icon="wallet-outline"
          title={t('settings.rules')}
          detail={t('settings.rulesBody')}
          value={t('settings.rulesCount', { n: ruleCount })}
          onPress={() => router.push({ pathname: '/rules', params: { scope: 'company' } })}
        />
        <NavRow
          icon="create-outline"
          title={t('settings.fields')}
          detail={t('settings.fieldsShort')}
          value={fieldCount ? t('settings.fieldsCount', { n: fieldCount }) : undefined}
          onPress={go('/fields')}
          last
        />
        {active && policyMode(active) === 'trip' ? (
          <Text style={[type.caption, { color: palette.textMuted }]}>{t('settings.rulesTripNote', { trip: active.title })}</Text>
        ) : null}
        {policy.budget.kind === 'none' && !policy.perDiem && ruleCount === 0 ? (
          <Text style={[type.caption, { color: palette.textMuted }]}>{t('settings.rulesEmpty')}</Text>
        ) : null}
      </Section>

      <Section icon="options-outline" title={t('settings.group.habits')}>
        <ToggleRow
          icon="swap-horizontal-outline"
          title={t('settings.rememberFx')}
          detail={t('settings.rememberFxBody')}
          value={rememberFx}
          onChange={setRememberFx}
          last={Platform.OS === 'web'}
        />
        {Platform.OS !== 'web' ? (
          <ToggleRow
            icon="notifications-outline"
            title={t('settings.reminders')}
            detail={t('settings.remindersBody')}
            value={reminders}
            onChange={setReminders}
            last
          />
        ) : null}
      </Section>

      <Section icon="color-palette-outline" title={t('settings.group.look')}>
        <NavRow icon={THEMES[theme].doodles[0] ?? 'color-palette-outline'} title={t('settings.theme')} value={t(`theme.${theme}`)} onPress={go('/theme')} />
        <View style={styles.language}>
          <Chips label={t('settings.language')} options={LANGUAGES} value={language} labelOf={(l) => LANGUAGE_NAMES[l]} onChange={setLanguage} />
        </View>
      </Section>

      <Text style={[type.caption, styles.version, { color: palette.textMuted }]}>
        {t('settings.version', { version: Constants.expoConfig?.version ?? '' })}
      </Text>
    </Screen>
  );
}

/** A titled group of settings. */
function Section({ icon, title, children }: { icon: ComponentProps<typeof Ionicons>['name']; title: string; children: ReactNode }) {
  const palette = usePalette();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={16} color={palette.textMuted} />
        <Text style={[type.label, { color: palette.textMuted, fontWeight: '700' }]}>{title}</Text>
      </View>
      <Card>{children}</Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.xs },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.xs },
  language: { paddingTop: spacing.sm },
  version: { textAlign: 'center' },
});
