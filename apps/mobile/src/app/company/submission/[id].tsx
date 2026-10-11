import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../../components/Card';
import { CategoryIcon } from '../../../components/CategoryIcon';
import { Button, TextField } from '../../../components/Form';
import { StatusBadge } from '../../../components/StatusBadge';
import {
  canApprove,
  type CompanyError,
  decideSubmission,
  myCompanies,
  submissionDetail,
  type SubmissionDetail,
  submissionFiles,
  toCompanyError,
} from '../../../features/company/api';
import { money } from '../../../features/company/format';
import { useT } from '../../../i18n';
import { radius, spacing, type, usePalette } from '../../../theme/tokens';

export default function SubmissionScreen() {
  const palette = usePalette();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [sub, setSub] = useState<SubmissionDetail | null>(null);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [approver, setApprover] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CompanyError | null>(null);
  const [needReason, setNeedReason] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const detail = await submissionDetail(id);
      setSub(detail);
      const companies = await myCompanies();
      setApprover(canApprove(companies.find((c) => c.id === detail.org_id)?.role));
      const rows = await submissionFiles(id);
      setFiles(Object.fromEntries(rows.map((r) => [r.receipt_id, r.uri])));
    } catch (e) {
      setError(toCompanyError(e));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (approve: boolean) => {
    if (!sub) return;
    if (!approve && !comment.trim()) {
      setNeedReason(true);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await decideSubmission(sub.id, approve, comment);
      await load();
    } catch (e) {
      setError(toCompanyError(e));
    } finally {
      setBusy(false);
    }
  };

  if (!sub) {
    return (
      <View style={[styles.content, { backgroundColor: palette.background, flex: 1 }]}>
        <Text style={[type.body, { color: error ? palette.block : palette.textMuted }]}>
          {error ? t(`company.err.${error}`) : t('company.loading')}
        </Text>
      </View>
    );
  }

  const snap = sub.snapshot;
  const fieldName = new Map(snap.fields.map((f) => [f.id, f.name]));
  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card>
        <View style={styles.head}>
          <Text style={[type.title, styles.flex, { color: palette.text }]}>{sub.title}</Text>
          <StatusBadge status={sub.status} />
        </View>
        <Text style={[type.caption, { color: palette.textMuted }]}>{sub.period}</Text>
        <Text style={[type.display, type.numeric, { color: palette.text }]}>{money(sub.total, sub.base_currency)}</Text>
        <Text style={[type.caption, { color: palette.textMuted }]}>
          {t('submission.by', { who: sub.submitter ?? '—', date: sub.submitted_at.slice(0, 16).replace('T', ' ') })}
        </Text>
        {sub.decided_at ? (
          <Text style={[type.caption, { color: palette.textMuted }]}>
            {t('submission.decided', { status: t(`status.${sub.status}`), who: sub.decider ?? '—', date: sub.decided_at.slice(0, 16).replace('T', ' ') })}
          </Text>
        ) : null}
        {sub.comment ? (
          <View style={[styles.comment, { backgroundColor: palette.brandSoft }]}>
            <Text style={[type.body, { color: palette.text }]}>“{sub.comment}”</Text>
          </View>
        ) : null}
      </Card>

      {approver && sub.status === 'submitted' ? (
        <Card title={t('submission.comment')}>
          <TextField
            label=""
            value={comment}
            onChangeText={(v) => {
              setComment(v);
              setNeedReason(false);
            }}
            placeholder={t('submission.commentPh')}
            multiline
            error={needReason ? t('submission.needReason') : null}
          />
          <View style={styles.actions}>
            <View style={styles.flex}>
              <Button title={t('submission.reject')} variant="danger" onPress={() => decide(false)} disabled={busy} />
            </View>
            <View style={styles.flex}>
              <Button title={t('submission.approve')} onPress={() => decide(true)} disabled={busy} />
            </View>
          </View>
        </Card>
      ) : null}
      {error ? <Text style={[type.body, { color: palette.block }]}>{t(`company.err.${error}`)}</Text> : null}

      <Card title={t('submission.items', { n: snap.expenses.length })}>
        {snap.expenses.map((e) => {
          const notes = snap.notes[e.id] ?? [];
          const extra = Object.entries(e.custom ?? {}).filter(([k, v]) => fieldName.has(k) && v);
          const photo = e.receiptId ? files[e.receiptId] : undefined;
          return (
            <View key={e.id} style={[styles.item, { borderColor: palette.border }]}>
              <View style={styles.head}>
                <CategoryIcon category={e.category} size={30} />
                <View style={styles.flex}>
                  <Text style={[type.body, { color: palette.text, fontWeight: '600' }]} numberOfLines={1}>
                    {e.merchantName || t('expense.noMerchant')}
                  </Text>
                  <Text style={[type.caption, { color: palette.textMuted }]}>
                    {e.localDate} · {t(`category.${e.category}`)} · {t(`payment.${e.paymentMethod}`)}
                    {e.receiptId ? '' : t('expense.noReceipt')}
                  </Text>
                </View>
                <View style={styles.right}>
                  <Text style={[type.body, type.numeric, { color: palette.text, fontWeight: '600' }]}>{money(e.totalBase, e.baseCurrency)}</Text>
                  {e.currency !== e.baseCurrency ? (
                    <Text style={[type.caption, type.numeric, { color: palette.textMuted }]}>
                      {money(e.total, e.currency)} × {e.fxRate}
                    </Text>
                  ) : null}
                </View>
              </View>
              {extra.map(([k, v]) => (
                <Text key={k} style={[type.caption, { color: palette.textMuted }]}>
                  {fieldName.get(k)}: {v}
                </Text>
              ))}
              {e.memo ? <Text style={[type.caption, { color: palette.textMuted }]}>{e.memo}</Text> : null}
              {notes.map((n) => (
                <View key={n} style={styles.note}>
                  <Ionicons name="alert-circle" size={14} color={palette.warn} />
                  <Text style={[type.caption, { color: palette.warn, fontWeight: '700' }]}>{n}</Text>
                </View>
              ))}
              {photo ? <Image source={{ uri: photo }} style={[styles.photo, { borderColor: palette.border }]} resizeMode="contain" /> : null}
            </View>
          );
        })}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
  right: { alignItems: 'flex-end', gap: 2 },
  comment: { borderRadius: radius.control, padding: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  item: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.sm, gap: 4 },
  note: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  photo: { width: '100%', height: 220, borderRadius: radius.control, borderWidth: 1, marginTop: 4 },
});
