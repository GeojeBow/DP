import { Card, PlannedNote } from '../../components/Card';
import { Screen } from '../../components/Screen';

export default function ExpensesScreen() {
  return (
    <Screen title="지출" subtitle="날짜별 지출과 규정 체크">
      <Card title="지출 목록">
        <PlannedNote>아직 지출이 없습니다. 캡처 탭에서 영수증을 찍어 보세요.</PlannedNote>
      </Card>
    </Screen>
  );
}
