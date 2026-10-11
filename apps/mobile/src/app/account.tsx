import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';

import { Card } from '../components/Card';
import { Button, TextField } from '../components/Form';
import { type AccountError, currentEmail, signIn, signOut, signUp } from '../features/sync/account';
import { syncNow } from '../features/sync/engine';
import { useT } from '../i18n';
import { useAppStore } from '../store/useAppStore';
import { spacing, type, usePalette } from '../theme/tokens';

export default function AccountScreen() {
  const palette = usePalette();
  const t = useT();
  const outbox = useAppStore((s) => s.outbox.length);
  const syncedAt = useAppStore((s) => s.syncedAt);

  const [email, setEmail] = useState<string | null | undefined>(undefined);
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AccountError | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);
  const [confirmUnsent, setConfirmUnsent] = useState(false);

  useEffect(() => {
    currentEmail().then(setEmail);
  }, []);

  const run = async (action: typeof signUp) => {
    setBusy(true);
    setError(null);
    const problem = await action(form.email, form.password);
    setBusy(false);
    if (problem) setError(problem);
    else setEmail(await currentEmail());
  };

  const sync = async () => {
    setBusy(true);
    setSyncFailed((await syncNow()) === 'failed');
    setBusy(false);
  };

  const leave = async () => {
    setBusy(true);
    const done = await signOut(confirmUnsent);
    setBusy(false);
    if (!done) {
      setConfirmUnsent(true);
      return;
    }
    router.back();
  };

  if (email === undefined) return null;

  if (email) {
    return (
      <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content}>
        <Card title={t('account.signedIn', { email })}>
          <Text style={[type.body, { color: palette.textMuted }]}>
            {t('account.synced', { time: syncedAt ? new Date(syncedAt).toLocaleString() : t('account.never') })}
          </Text>
          {outbox ? <Text style={[type.body, { color: palette.warn }]}>{t('account.pending', { n: outbox })}</Text> : null}
          {syncFailed ? <Text style={[type.body, { color: palette.block }]}>{t('account.syncFailed')}</Text> : null}
          <Button title={busy ? t('account.working') : t('account.syncNow')} onPress={sync} disabled={busy} />
        </Card>
        <Card>
          <Text style={[type.caption, { color: confirmUnsent ? palette.block : palette.textMuted }]}>
            {confirmUnsent ? t('account.signOutUnsent') : t('account.signOutNote')}
          </Text>
          <Button title={t('account.signOut')} variant="danger" onPress={leave} disabled={busy} />
        </Card>
      </ScrollView>
    );
  }

  const ready = form.email.includes('@') && form.password.length >= 6 && !busy;
  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Card title={t('screen.account')}>
        <Text style={[type.body, { color: palette.textMuted }]}>{t('account.intro')}</Text>
        <TextField
          label={t('account.email')}
          value={form.email}
          onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          placeholder="name@company.com"
        />
        <TextField
          label={t('account.password')}
          value={form.password}
          onChangeText={(v) => setForm((f) => ({ ...f, password: v }))}
          secureTextEntry
          autoCapitalize="none"
          autoComplete="password"
          error={error ? t(`account.err.${error}`) : null}
        />
        <Button title={busy ? t('account.working') : t('account.signUp')} onPress={() => run(signUp)} disabled={!ready} />
        <Button title={t('account.signIn')} variant="secondary" onPress={() => run(signIn)} disabled={!ready} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
});
