import { StyleSheet, Text } from 'react-native';

import type { SubmissionStatus } from '../features/company/api';
import { useT } from '../i18n';
import { type, usePalette } from '../theme/tokens';

export function StatusBadge({ status }: { status: SubmissionStatus }) {
  const palette = usePalette();
  const t = useT();
  const color = status === 'approved' ? palette.ok : status === 'rejected' ? palette.block : palette.warn;
  return <Text style={[type.caption, styles.badge, { color, borderColor: color }]}>{t(`status.${status}`)}</Text>;
}

const styles = StyleSheet.create({
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, fontWeight: '700', overflow: 'hidden' },
});
