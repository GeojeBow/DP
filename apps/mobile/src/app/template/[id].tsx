import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Button, TextField } from '../../components/Form';
import { shareTemplateFile } from '../../features/report/exportReport';
import { TEMPLATE_COLUMNS, TEMPLATE_FIELDS, type TemplateColumn, type TemplateField, type TemplateMapping } from '../../features/template/mapping';
import { type CellMark, SheetGrid } from '../../features/template/SheetGrid';
import { packTemplate, SHARE_EXTENSION } from '../../features/template/share';
import { loadTemplateFile } from '../../features/template/storage';
import { columnIndex, columnLetters, type ParsedTemplate, readTemplate, splitRef } from '../../features/template/xlsxTemplate';
import { useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { radius, spacing, type, usePalette } from '../../theme/tokens';

/** Setting up a company template takes three steps: what goes in, where it goes, then name and save. */
type Step = 'pick' | 'match' | 'done';

/** The printed label beside a cell: the nearest text to its left, else just above. */
function labelFor(t: ParsedTemplate | null, ref: string): string | null {
  if (!t) return null;
  const byRef = new Map(t.cells.map((c) => [c.ref, c.text]));
  const { col, row } = splitRef(ref);
  for (let i = columnIndex(col) - 1; i >= Math.max(1, columnIndex(col) - 3); i--) {
    const v = byRef.get(`${columnLetters(i)}${row}`);
    if (v && !v.startsWith('=')) return v;
  }
  const above = byRef.get(`${col}${row - 1}`);
  return above && !above.startsWith('=') ? above : null;
}

export default function TemplateScreen() {
  const palette = usePalette();
  const t = useT();
  const { id, by } = useLocalSearchParams<{ id: string; by?: string }>();
  const source = useAppStore((s) => s.companyTemplates.find((x) => x.id === id));
  const saveTemplate = useAppStore((s) => s.saveTemplate);
  const deleteTemplate = useAppStore((s) => s.deleteTemplate);
  const customFields = useAppStore((s) => s.customFields);

  // A fresh upload starts at step 1; a saved or shared template opens on its summary.
  const fresh = by === 'ai' || by === 'labels';
  const [step, setStep] = useState<Step>(fresh ? 'pick' : 'done');
  const [parsed, setParsed] = useState<ParsedTemplate | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState(source?.name ?? '');
  const [traveler, setTraveler] = useState(source?.values.traveler ?? '');
  const [department, setDepartment] = useState(source?.values.department ?? '');
  const [fields, setFields] = useState<Record<string, string>>({ ...(source?.mapping.fields ?? {}) });
  const [firstRow, setFirstRow] = useState(source?.mapping.table?.firstRow ?? 0);
  const [columns, setColumns] = useState<Record<string, string>>({ ...(source?.mapping.table?.columns ?? {}) });
  const [custom, setCustom] = useState<Record<string, string>>({ ...(source?.mapping.table?.custom ?? {}) });

  const tripItems = TEMPLATE_FIELDS.map((f) => `f:${f}`);
  const receiptItems = useMemo(
    () => [...TEMPLATE_COLUMNS.map((c) => `c:${c}`), ...customFields.map((f) => `x:${f.id}`)],
    [customFields],
  );
  const items = useMemo(() => [...tripItems, ...receiptItems], [receiptItems]); // eslint-disable-line react-hooks/exhaustive-deps

  const placeOf = (key: string): string => {
    const [kind, k] = [key.slice(0, 1), key.slice(2)];
    if (kind === 'f') return fields[k] ?? '';
    return (kind === 'c' ? columns[k] : custom[k]) ?? '';
  };
  /** Cell to show for an item: its own cell, or a table column's first row */
  const cellOf = (key: string): string | null => {
    const place = placeOf(key);
    if (!place) return null;
    if (key.startsWith('f:')) return place;
    return firstRow > 0 ? `${place}${firstRow}` : null;
  };

  // Items that are not needed. On a fresh upload, everything the AI didn't find starts switched off.
  const [skip, setSkip] = useState<Set<string>>(() => {
    if (source?.mapping.skip) return new Set(source.mapping.skip);
    if (!fresh || !source) return new Set();
    const m = source.mapping;
    const placed = new Set([
      ...Object.keys(m.fields).map((k) => `f:${k}`),
      ...Object.keys(m.table?.columns ?? {}).map((k) => `c:${k}`),
      ...Object.keys(m.table?.custom ?? {}).map((k) => `x:${k}`),
    ]);
    return new Set(
      [...TEMPLATE_FIELDS.map((f) => `f:${f}`), ...TEMPLATE_COLUMNS.map((c) => `c:${c}`), ...customFields.map((f) => `x:${f.id}`)].filter(
        (key) => !placed.has(key),
      ),
    );
  });
  const chosen = items.filter((key) => !skip.has(key));

  // Step 2 walks through the chosen items one by one.
  const [at, setAt] = useState(0);
  const current = chosen[Math.min(at, chosen.length - 1)];

  const [confirmDelete, setConfirmDelete] = useState(false);
  // Each step starts at the top of the page.
  const page = useRef<ScrollView>(null);
  useEffect(() => page.current?.scrollTo({ y: 0, animated: false }), [step]);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    loadTemplateFile(id)
      .then((bytes) => (bytes ? setParsed(readTemplate(bytes)) : setLoadFailed(true)))
      .catch(() => setLoadFailed(true));
  }, [id]);

  // Company-only boxes: look for a header with the same name above the item rows, and switch them on when found.
  useEffect(() => {
    if (!parsed || !(firstRow > 1)) return;
    const norm = (x: string) => x.toLowerCase().replace(/\s/g, '');
    const headers = parsed.cells.filter((c) => splitRef(c.ref).row === firstRow - 1);
    const found: Record<string, string> = {};
    for (const f of customFields) {
      if (custom[f.id]) continue;
      const hit = headers.find((h) => norm(h.text) === norm(f.name));
      if (hit) found[f.id] = splitRef(hit.ref).col;
    }
    if (!Object.keys(found).length) return;
    setCustom((s) => ({ ...s, ...found }));
    setSkip((s) => new Set([...s].filter((key) => !(key.startsWith('x:') && found[key.slice(2)]))));
  }, [parsed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!source) {
    return (
      <View style={[styles.missing, { backgroundColor: palette.background }]}>
        <Text style={[type.body, { color: palette.textMuted }]}>{t('template.notFound')}</Text>
      </View>
    );
  }

  const itemLabel = (key: string) => {
    const [kind, k] = [key.slice(0, 1), key.slice(2)];
    if (kind === 'f') return t(`template.field.${k as TemplateField}`);
    if (kind === 'c') return t(`template.column.${k as TemplateColumn}`);
    return customFields.find((f) => f.id === k)?.name ?? k;
  };

  /** Where an item sits, in words: "B3 · next to '성명'" or "column C from row 8 · under '사용일'". */
  const describe = (key: string): string | null => {
    const cell = cellOf(key);
    if (!cell) return null;
    if (key.startsWith('f:')) {
      const label = labelFor(parsed, cell);
      return label ? t('template.where.cellNear', { cell, label }) : t('template.where.cell', { cell });
    }
    const header = parsed?.cells.find((c) => c.ref === `${placeOf(key)}${firstRow - 1}`)?.text;
    return header
      ? t('template.where.columnUnder', { col: placeOf(key), row: firstRow, label: header })
      : t('template.where.column', { col: placeOf(key), row: firstRow });
  };

  const toggle = (key: string) => setSkip((s) => (s.has(key) ? new Set([...s].filter((x) => x !== key)) : new Set([...s, key])));

  // Tapping a cell in step 2 moves the current item there.
  const tap = (ref: string) => {
    if (!current) return;
    const [kind, k] = [current.slice(0, 1), current.slice(2)];
    const { col, row } = splitRef(ref);
    if (kind === 'f') {
      setFields((s) => ({ ...s, [k]: ref }));
      return;
    }
    // A tap on the table's title cell means the first receipt goes just below it.
    const label = parsed?.cells.find((c) => c.ref === ref)?.text;
    const dataRow = label && !label.startsWith('=') ? row + 1 : row;
    (kind === 'c' ? setColumns : setCustom)((s) => ({ ...s, [k]: col }));
    setFirstRow(dataRow);
  };

  const next = () => (at + 1 >= chosen.length ? setStep('done') : setAt(at + 1));
  // Confirms every remaining item that already has a place and stops at the first one that doesn't.
  const acceptRest = () => {
    const i = chosen.findIndex((key, n) => n > at && !placeOf(key));
    if (i < 0) setStep('done');
    else setAt(i);
  };
  const dropCurrent = () => {
    if (!current) return;
    setSkip((s) => new Set([...s, current]));
    if (at + 1 >= chosen.length) {
      setAt(Math.max(0, at - 1));
      setStep('done');
    }
  };

  const marks: Record<string, CellMark> = {};
  for (const key of chosen) {
    const cell = cellOf(key);
    if (!cell) continue;
    const tone = step === 'match' && key === current ? 'focus' : 'set';
    if (!key.startsWith('f:')) {
      const { col, row } = splitRef(cell);
      for (let i = 1; i <= 2; i++) marks[`${col}${row + i}`] ??= { label: itemLabel(key), tone: 'faint' };
    }
    if (tone === 'focus' || !marks[cell] || marks[cell].tone === 'faint') marks[cell] = { label: itemLabel(key), tone };
  }
  const markedRefs = Object.keys(marks);

  const currentMapping = (): TemplateMapping => {
    const pick = (kind: string, rec: Record<string, string>) =>
      Object.fromEntries(Object.entries(rec).filter(([k, v]) => v && !skip.has(`${kind}:${k}`)));
    const cleanFields = pick('f', fields) as TemplateMapping['fields'];
    const cleanColumns = pick('c', columns) as Partial<Record<TemplateColumn, string>>;
    const cleanCustom = pick('x', custom);
    for (const k of Object.keys(cleanCustom)) if (!customFields.some((f) => f.id === k)) delete cleanCustom[k];
    return {
      fields: cleanFields,
      table:
        firstRow > 0 && Object.keys(cleanColumns).length + Object.keys(cleanCustom).length
          ? { firstRow, columns: cleanColumns, custom: cleanCustom }
          : null,
      skip: items.filter((key) => skip.has(key)),
    };
  };

  const missing = chosen.filter((key) => !cellOf(key));
  const save = () => {
    if (!name.trim()) return;
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
      const now = { ...source, name: name.trim() || source.name, mapping: currentMapping() };
      await shareTemplateFile(packTemplate(now, bytes, customFields), `${now.name}${SHARE_EXTENSION}`);
    } catch (e) {
      setShareError(t('template.shareFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setSharing(false);
    }
  };

  const stepBar = (
    <View style={styles.steps}>
      {(['pick', 'match', 'done'] as const).map((s, i) => {
        const on = s === step;
        return (
          <Pressable
            key={s}
            onPress={() => (s === 'match' && !chosen.length ? undefined : setStep(s))}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[styles.stepChip, { backgroundColor: on ? palette.brand : palette.surface, borderColor: on ? palette.brand : palette.border }]}
          >
            <Text style={[type.caption, { color: on ? palette.onBrand : palette.textMuted, fontWeight: '700' }]}>
              {i + 1}. {t(`template.step.${s}`)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  const checkRow = (key: string) => {
    const on = !skip.has(key);
    return (
      <Pressable
        key={key}
        onPress={() => toggle(key)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on }}
        style={[styles.checkRow, { borderColor: on ? palette.brand : palette.border, backgroundColor: on ? palette.brandSoft : palette.surface }]}
      >
        <Ionicons name={on ? 'checkbox' : 'square-outline'} size={22} color={on ? palette.brand : palette.textMuted} />
        <Text style={[type.body, styles.checkLabel, { color: palette.text, fontWeight: on ? '600' : '400' }]}>{itemLabel(key)}</Text>
        {on && placeOf(key) ? <Text style={[type.caption, { color: palette.brand }]}>{t('template.found')}</Text> : null}
      </Pressable>
    );
  };

  return (
    <ScrollView ref={page} style={{ backgroundColor: palette.background }} contentContainerStyle={styles.content}>
      {stepBar}

      {loadFailed ? (
        <View style={[styles.banner, { backgroundColor: palette.brandSoft }]}>
          <Text style={[type.label, { color: palette.block, fontWeight: '700' }]}>{t('template.missingFile')}</Text>
        </View>
      ) : null}

      {step === 'pick' ? (
        <>
          <View style={[styles.banner, { backgroundColor: palette.brandSoft }]}>
            <Text style={[type.label, { color: palette.brand, fontWeight: '700' }]}>
              {t(by === 'ai' ? 'template.pick.byAi' : 'template.pick.byLabels')}
            </Text>
          </View>
          <Card title={t('template.pick.tripTitle')}>
            <Text style={[type.caption, { color: palette.textMuted }]}>{t('template.pick.tripHint')}</Text>
            {tripItems.map(checkRow)}
          </Card>
          <Card title={t('template.pick.receiptTitle')}>
            <Text style={[type.caption, { color: palette.textMuted }]}>{t('template.pick.receiptHint')}</Text>
            {receiptItems.map(checkRow)}
          </Card>
          <Button
            title={t('template.pick.next', { n: chosen.length })}
            onPress={() => {
              setAt(0);
              setStep('match');
            }}
            disabled={!chosen.length}
          />
        </>
      ) : null}

      {step === 'match' && current ? (
        <>
          <Card title={t('template.match.progress', { n: Math.min(at, chosen.length - 1) + 1, total: chosen.length })}>
            <View style={[styles.progressTrack, { backgroundColor: palette.border }]}>
              <View style={[styles.progressFill, { backgroundColor: palette.brand, width: `${((Math.min(at, chosen.length - 1) + 1) / chosen.length) * 100}%` }]} />
            </View>
            <Text style={[type.title, { color: palette.text }]}>{itemLabel(current)}</Text>
            {cellOf(current) ? (
              <>
                <Text style={[type.body, { color: palette.text }]}>{t('template.match.here')}</Text>
                <Text style={[type.label, { color: palette.brand, fontWeight: '700' }]}>{describe(current)}</Text>
                <Text style={[type.caption, { color: palette.textMuted }]}>{t('template.match.wrongHint')}</Text>
              </>
            ) : (
              <Text style={[type.body, { color: palette.brand, fontWeight: '700' }]}>
                {t(current.startsWith('f:') ? 'template.match.tapCell' : 'template.match.tapColumn')}
              </Text>
            )}
            {parsed ? (
              <SheetGrid sheet={parsed} marks={marks} extraRefs={markedRefs} focus={cellOf(current) ?? undefined} onTap={tap} />
            ) : null}
            <Button
              title={t('template.match.ok')}
              onPress={next}
              disabled={!cellOf(current)}
              icon={<Ionicons name="checkmark" size={20} color={palette.onBrand} />}
            />
            <View style={styles.twoButtons}>
              <View style={styles.half}>
                <Button title={t('template.match.drop')} variant="secondary" onPress={dropCurrent} />
              </View>
              <View style={styles.half}>
                <Button title={t('template.match.back')} variant="secondary" onPress={() => (at > 0 ? setAt(at - 1) : setStep('pick'))} />
              </View>
            </View>
          </Card>
          {chosen.some((key, n) => n > at && placeOf(key)) ? (
            <Pressable onPress={acceptRest} accessibilityRole="button" hitSlop={8}>
              <Text style={[type.label, styles.center, { color: palette.brand }]}>{t('template.match.acceptRest')}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {step === 'done' ? (
        <>
          {by === 'shared' ? (
            <View style={[styles.banner, { backgroundColor: palette.brandSoft }]}>
              <Text style={[type.label, { color: palette.brand, fontWeight: '700' }]}>{t('template.byShare')}</Text>
            </View>
          ) : null}
          <Card title={t('template.about')}>
            <TextField label={t('preset.name')} value={name} onChangeText={setName} error={name.trim() ? null : t('preset.err.name')} />
            {!skip.has('f:traveler') ? (
              <TextField label={t('template.traveler')} value={traveler} onChangeText={setTraveler} placeholder={t('template.travelerPh')} />
            ) : null}
            {!skip.has('f:department') ? (
              <TextField label={t('template.department')} value={department} onChangeText={setDepartment} />
            ) : null}
            <Text style={[type.caption, { color: palette.textMuted }]}>{t('template.file', { name: source.fileName })}</Text>
          </Card>

          <Card title={t('template.done.summary', { n: chosen.length })}>
            {missing.length ? (
              <Text style={[type.caption, { color: palette.warn, fontWeight: '700' }]}>{t('template.done.missing', { n: missing.length })}</Text>
            ) : null}
            {chosen.map((key, n) => (
              <Pressable
                key={key}
                onPress={() => {
                  setAt(n);
                  setStep('match');
                }}
                accessibilityRole="button"
                style={[styles.summaryRow, { borderColor: palette.border }]}
              >
                <Ionicons
                  name={cellOf(key) ? 'checkmark-circle' : 'alert-circle'}
                  size={20}
                  color={cellOf(key) ? palette.ok : palette.warn}
                />
                <Text style={[type.body, styles.checkLabel, { color: palette.text }]}>{itemLabel(key)}</Text>
                <Text style={[type.caption, { color: palette.textMuted }]}>{cellOf(key) ?? t('template.done.noPlace')}</Text>
                <Ionicons name="chevron-forward" size={16} color={palette.textMuted} />
              </Pressable>
            ))}
            <Button title={t('template.done.repick')} variant="secondary" onPress={() => setStep('pick')} />
          </Card>

          <Button title={t('template.save')} onPress={save} disabled={!name.trim()} />

          <Card title={t('template.shareTitle')}>
            <Text style={[type.caption, { color: palette.textMuted }]}>{t('template.shareHint')}</Text>
            <Button title={sharing ? t('template.sharing') : t('template.share')} variant="secondary" onPress={share} disabled={sharing} />
            {shareError ? <Text style={[type.caption, { color: palette.block }]}>{shareError}</Text> : null}
          </Card>
          <Button title={confirmDelete ? t('expense.deleteConfirm') : t('template.delete')} variant="danger" onPress={remove} />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xxl * 2 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banner: { padding: spacing.md, borderRadius: radius.control },
  steps: { flexDirection: 'row', gap: spacing.xs },
  stepChip: { flex: 1, alignItems: 'center', paddingVertical: spacing.sm, borderWidth: 1, borderRadius: radius.chip },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderRadius: radius.control, padding: spacing.md },
  checkLabel: { flex: 1 },
  progressTrack: { height: 6, borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  twoButtons: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
  center: { textAlign: 'center' },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
});
