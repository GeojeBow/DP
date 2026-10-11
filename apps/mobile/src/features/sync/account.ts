import { supabase } from '../../lib/supabase';
import { useAppStore } from '../../store/useAppStore';
import { syncNow, withoutTracking } from './engine';
import { allKeys } from './records';

export type AccountError = 'exists' | 'credentials' | 'weak' | 'email' | 'network' | 'other';

function toAccountError(e: { code?: string; message?: string; status?: number } | null): AccountError {
  const code = e?.code ?? '';
  if (code === 'user_already_exists' || code === 'email_exists') return 'exists';
  if (code === 'invalid_credentials') return 'credentials';
  if (code === 'weak_password') return 'weak';
  if (code === 'email_address_invalid' || code === 'validation_failed') return 'email';
  if (!e?.status) return 'network';
  return 'other';
}

/** After signing in, this device's guest data joins the account and the account's data comes down. */
async function afterSignIn(): Promise<void> {
  const s = useAppStore.getState();
  s.enqueue(allKeys(s));
  s.setSynced({ lastPulledAt: null });
  await syncNow();
}

export async function signUp(email: string, password: string): Promise<AccountError | null> {
  const { data, error } = await supabase().auth.signUp({ email: email.trim(), password });
  if (error) return toAccountError(error);
  if (!data.session) return 'other';
  await afterSignIn();
  return null;
}

export async function signIn(email: string, password: string): Promise<AccountError | null> {
  const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password });
  if (error) return toAccountError(error);
  await afterSignIn();
  return null;
}

/**
 * Sends what's left, signs out and clears the account's data from this device (it stays in the cloud).
 * Returns false without signing out when changes couldn't be sent, unless `force` is set.
 */
export async function signOut(force = false): Promise<boolean> {
  await syncNow();
  if (!force && useAppStore.getState().outbox.length) return false;
  await supabase().auth.signOut();
  withoutTracking(() => useAppStore.getState().clearAccountData());
  return true;
}

export async function currentEmail(): Promise<string | null> {
  const { data } = await supabase().auth.getSession();
  const user = data.session?.user;
  return user && !user.is_anonymous ? user.email ?? null : null;
}
