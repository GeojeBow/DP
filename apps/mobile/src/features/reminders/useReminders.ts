import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { planReminders } from './plan';

const CHANNEL = 'reminders';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
}

/** Asks once; returns whether reminders may be shown. */
export async function ensureReminderPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * Keeps the phone's scheduled reminders in step with trips and expenses:
 * re-plans whenever either changes, and opens the right screen on tap.
 */
export function useReminders(): void {
  const t = useT();
  const enabled = useAppStore((s) => s.reminders);
  const trips = useAppStore((s) => s.trips);
  const expenses = useAppStore((s) => s.expenses);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === 'string') router.push(url as never);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    let cancelled = false;
    // Debounced: a card statement can add many expenses in one go.
    const timer = setTimeout(async () => {
      try {
        await Notifications.cancelAllScheduledNotificationsAsync();
        if (!enabled || cancelled) return;
        const plan = planReminders(trips, expenses, new Date());
        if (!plan.length || !(await ensureReminderPermission()) || cancelled) return;
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync(CHANNEL, { name: t('reminders.channel'), importance: Notifications.AndroidImportance.DEFAULT });
        }
        for (const r of plan) {
          await Notifications.scheduleNotificationAsync({
            content: r.kind === 'daily'
              ? { title: t('reminders.dailyTitle', { trip: r.tripTitle }), body: t('reminders.dailyBody'), data: { url: '/capture' } }
              : { title: t('reminders.reportTitle', { trip: r.tripTitle }), body: t('reminders.reportBody'), data: { url: '/reports' } },
            trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at, channelId: CHANNEL },
          });
        }
      } catch {
        // Reminders are a nicety; never break the app over them.
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, trips, expenses]); // eslint-disable-line react-hooks/exhaustive-deps
}
