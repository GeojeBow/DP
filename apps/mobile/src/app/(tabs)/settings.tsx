import { router } from 'expo-router';
import { Pressable, StyleSheet, Text } from 'react-native';

import { Card } from '../../components/Card';
import { Button } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { useAppStore } from '../../store/useAppStore';
import { spacing, type, usePalette } from '../../theme/tokens';

export default function SettingsScreen() {
  const palette = usePalette();
  const trips = useAppStore((s) => s.trips);
  const activeTripId = useAppStore((s) => s.activeTripId);
  const setActiveTrip = useAppStore((s) => s.setActiveTrip);

  return (
    <Screen title="설정" subtitle="출장 전환 · 데이터">
      <Card title="내 출장">
        {[...trips]
          .sort((a, b) => b.startDate.localeCompare(a.startDate))
          .map((t) => {
            const active = t.id === activeTripId;
            return (
              <Pressable
                key={t.id}
                onPress={() => setActiveTrip(t.id)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={[styles.trip, { borderColor: active ? palette.brand : palette.border }]}
              >
                <Text style={[type.body, { color: palette.text, fontWeight: active ? '600' : '400' }]}>{t.title}</Text>
                <Text style={[type.caption, { color: palette.textMuted }]}>
                  {t.startDate} ~ {t.endDate} · {t.baseCurrency}
                  {active ? ' · 사용 중' : ''}
                </Text>
              </Pressable>
            );
          })}
        <Button title="새 출장 만들기" variant="secondary" onPress={() => router.push('/trip/new')} />
      </Card>
      <Card title="데이터 저장">
        <Text style={[type.body, { color: palette.textMuted }]}>
          지금은 이 기기(브라우저)에만 저장됩니다. 서버 동기화는 다음 단계에서 추가됩니다.
        </Text>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  trip: { borderWidth: 1, borderRadius: 10, padding: spacing.md, gap: 2 },
});
