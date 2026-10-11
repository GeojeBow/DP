import { Text } from 'react-native';

import { Card, PlannedNote } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { formatMoney, toCurrencyCode } from '../../domain/money';
import { type, usePalette } from '../../theme/tokens';

const KRW = toCurrencyCode('KRW');

export default function HomeScreen() {
  const palette = usePalette();
  return (
    <Screen title="홈" subtitle="진행 중인 출장의 예산과 규정 현황">
      <Card title="사용액 / 예산">
        <Text style={[type.title, type.numeric, { color: palette.text }]}>
          {formatMoney(0n, KRW)} / {formatMoney(0n, KRW)}
        </Text>
      </Card>
      <Card title="예산 소진률 · 카테고리 · 일자별 지출">
        <PlannedNote>Phase 3에서 차트가 들어갑니다.</PlannedNote>
      </Card>
    </Screen>
  );
}
