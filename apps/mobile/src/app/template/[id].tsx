import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Button, TextField } from '../../components/Form';
import { TEMPLATE_COLUMNS, TEMPLATE_FIELDS, type TemplateColumn, type TemplateField } from '../../features/template/mapping';
import { loadTemplateFile } from '../../features/template/storage';
import { columnIndex, columnLetters, type ParsedTemplate, readTemplate, splitRef } from '../../features/template/xlsxTemplate';
import { useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { radius, spacing, type, usePalette } from '../../theme/tokens';

const isRef = (v: string) => /^[A-Z]{1,3}\d{1,6}$/.test(v);
const isCol = (v: string) => /^[A-Z]{1,3}$/.test(v);

/** The printed label beside a cell: the nearest text to its left, else just above. */
function labelFor(t: ParsedTemplate | null, ref: string): string | null {
  if (!t || !isRef(ref)) return null;
  const byRef = new Map(t.cells.map((c) => [c.ref, c.text]));
  const { col, row } = splitRef(ref);
  for (let i = columnIndex(col) - 1; i >= Math.max(1, columnIndex(col) - 3); i--) {
    const v = byRef.get(`${columnLetters(i)}${row}`);
    if (v) return v;
  }
  return byRef.get(`${col}${row - 1}`) ?? null;
}

export default function TemplateScreen() {
  const palette = usePalette();
  const t = useT();
  const { id, by } = useLocalSearchParams<{ id: string; by?: string }>();
  const source = useAppStore((s) => s.companyTemplates.find((x) => x.id === id));
  const saveTemplate = useAppStore((s) => s.saveTemplate);
  const deleteTemplate = useAppStore((s) => s.deleteTemplate);

  const [parsed, setParsed] = useState<ParsedTemplate | null>(null);
  const [name, setName] = useState(source?.name ?? '');
  const [traveler, setTraveler] = useState(source?.values.traveler ?? '');
  const [department, setDepartment] = useState(source?.values.department ?? '');
  const [fields, setFields] = useState<Record<string, string>>({ ...(source?.mapping.fields ?? {}) });
  const [firstRow, setFirstRow] = useState(source?.mapping.table ? String(source.mapping.table.firstRow) : '');
  const [columns, setColumns] = useState<Record<string, string>>({ ...(source?.mapping.table?.columns ?? {}) });
  const customFields = useAppStore((s) => s.customFields);
  const [custom, setCustom] = useState<Record<string, string>>({ ...(source?.mapping.table?.custom ?? {}) });
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (id) loadTemplateFile(id).then((bytes) => bytes && setParsed(readTemplate(bytes))).catch(() => setParsed(null));
  }, [id]);

  // Custom fields not placed yet: look for a header with the same name above the item rows.
  useEffect(() => {
    const row = Number(firstRow);
    if (!parsed || !(row > 1)) return;
    const norm = (x: string) => x.toLowerCase().replace(/\s/g, '');
    const headers = parsed.cells.filter((c) => splitRef(c.ref).row === row - 1);
    setCustom((s) => {
      const next = { ...s };
      for (const f of customFields) {
        if (next[f.id]) continue;
        const hit = headers.find((h) => norm(h.text) === norm(f.name));
        if (hit) next[f.id] = splitRef(hit.ref).col;
      }
      return next;
    });
  }, [parsed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!source) {
    return (
      <View style={[styles.missing, { backgroundColor: palette.background }]}>
        <Text style={[type.body, { color: palette.textMuted }]}>{t('template.notFound')}</Text>
      </View>
    );
  }

  const up = (v: string) => v.toUpperCase().replace(/\s/g, '');
  const badFields = Object.values(fields).some((v) => v && !isRef(v));
  const badColumns = [...Object.values(columns), ...Object.values(custom)].some((v) => v && !isCol(v));
  const rowNum = Number(firstRow);
  const badRow = firstRow !== '' && !(Number.isInteger(rowNum) && rowNum > 0);

  const save = () => {
    if (!name.trim() || badFields || badColumns || badRow) return;
    const cleanFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) as Partial<Record<TemplateField, string>>;
    const cleanColumns = Object.fromEntries(Object.entries(columns).filter(([, v]) => v)) as Partial<Record<TemplateColumn, string>>;
    const cleanCustom = Object.fromEntries(Object.entries(custom).filter(([id, v]) => v && customFields.some((f) => f.id === id)));
    saveTemplate({
      ...source,
      name: name.trim(),
      values: { traveler: traveler.trim() || undefined, department: department.trim() || undefined },
      mapping: {
        fields: cleanFields,
        table:
          firstRow && Object.keys(cleanColumns).length + Object.keys(cleanCustom).length
            ? { firstRow: rowNum, columns: cleanColumns, custom: cleanCustom }
            : null,
      },
    });
    router.back();
  };

  const remove = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await deleteTemplate(source.id);
    router.back();
  };

  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content}>
      {by ? (
        <View style={[styles.banner, { backgroundColor: palette.brandSoft }]}>
          <Text style={[type.label, { color: palette.brand, fontWeight: '700' }]}>
            {t(by === 'ai' ? 'template.byAi' : 'template.byLabels')}
          </Text>
        </View>
      ) : null}

      <Card title={t('template.about')}>
        <TextField label={t('preset.name')} value={name} onChangeText={setName} error={name.trim() ? null : t('preset.err.name')} />
        <TextField label={t('template.traveler')} value={traveler} onChangeText={setTraveler} placeholder={t('template.travelerPh')} />
        <TextField label={t('template.department')} value={department} onChangeText={setDepartment} />
        <Text style={[type.caption, { color: palette.textMuted }]}>{t('template.file', { name: source.fileName })}</Text>
      </Card>

      <Card title={t('template.fieldsTitle')}>
        <Text style={[type.caption, { color: palette.textMuted }]}>{t('template.fieldsHint')}</Text>
        {TEMPLATE_FIELDS.map((f) => {
          const v = fields[f] ?? '';
          const label = labelFor(parsed, v);
          return (
            <TextField
              key={f}
              label={t(`template.field.${f}`)}
              value={v}
              autoCapitalize="characters"
              placeholder="—"
              onChangeText={(x) => setFields((s) => ({ ...s, [f]: up(x) }))}
              error={v && !isRef(v) ? t('template.err.cell') : null}
              hint={label ? t('template.nextTo', { label }) : v ? undefined : t('template.skip')}
            />
          );
        })}
      </Card>

      <Card title={t('template.tableTitle')}>
        <TextField
          label={t('template.firstRow')}
          value={firstRow}
          keyboardType="number-pad"
          placeholder="8"
          onChangeText={(x) => setFirstRow(x.replace(/\D/g, ''))}
          error={badRow ? t('template.err.row') : null}
          hint={t('template.firstRowHint')}
        />
        <View style={styles.grid}>
          {TEMPLATE_COLUMNS.map((c) => {
            const v = columns[c] ?? '';
            const header = parsed && isCol(v) && rowNum > 1 ? parsed.cells.find((x) => x.ref === `${v}${rowNum - 1}`)?.text : undefined;
            return (
              <View key={c} style={styles.gridItem}>
                <TextField
                  label={t(`template.column.${c}`)}
                  value={v}
                  autoCapitalize="characters"
                  placeholder="—"
                  onChangeText={(x) => setColumns((s) => ({ ...s, [c]: up(x) }))}
                  error={v && !isCol(v) ? t('template.err.col') : null}
                  hint={header ? `“${header}”` : undefined}
                />
              </View>
            );
          })}
          {customFields.map((f) => {
            const v = custom[f.id] ?? '';
            const header = parsed && isCol(v) && rowNum > 1 ? parsed.cells.find((x) => x.ref === `${v}${rowNum - 1}`)?.text : undefined;
            return (
              <View key={f.id} style={styles.gridItem}>
                <TextField
                  label={f.name}
                  value={v}
                  autoCapitalize="characters"
                  placeholder="—"
                  onChangeText={(x) => setCustom((s) => ({ ...s, [f.id]: up(x) }))}
                  error={v && !isCol(v) ? t('template.err.col') : null}
                  hint={header ? `“${header}”` : undefined}
                />
              </View>
            );
          })}
        </View>
      </Card>

      <Button title={t('template.save')} onPress={save} disabled={!name.trim() || badFields || badColumns || badRow} />
      <Button title={confirmDelete ? t('expense.deleteConfirm') : t('template.delete')} variant="danger" onPress={remove} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banner: { padding: spacing.md, borderRadius: radius.control },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  gridItem: { flexBasis: '47%', flexGrow: 1 },
});
