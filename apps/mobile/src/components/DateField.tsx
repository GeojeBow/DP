import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { localToday } from '../domain/trip';
import { useT } from '../i18n';
import { radius, spacing, type, usePalette } from '../theme/tokens';

interface DateFieldProps {
  label: string;
  /** YYYY-MM-DD */
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

/** Weeks of a month as day numbers, with null for leading/trailing blanks (Sunday first). */
function monthGrid(year: number, month: number): Array<Array<number | null>> {
  const first = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<number | null> = [...Array<null>(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, w) => cells.slice(w * 7, w * 7 + 7));
}

/** A date input that opens a month calendar; works the same on phones and the web. */
export function DateField({ label, value, onChange, error }: DateFieldProps) {
  const palette = usePalette();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [y0, m0] = value.split('-').map(Number);
  const [view, setView] = useState({ year: y0 || new Date().getFullYear(), month: (m0 || 1) - 1 });
  const today = localToday();

  const show = () => {
    const [y, m] = value.split('-').map(Number);
    if (y && m) setView({ year: y, month: m - 1 });
    setOpen(true);
  };
  const shift = (delta: number) =>
    setView(({ year, month }) => {
      const next = month + delta;
      return { year: year + Math.floor(next / 12), month: ((next % 12) + 12) % 12 };
    });
  const pick = (date: string) => {
    onChange(date);
    setOpen(false);
  };

  return (
    <View style={styles.field}>
      <Text style={[type.label, { color: palette.textMuted }]}>{label}</Text>
      <Pressable
        onPress={show}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        style={[styles.input, { borderColor: error ? palette.block : palette.border, backgroundColor: palette.surface }]}
      >
        <Text style={[type.body, type.numeric, { color: palette.text }]}>{value}</Text>
        <Text style={[type.caption, { color: palette.brand }]}>{t('date.pick')}</Text>
      </Pressable>
      {error ? <Text style={[type.caption, { color: palette.block }]}>{error}</Text> : null}

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]} onPress={() => {}}>
            <View style={styles.header}>
              <Pressable onPress={() => shift(-1)} accessibilityRole="button" accessibilityLabel="previous month" style={styles.nav}>
                <Text style={[type.title, { color: palette.brand }]}>‹</Text>
              </Pressable>
              <Text style={[type.label, { color: palette.text }]}>
                {t('date.monthTitle', { year: view.year, month: view.month + 1 })}
              </Text>
              <Pressable onPress={() => shift(1)} accessibilityRole="button" accessibilityLabel="next month" style={styles.nav}>
                <Text style={[type.title, { color: palette.brand }]}>›</Text>
              </Pressable>
            </View>
            <View style={styles.week}>
              {t('date.weekdays').split(',').map((d, i) => (
                <Text key={d} style={[type.caption, styles.cell, { color: i === 0 ? palette.block : palette.textMuted }]}>{d}</Text>
              ))}
            </View>
            {monthGrid(view.year, view.month).map((week, w) => (
              <View key={w} style={styles.week}>
                {week.map((day, i) => {
                  if (day === null) return <View key={i} style={styles.cell} />;
                  const date = iso(view.year, view.month, day);
                  const selected = date === value;
                  return (
                    <Pressable
                      key={i}
                      onPress={() => pick(date)}
                      accessibilityRole="button"
                      accessibilityLabel={date}
                      accessibilityState={{ selected }}
                      style={[styles.cell, styles.day, selected && { backgroundColor: palette.brand }, date === today && !selected && { borderColor: palette.brand, borderWidth: 1 }]}
                    >
                      <Text style={[type.body, { color: selected ? palette.surface : palette.text }]}>{day}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ))}
            <View style={styles.footer}>
              <Pressable onPress={() => pick(today)} accessibilityRole="button">
                <Text style={[type.label, { color: palette.brand }]}>{t('date.today')}</Text>
              </Pressable>
              <Pressable onPress={() => setOpen(false)} accessibilityRole="button">
                <Text style={[type.label, { color: palette.textMuted }]}>{t('date.close')}</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  input: {
    borderWidth: 1, borderRadius: 10, paddingHorizontal: spacing.md, minHeight: 44,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.lg },
  sheet: { borderRadius: radius.card, borderWidth: 1, padding: spacing.lg, gap: spacing.xs, maxWidth: 380, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  nav: { paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  week: { flexDirection: 'row' },
  cell: { flex: 1, textAlign: 'center', alignItems: 'center', justifyContent: 'center', aspectRatio: 1 },
  day: { borderRadius: 999 },
  footer: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
});
