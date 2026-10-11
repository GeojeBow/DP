import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Chips, TextField } from '../../components/Form';
import { uuidv7 } from '../../domain/id';
import {
  BUILTIN_PRESETS, REPORT_COLUMNS, REPORT_FORMATS, REPORT_GROUPINGS, type ReportColumn, type ReportPreset,
} from '../../domain/report';
import { useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { radius, spacing, type, usePalette } from '../../theme/tokens';

const BLANK: ReportPreset = {
  id: '', name: '', format: 'xlsx', columns: ['date', 'merchant', 'category', 'amount', 'amountBase'], groupBy: 'date', receiptAppendix: false,
};

export default function PresetScreen() {
  const palette = usePalette();
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const custom = useAppStore((s) => s.reportPresets);
  const savePreset = useAppStore((s) => s.savePreset);
  const deletePreset = useAppStore((s) => s.deletePreset);
  const source = [...BUILTIN_PRESETS, ...custom].find((p) => p.id === id);
  const isBuiltin = !!source?.builtin;

  const [name, setName] = useState(source ? source.name + (isBuiltin ? t('preset.copySuffix') : '') : '');
  const [format, setFormat] = useState(source?.format ?? BLANK.format);
  const [groupBy, setGroupBy] = useState(source?.groupBy ?? BLANK.groupBy);
  const [columns, setColumns] = useState<ReportColumn[]>(source?.columns ?? BLANK.columns);
  const [appendix, setAppendix] = useState(source?.receiptAppendix ?? BLANK.receiptAppendix);
  const [submitted, setSubmitted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const errors = {
    name: name.trim() ? null : t('preset.err.name'),
    columns: columns.length ? null : t('preset.err.columns'),
  };
  const off = REPORT_COLUMNS.filter((c) => !columns.includes(c));

  const toggle = (c: ReportColumn) => setColumns((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  const move = (i: number, delta: number) =>
    setColumns((cs) => {
      const j = i + delta;
      if (j < 0 || j >= cs.length) return cs;
      const next = [...cs];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const save = () => {
    setSubmitted(true);
    if (errors.name || errors.columns) return;
    savePreset({
      id: source && !isBuiltin ? source.id : uuidv7(),
      name: name.trim(),
      format,
      groupBy,
      columns,
      receiptAppendix: format !== 'xlsx' && appendix,
    });
    router.back();
  };

  const remove = () => {
    if (!source || isBuiltin) return;
    if (!confirmDelete) return setConfirmDelete(true);
    deletePreset(source.id);
    router.back();
  };

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {isBuiltin ? <Text style={[type.caption, { color: palette.textMuted }]}>{t('preset.builtinNote')}</Text> : null}
      <TextField label={t('preset.name')} value={name} onChangeText={setName} placeholder={t('preset.namePlaceholder')} error={submitted ? errors.name : null} />
      <Chips label={t('preset.format')} options={REPORT_FORMATS} value={format} labelOf={(f) => t(`format.${f}`)} onChange={setFormat} />
      <Chips label={t('preset.groupBy')} options={REPORT_GROUPINGS} value={groupBy} labelOf={(g) => t(`group.${g}`)} onChange={setGroupBy} />

      <View style={styles.section}>
        <Text style={[type.label, { color: palette.textMuted }]}>{t('preset.columns')}</Text>
        <Text style={[type.caption, { color: palette.textMuted }]}>{t('preset.columnsHint')}</Text>
        {columns.map((c, i) => (
          <View key={c} style={[styles.colRow, { borderColor: palette.brand, backgroundColor: palette.surface }]}>
            <Text style={[type.caption, { color: palette.textMuted, width: 20 }]}>{i + 1}</Text>
            <Pressable style={styles.colName} onPress={() => toggle(c)} accessibilityRole="button" accessibilityState={{ selected: true }}>
              <Text style={[type.body, { color: palette.text, fontWeight: '600' }]}>✓ {t(`column.${c}`)}</Text>
            </Pressable>
            <Pressable onPress={() => move(i, -1)} disabled={i === 0} accessibilityRole="button" accessibilityLabel="move up" hitSlop={6} style={styles.arrow}>
              <Text style={[type.title, { color: i === 0 ? palette.border : palette.brand }]}>↑</Text>
            </Pressable>
            <Pressable onPress={() => move(i, 1)} disabled={i === columns.length - 1} accessibilityRole="button" accessibilityLabel="move down" hitSlop={6} style={styles.arrow}>
              <Text style={[type.title, { color: i === columns.length - 1 ? palette.border : palette.brand }]}>↓</Text>
            </Pressable>
          </View>
        ))}
        {off.map((c) => (
          <Pressable key={c} onPress={() => toggle(c)} accessibilityRole="button" accessibilityState={{ selected: false }} style={[styles.colRow, { borderColor: palette.border }]}>
            <Text style={{ width: 20 }} />
            <Text style={[type.body, { color: palette.textMuted }]}>+ {t(`column.${c}`)}</Text>
          </Pressable>
        ))}
        {submitted && errors.columns ? <Text style={[type.caption, { color: palette.block }]}>{errors.columns}</Text> : null}
      </View>

      {format !== 'xlsx' ? (
        <Chips
          label={t('preset.appendix')}
          options={['yes', 'no'] as const}
          value={appendix ? 'yes' : 'no'}
          labelOf={(v) => t(v === 'yes' ? 'preset.yes' : 'preset.no')}
          onChange={(v) => setAppendix(v === 'yes')}
        />
      ) : null}

      <Button title={isBuiltin ? t('preset.saveCopy') : t('preset.save')} onPress={save} />
      {source && !isBuiltin ? (
        <Button title={confirmDelete ? t('expense.deleteConfirm') : t('preset.delete')} variant="danger" onPress={remove} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  section: { gap: spacing.sm },
  colRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: spacing.md, minHeight: 44 },
  colName: { flex: 1, paddingVertical: spacing.sm },
  arrow: { paddingHorizontal: spacing.sm },
});
