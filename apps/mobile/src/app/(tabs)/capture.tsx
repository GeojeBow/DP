import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { Card } from '../../components/Card';
import { Button } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { pickReceipt, type PickSource } from '../../features/capture/pickReceipt';
import { useActiveTrip } from '../../store/useAppStore';
import { type, usePalette } from '../../theme/tokens';

export default function CaptureScreen() {
  const palette = usePalette();
  const trip = useActiveTrip();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const capture = async (source: PickSource) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await pickReceipt(source);
      if (result.status === 'picked') {
        router.push({ pathname: '/expense/[id]', params: { id: 'new', receiptId: result.receiptId } });
      } else if (result.status === 'denied') {
        setMessage(result.message);
      }
    } catch (error) {
      setMessage(`사진을 처리하지 못했습니다. 다시 시도해 주세요. (${error instanceof Error ? error.message : '알 수 없는 오류'})`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="캡처" subtitle={trip ? `${trip.title}에 추가됩니다` : '출장 없이 저장됩니다. 홈에서 출장을 만들 수 있어요.'}>
      <Card title="영수증 추가">
        <Button title={busy ? '처리 중…' : '카메라로 찍기'} onPress={() => capture('camera')} disabled={busy} />
        <Button title="갤러리에서 선택" variant="secondary" onPress={() => capture('gallery')} disabled={busy} />
        <Button
          title="영수증 없이 직접 입력"
          variant="secondary"
          onPress={() => router.push({ pathname: '/expense/[id]', params: { id: 'new' } })}
          disabled={busy}
        />
        {message ? <Text style={[type.caption, { color: palette.block }]}>{message}</Text> : null}
      </Card>
      <Card title="자동 인식">
        <Text style={[type.body, { color: palette.textMuted }]}>
          지금은 사진을 저장하고 금액을 직접 입력합니다. 서버(Supabase)가 연결되면 AI가 가맹점·금액·날짜를 자동으로 채웁니다.
        </Text>
      </Card>
    </Screen>
  );
}
