import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Button, Chips, TextField } from '../../components/Form';
import { QUICK_CURRENCIES } from '../../constants';
import {
  canApprove,
  canManage,
  companySubmissions,
  type CompanyError,
  createCompany,
  createInvite,
  joinCompany,
  type Member,
  members as loadMembers,
  removeMember,
  type Role,
  setMemberRole,
  toCompanyError,
} from '../../features/company/api';
import { useCompanies } from '../../features/company/useCompanies';
import { useT } from '../../i18n';
import { supabase } from '../../lib/supabase';
import { useAppStore } from '../../store/useAppStore';
import { radius, spacing, type, usePalette } from '../../theme/tokens';

const ROLES: Role[] = ['member', 'approver', 'admin'];

export default function CompanyScreen() {
  const palette = usePalette();
  const t = useT();
  const setCompany = useAppStore((s) => s.setCompany);
  const { signedIn, companies, company, error: loadError, reload } = useCompanies();

  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('KRW');
  const [code, setCode] = useState('');
  const [invite, setInvite] = useState<string | null>(null);
  const [people, setPeople] = useState<Member[]>([]);
  const [waiting, setWaiting] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<CompanyError | null>(null);
  const [me, setMe] = useState<string | null>(null);

  useEffect(() => {
    setInvite(null);
    if (!company) return;
    loadMembers(company.id).then(setPeople).catch(() => setPeople([]));
    if (canApprove(company.role)) {
      companySubmissions(company.id)
        .then((list) => setWaiting(list.filter((s) => s.status === 'submitted').length))
        .catch(() => setWaiting(0));
    }
    supabase().auth.getSession().then(({ data }) => setMe(data.session?.user.id ?? null));
  }, [company?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(toCompanyError(e));
    } finally {
      setBusy(false);
    }
  };

  const errorText = (e: CompanyError | null) =>
    e ? <Text style={[type.body, { color: palette.block }]}>{t(`company.err.${e}`)}</Text> : null;

  if (signedIn === undefined) {
    return <Text style={[type.body, styles.loading, { color: palette.textMuted }]}>{t('company.loading')}</Text>;
  }

  if (!signedIn) {
    return (
      <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content}>
        <Card title={t('screen.company')}>
          <Text style={[type.body, { color: palette.textMuted }]}>{t('company.needAccount')}</Text>
          <Button title={t('company.goAccount')} onPress={() => router.push('/account')} />
        </Card>
      </ScrollView>
    );
  }

  const createAndJoin = (
    <>
      <Card title={t('company.join')}>
        <TextField
          label={t('company.code')}
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
          autoCapitalize="characters"
          placeholder="ABCD2345"
        />
        <Button
          title={t('company.joinBtn')}
          disabled={busy || code.length !== 8}
          onPress={() =>
            act(async () => {
              setCompany(await joinCompany(code));
              setCode('');
              await reload();
            })
          }
        />
      </Card>
      <Card title={t('company.create')}>
        <Text style={[type.caption, { color: palette.textMuted }]}>{t('company.createHint')}</Text>
        <TextField label={t('company.name')} value={name} onChangeText={setName} />
        <Chips label={t('company.currency')} options={QUICK_CURRENCIES} value={currency} labelOf={(c) => c} onChange={setCurrency} />
        <Button
          title={t('company.createBtn')}
          disabled={busy || !name.trim()}
          onPress={() =>
            act(async () => {
              setCompany(await createCompany(name.trim(), currency));
              setName('');
              await reload();
            })
          }
        />
      </Card>
    </>
  );

  if (!company) {
    return (
      <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {errorText(error ?? loadError)}
        {createAndJoin}
      </ScrollView>
    );
  }

  const manage = canManage(company.role);
  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {errorText(error ?? loadError)}
      <View style={[styles.hero, { backgroundColor: palette.brand }]}>
        <Ionicons name="business" size={28} color={palette.onBrand} />
        <Text style={[type.title, { color: palette.onBrand }]}>{company.name}</Text>
        <Text style={[type.label, { color: palette.onBrand, opacity: 0.85 }]}>
          {t('company.myRole', { role: t(`role.${company.role}`) })} · {company.home_currency}
        </Text>
      </View>

      {companies.length > 1 ? (
        <Chips label={t('company.pick')} options={companies.map((c) => c.id)} value={company.id} labelOf={(id) => companies.find((c) => c.id === id)?.name ?? id} onChange={setCompany} />
      ) : null}

      {canApprove(company.role) ? (
        <Button title={t('company.inbox', { n: waiting })} onPress={() => router.push({ pathname: '/company/approvals', params: { org: company.id } })} />
      ) : null}

      {manage ? (
        <Card title={t('company.invite')}>
          <Text style={[type.caption, { color: palette.textMuted }]}>{t('company.inviteHint')}</Text>
          {invite ? (
            <>
              <Text selectable style={[styles.code, { color: palette.brand, backgroundColor: palette.brandSoft }]}>
                {invite.slice(0, 4)}-{invite.slice(4)}
              </Text>
              <Button
                title={t('company.inviteShare')}
                variant="secondary"
                onPress={() => Share.share({ message: t('company.inviteMessage', { company: company.name, code: invite }) }).catch(() => {})}
              />
            </>
          ) : (
            <Button title={t('company.inviteBtn')} disabled={busy} onPress={() => act(async () => setInvite(await createInvite(company.id)))} />
          )}
        </Card>
      ) : null}

      <Card title={t('company.members')}>
        {people.map((p) => (
          <View key={p.user_id} style={[styles.member, { borderColor: palette.border }]}>
            <View style={styles.memberHead}>
              <Ionicons name="person-circle-outline" size={22} color={palette.textMuted} />
              <Text style={[type.body, styles.flex, { color: palette.text }]} numberOfLines={1}>
                {p.email ?? '—'}
              </Text>
              {!manage || p.role === 'owner' || p.user_id === me ? (
                <Text style={[type.label, { color: palette.textMuted }]}>{t(`role.${p.role}`)}</Text>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => act(async () => {
                    await removeMember(company.id, p.user_id);
                    setPeople(await loadMembers(company.id));
                  })}
                  hitSlop={8}
                >
                  <Text style={[type.label, { color: palette.block }]}>{t('company.remove')}</Text>
                </Pressable>
              )}
            </View>
            {manage && p.role !== 'owner' && p.user_id !== me ? (
              <Chips
                label=""
                options={ROLES}
                value={p.role}
                labelOf={(r) => t(`role.${r}`)}
                onChange={(r) =>
                  act(async () => {
                    await setMemberRole(company.id, p.user_id, r);
                    setPeople(await loadMembers(company.id));
                  })
                }
              />
            ) : null}
          </View>
        ))}
      </Card>

      {company.role !== 'owner' && me ? (
        <Button
          title={t('company.leave')}
          variant="danger"
          disabled={busy}
          onPress={() =>
            act(async () => {
              await removeMember(company.id, me);
              setCompany(null);
              await reload();
            })
          }
        />
      ) : null}

      {createAndJoin}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  loading: { padding: spacing.lg },
  hero: { borderRadius: radius.card, padding: spacing.lg, gap: 4 },
  code: { fontSize: 28, fontWeight: '800', letterSpacing: 4, textAlign: 'center', paddingVertical: spacing.md, borderRadius: radius.control, overflow: 'hidden' },
  member: { borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: spacing.sm, gap: spacing.xs },
  memberHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  flex: { flex: 1 },
});
