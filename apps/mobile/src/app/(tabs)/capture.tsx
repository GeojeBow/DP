import { Card, PlannedNote } from '../../components/Card';
import { Screen } from '../../components/Screen';

export default function CaptureScreen() {
  return (
    <Screen title="캡처" subtitle="영수증 · 카드 명세서 · 갤러리">
      <Card title="스마트 캡처">
        <PlannedNote>카메라 촬영과 1초 컨펌 카드는 Phase 1 다음 단계에서 연결됩니다.</PlannedNote>
      </Card>
    </Screen>
  );
}
