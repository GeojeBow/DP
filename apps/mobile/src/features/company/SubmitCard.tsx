import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Button } from '../../components/Form';
import { StatusBadge } from '../../components/StatusBadge';
import type { Expense, Trip } from '../../domain/models';
import { useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { spacing, type, usePalette } from '../../theme/tokens';
import { usePolicyFlags, useDescribeRule } from '../policy/usePolicy';
import { type CompanyError, submit, type Submission, toCompanyError, tripSubmissions } from './api';
import { buildSubmission } from './snapshot';
import { rulesForTrip } from '../policy/rules';
import { useCompanies } from './useCompanies';

/** Sends the trip to the company for approval and shows where it stands. */
export function SubmitCard({ trip, expenses }: { trip: Trip; expenses: readonly Expense[] }) {
  const palette = usePalette();
  const t = useT();
  const { signedIn, company } = useCompanies();
  const customFields = useAppStore((s) => s.customFields);
  const defaults = useAppStore((s) => s.companyRules);
  const rules = rulesForTrip(trip, defaults);
  const flags = usePolicyFlags();
  const describe = useDescribeRule();

  const [last, setLast] = useState<Submission | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CompanyError | null>(null);
  const [done, setDone] = useState(false);

  const refresh = useCallback(() => {
    setConfirm(false);
    setDone(false);
    tripSubmissions(trip.id)
      .then((rows) => setLast(rows.find((r) => r.org_id === company?.id) ?? null))
      .catch(() => setLast(null));
  }, [trip.id, company?.id]);
  useFocusEffect(refresh);

  if (signedIn === undefined) return null;

  if (!signedIn || !company) {
    return (
      <Card title={t('submit.title')}>
        <Text style={[type.caption, { color: palette.textMuted }]}>{t(signedIn ? 'submit.noCompany' : 'submit.noAccount')}</Text>
        <Button title={signedIn ? t('submit.setup') : t('company.goAccount')} variant="secondary" onPress={() => router.push(signedIn ? '/company' : '/account')} />
      </Card>
    );
  }

  const send = async () => {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const notes: Record<string, string[]> = {};
      for (const e of expenses) {
        const list = (flags.get(e.id) ?? []).flatMap((f) => {
          const rule = rules.find((r) => r.id === f.ruleId);
          return rule ? [describe(rule)] : [];
        });
        if (list.length) notes[e.id] = Array.from(new Set(list));
      }
      await submit(buildSubmission(company.id, trip, expenses, customFields, notes));
      setDone(true);
      setConfirm(false);
      const rows = await tripSubmissions(trip.id);
      setLast(rows.find((r) => r.org_id === company.id) ?? null);
    } catch (e) {
      setError(toCompanyError(e));
    } finally {
      setBusy(false);
    }
  };

  const pending = last?.status === 'submitted';
  return (
    <Card title={t('submit.title')}>
      {last ? (
        <View style={{ gap: spacing.xs }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <StatusBadge status={last.status} />
            <Text style={[type.caption, { color: palette.textMuted }]}>
              {t('submit.last', { status: t(`status.${last.status}`), date: last.submitted_at.slice(0, 10) })}
            </Text>
          </View>
          {last.comment ? <Text style={[type.body, { color: palette.text }]}>{t('submit.reason', { comment: last.comment })}</Text> : null}
        </View>
      ) : null}
      {done ? <Text style={[type.body, { color: palette.ok, fontWeight: '700' }]}>{t('submit.done')}</Text> : null}
      {confirm ? <Text style={[type.caption, { color: palette.warn }]}>{t('submit.confirm')}</Text> : null}
      {error ? <Text style={[type.body, { color: palette.block }]}>{t(`company.err.${error}`)}</Text> : null}
      {expenses.length === 0 ? <Text style={[type.caption, { color: palette.textMuted }]}>{t('submit.empty')}</Text> : null}
      {!pending ? (
        <Button
          title={last ? t('submit.again') : t('submit.to', { company: company.name })}
          onPress={send}
          disabled={busy || expenses.length === 0}
        />
      ) : null}
      {last ? (
        <Button title={t('submit.view')} variant="secondary" onPress={() => router.push({ pathname: '/company/submission/[id]', params: { id: last.id } })} />
      ) : null}
    </Card>
  );
}
