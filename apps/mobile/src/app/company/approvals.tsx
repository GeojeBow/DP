import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Chips } from '../../components/Form';
import { StatusBadge } from '../../components/StatusBadge';
import { money } from '../../features/company/format';
import { type CompanyError, companySubmissions, type Submission, toCompanyError } from '../../features/company/api';
import { useT } from '../../i18n';
import { spacing, type, usePalette } from '../../theme/tokens';

export default function ApprovalsScreen() {
  const palette = usePalette();
  const t = useT();
  const { org } = useLocalSearchParams<{ org: string }>();
  const [list, setList] = useState<Submission[] | null>(null);
  const [tab, setTab] = useState<'waiting' | 'done'>('waiting');
  const [error, setError] = useState<CompanyError | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!org) return;
      companySubmissions(org)
        .then((rows) => {
          setList(rows);
          setError(null);
        })
        .catch((e) => setError(toCompanyError(e)));
    }, [org]),
  );

  const shown = (list ?? []).filter((s) => (tab === 'waiting') === (s.status === 'submitted'));
  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content}>
      <Chips
        label=""
        options={['waiting', 'done'] as const}
        value={tab}
        labelOf={(v) => `${t(`approvals.${v}`)} ${(list ?? []).filter((s) => (v === 'waiting') === (s.status === 'submitted')).length}`}
        onChange={setTab}
      />
      {error ? <Text style={[type.body, { color: palette.block }]}>{t(`company.err.${error}`)}</Text> : null}
      <Card>
        {list === null ? <Text style={[type.body, { color: palette.textMuted }]}>{t('company.loading')}</Text> : null}
        {list !== null && shown.length === 0 ? <Text style={[type.body, { color: palette.textMuted }]}>{t('approvals.empty')}</Text> : null}
        {shown.map((s) => (
          <Pressable
            key={s.id}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/company/submission/[id]', params: { id: s.id } })}
            style={[styles.row, { borderColor: palette.border }]}
          >
            <View style={styles.flex}>
              <Text style={[type.body, { color: palette.text, fontWeight: '700' }]} numberOfLines={1}>{s.title}</Text>
              <Text style={[type.caption, { color: palette.textMuted }]} numberOfLines={1}>
                {t('approvals.line', { who: s.submitter ?? '—', n: s.item_count, date: s.submitted_at.slice(0, 10) })}
              </Text>
              {s.flagged_count ? (
                <Text style={[type.caption, { color: palette.warn, fontWeight: '700' }]}>{t('approvals.flagged', { n: s.flagged_count })}</Text>
              ) : null}
            </View>
            <View style={styles.right}>
              <Text style={[type.body, type.numeric, { color: palette.text, fontWeight: '700' }]}>{money(s.total, s.base_currency)}</Text>
              <StatusBadge status={s.status} />
            </View>
          </Pressable>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  row: { flexDirection: 'row', gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'center' },
  flex: { flex: 1, gap: 2 },
  right: { alignItems: 'flex-end', gap: 4 },
});
