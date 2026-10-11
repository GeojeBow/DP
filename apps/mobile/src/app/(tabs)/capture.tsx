import { router } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { Card } from '../../components/Card';
import { Button, TextField } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { pickReceipt, type PickSource } from '../../features/capture/pickReceipt';
import { parseQuickEntry } from '../../features/capture/quickEntry';
import { useT } from '../../i18n';
import { useActiveTrip } from '../../store/useAppStore';
import { type, usePalette } from '../../theme/tokens';

export default function CaptureScreen() {
  const palette = usePalette();
  const t = useT();
  const trip = useActiveTrip();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [line, setLine] = useState('');

  const quickAdd = () => {
    if (!line.trim()) return;
    const q = parseQuickEntry(line);
    setLine('');
    router.push({
      pathname: '/expense/[id]',
      params: {
        id: 'new',
        ...(q.merchantName ? { merchant: q.merchantName } : {}),
        ...(q.total ? { amount: q.total } : {}),
        ...(q.currency ? { currency: q.currency } : {}),
        ...(q.category ? { category: q.category } : {}),
      },
    });
  };

  const capture = async (source: PickSource) => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await pickReceipt(source);
      if (result.status === 'picked') {
        router.push({ pathname: '/expense/[id]', params: { id: 'new', receiptId: result.receiptId } });
      } else if (result.status === 'denied') {
        setMessage(t(source === 'camera' ? 'capture.deniedCamera' : 'capture.deniedGallery'));
      }
    } catch (error) {
      setMessage(t('capture.failed', { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('tab.capture')} subtitle={trip ? t('capture.addsTo', { trip: trip.title }) : t('capture.noTrip')}>
      <Card title={t('capture.addReceipt')}>
        <Button title={busy ? t('capture.processing') : t('capture.camera')} onPress={() => capture('camera')} disabled={busy} />
        <Button title={t('capture.gallery')} variant="secondary" onPress={() => capture('gallery')} disabled={busy} />
        <Button
          title={t('capture.manual')}
          variant="secondary"
          onPress={() => router.push({ pathname: '/expense/[id]', params: { id: 'new' } })}
          disabled={busy}
        />
        {message ? <Text style={[type.caption, { color: palette.block }]}>{message}</Text> : null}
      </Card>
      <Card title={t('quick.title')}>
        <TextField
          label={t('quick.label')}
          value={line}
          onChangeText={setLine}
          placeholder={t('quick.placeholder')}
          hint={t('quick.hint')}
          returnKeyType="done"
          onSubmitEditing={quickAdd}
        />
        <Button title={t('quick.add')} variant="secondary" onPress={quickAdd} disabled={!line.trim()} />
      </Card>
      <Card title={t('capture.ai.title')}>
        <Text style={[type.body, { color: palette.textMuted }]}>{t('capture.ai.body')}</Text>
      </Card>
    </Screen>
  );
}
