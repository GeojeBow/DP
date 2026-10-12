import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Button, TextField } from '../../components/Form';
import { TEMPLATE_COLUMNS, TEMPLATE_FIELDS, type TemplateColumn, type TemplateField } from '../../features/template/mapping';
import { shareTemplateFile } from '../../features/report/exportReport';
import { type CellMark, SheetGrid } from '../../features/template/SheetGrid';
import { packTemplate, SHARE_EXTENSION } from '../../features/template/share';
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
  /** What the next tap on the sheet places: f:<field>, c:<column> or x:<custom field id> */
  const [picking, setPicking] = useState<string>(`f:${TEMPLATE_FIELDS[0]}`);
  const [manual, setManual] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

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

  const items = useMemo(
    () => [
      ...TEMPLATE_FIELDS.map((f) => `f:${f}`),
      ...TEMPLATE_COLUMNS.map((c) => `c:${c}`),
      ...customFields.map((f) => `x:${f.id}`),
    ],
    [customFields],
  );
  const itemLabel = (key: string) => {
    const [kind, k] = [key.slice(0, 1), key.slice(2)];
    if (kind === 'f') return t(`template.field.${k as TemplateField}`);
    if (kind === 'c') return t(`template.column.${k as TemplateColumn}`);
    return customFields.find((f) => f.id === k)?.name ?? k;
  };
  const placeOf = (key: string): string => {
    const [kind, k] = [key.slice(0, 1), key.slice(2)];
    if (kind === 'f') return fields[k] ?? '';
    return (kind === 'c' ? columns[k] : custom[k]) ?? '';
  };

  // Tapping a cell puts the chosen item there (or takes it away), then moves to the next unplaced item.
  const tap = useCallback(
    (ref: string) => {
      const [kind, k] = [picking.slice(0, 1), picking.slice(2)];
      const { col, row } = splitRef(ref);
      let placed = true;
      if (kind === 'f') {
        placed = fields[k] !== ref;
        setFields((s) => ({ ...s, [k]: placed ? ref : '' }));
      } else {
        // A tap on the table's title cell means the first expense goes just below it.
        const label = parsed?.cells.find((c) => c.ref === ref)?.text;
        const dataRow = label && !label.startsWith('=') ? row + 1 : row;
        const current = kind === 'c' ? columns[k] : custom[k];
        placed = !(current === col && Number(firstRow) === dataRow);
        const set = kind === 'c' ? setColumns : setCustom;
        set((s) => ({ ...s, [k]: placed ? col : '' }));
        if (placed) setFirstRow(String(dataRow));
      }
      if (placed) {
        const at = items.indexOf(picking);
        const next = [...items.slice(at + 1), ...items.slice(0, at)].find((x) => x !== picking && !placeOf(x));
        if (next) setPicking(next);
      }
    },
    [picking, fields, columns, custom, firstRow, parsed, items], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const marks = useMemo(() => {
    const out: Record<string, CellMark> = {};
    const row = Number(firstRow);
    const columnMarks = [
      ...Object.entries(columns).map(([k, col]) => [`c:${k}`, col] as const),
      ...Object.entries(custom).map(([k, col]) => [`x:${k}`, col] as const),
    ];
    for (const [key, col] of columnMarks) {
      if (!col || !isCol(col) || !(row > 0)) continue;
      out[`${col}${row}`] = { label: itemLabel(key), strong: true };
      for (let i = 1; i <= 2; i++) out[`${col}${row + i}`] ??= { label: itemLabel(key), strong: false };
    }
    for (const [k, ref] of Object.entries(fields)) if (ref && isRef(ref)) out[ref] = { label: itemLabel(`f:${k}`), strong: true };
    return out;
  }, [fields, columns, custom, firstRow, customFields]); // eslint-disable-line react-hooks/exhaustive-deps
  const markedRefs = useMemo(() => Object.keys(marks), [marks]);

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

  const currentMapping = () => {
    const cleanFields = Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) as Partial<Record<TemplateField, string>>;
    const cleanColumns = Object.fromEntries(Object.entries(columns).filter(([, v]) => v)) as Partial<Record<TemplateColumn, string>>;
    const cleanCustom = Object.fromEntries(Object.entries(custom).filter(([id, v]) => v && customFields.some((f) => f.id === id)));
    return {
      fields: cleanFields,
      table:
        firstRow && Object.keys(cleanColumns).length + Object.keys(cleanCustom).length
          ? { firstRow: rowNum, columns: cleanColumns, custom: cleanCustom }
          : null,
    };
  };

  const save = () => {
    if (!name.trim() || badFields || badColumns || badRow) return;
    saveTemplate({
      ...source,
      name: name.trim(),
      values: { traveler: traveler.trim() || undefined, department: department.trim() || undefined },
      mapping: currentMapping(),
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

  // Sends what's on screen now (saved or not), so the friend gets exactly this setup.
  const share = async () => {
    setShareError(null);
    setSharing(true);
    try {
      const bytes = await loadTemplateFile(source.id);
      if (!bytes) throw new Error(t('template.missingFile'));
      const current = { ...source, name: name.trim() || source.name, mapping: currentMapping() };
      await shareTemplateFile(packTemplate(current, bytes, customFields), `${current.name}${SHARE_EXTENSION}`);
    } catch (e) {
      setShareError(t('template.shareFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSharing(false);
    }
  };

  return (
    <ScrollView style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content}>
      {by ? (
        <View style={[styles.banner, { backgroundColor: palette.brandSoft }]}>
          <Text style={[type.label, { color: palette.brand, fontWeight: '700' }]}>
            {t(by === 'ai' ? 'template.byAi' : by === 'shared' ? 'template.byShare' : 'template.byLabels')}
          </Text>
        </View>
      ) : null}

      <Card title={t('template.about')}>
        <TextField label={t('preset.name')} value={name} onChangeText={setName} error={name.trim() ? null : t('preset.err.name')} />
        <TextField label={t('template.traveler')} value={traveler} onChangeText={setTraveler} placeholder={t('template.travelerPh')} />
        <TextField label={t('template.department')} value={department} onChangeText={setDepartment} />
        <Text style={[type.caption, { color: palette.textMuted }]}>{t('template.file', { name: source.fileName })}</Text>
      </Card>

      {parsed ? (
        <Card title={t('template.pickTitle')}>
          <Text style={[type.caption, { color: palette.textMuted }]}>{t('template.pickHint')}</Text>
          {(['f', 'c'] as const).map((group) => (
            <View key={group} style={styles.pickGroup}>
              <Text style={[type.label, { color: palette.textMuted }]}>{t(group === 'f' ? 'template.fieldsTitle' : 'template.tableTitle')}</Text>
              <View style={styles.chips}>
                {items
                  .filter((key) => (group === 'f' ? key.startsWith('f:') : !key.startsWith('f:')))
                  .map((key) => {
                    const selected = key === picking;
                    const place = placeOf(key);
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setPicking(key)}
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        style={[
                          styles.chip,
                          {
                            borderColor: selected ? palette.brand : palette.border,
                            backgroundColor: selected ? palette.brand : place ? palette.brandSoft : palette.surface,
                          },
                        ]}
                      >
                        <Text style={[type.label, { color: selected ? palette.onBrand : palette.text, fontWeight: selected ? '700' : '500' }]}>
                          {place ? '✓ ' : ''}{itemLabel(key)}{place ? ` · ${place}` : ''}
                        </Text>
                      </Pressable>
                    );
                  })}
              </View>
            </View>
          ))}
          <View style={[styles.banner, { backgroundColor: palette.brandSoft }]}>
            <Text style={[type.label, { color: palette.brand, fontWeight: '700' }]}>
              {t(picking.startsWith('f:') ? 'template.tapCell' : 'template.tapColumn', { item: itemLabel(picking) })}
            </Text>
          </View>
          <SheetGrid sheet={parsed} marks={marks} extraRefs={markedRefs} onTap={tap} />
          {Number(firstRow) > 0 ? (
            <Text style={[type.caption, { color: palette.textMuted }]}>{t('template.firstRowIs', { row: firstRow })}</Text>
          ) : null}
          {placeOf(picking) ? (
            <Button
              title={t('template.clearItem', { item: itemLabel(picking) })}
              variant="secondary"
              onPress={() => {
                const [kind, k] = [picking.slice(0, 1), picking.slice(2)];
                const set = kind === 'f' ? setFields : kind === 'c' ? setColumns : setCustom;
                set((s) => ({ ...s, [k]: '' }));
              }}
            />
          ) : null}
        </Card>
      ) : null}

      {parsed ? (
        <Pressable onPress={() => setManual((m) => !m)} accessibilityRole="button" hitSlop={8}>
          <Text style={[type.label, { color: palette.brand }]}>{t(manual ? 'template.manualHide' : 'template.manualShow')}</Text>
        </Pressable>
      ) : null}

      {!parsed || manual ? (
        <>
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

        </>
      ) : null}

      <Button title={t('template.save')} onPress={save} disabled={!name.trim() || badFields || badColumns || badRow} />
      <Card title={t('template.shareTitle')}>
        <Text style={[type.caption, { color: palette.textMuted }]}>{t('template.shareHint')}</Text>
        <Button title={sharing ? t('template.sharing') : t('template.share')} variant="secondary" onPress={share} disabled={sharing} />
        {shareError ? <Text style={[type.caption, { color: palette.block }]}>{shareError}</Text> : null}
      </Card>
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
  pickGroup: { gap: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { borderWidth: 1, borderRadius: radius.chip, paddingHorizontal: spacing.md, paddingVertical: 6 },
});
