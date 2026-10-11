import { Card, PlannedNote } from '../../components/Card';
import { Screen } from '../../components/Screen';

export default function ReportsScreen() {
  return (
    <Screen title="리포트" subtitle="Executive PDF · Modern Excel">
      <Card title="원클릭 리포트">
        <PlannedNote>출장을 고르면 제출 준비 상태를 점검하고 서식을 선택합니다.</PlannedNote>
      </Card>
    </Screen>
  );
}
