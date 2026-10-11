import { Card, PlannedNote } from '../../components/Card';
import { Screen } from '../../components/Screen';

export default function SettingsScreen() {
  return (
    <Screen title="설정" subtitle="계정 · 규정 · 커스텀 필드 · 동기화">
      <Card title="동기화">
        <PlannedNote>오프라인 동기화 상태는 Phase 2에서 표시됩니다.</PlannedNote>
      </Card>
    </Screen>
  );
}
