import { Card, PlannedNote } from '../../components/Card';
import { Screen } from '../../components/Screen';
import { useT } from '../../i18n';

export default function ReportsScreen() {
  const t = useT();
  return (
    <Screen title={t('tab.reports')} subtitle="Executive PDF · Modern Excel">
      <Card title={t('reports.cardTitle')}>
        <PlannedNote>{t('reports.planned')}</PlannedNote>
      </Card>
    </Screen>
  );
}
