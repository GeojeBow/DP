import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from '../../components/Card';
import { Button, Chips } from '../../components/Form';
import { Screen } from '../../components/Screen';
import { formatMoney, sumMinor, toCurrencyCode, toMinor } from '../../domain/money';
import { BUILTIN_PRESETS, REPORT_FORMATS, type ReportFormat } from '../../domain/report';
import { uuidv7 } from '../../domain/id';
import { SubmitCard } from '../../features/company/SubmitCard';
import { runExport } from '../../features/report/runExport';
import { pickSharedTemplate, pickTemplate } from '../../features/template/pickTemplate';
import { runTemplateExport } from '../../features/template/runTemplateExport';
import { unpackTemplate } from '../../features/template/share';
import { saveTemplateFile } from '../../features/template/storage';
import { suggestMapping } from '../../features/template/suggestMapping';
import { readTemplate } from '../../features/template/xlsxTemplate';
import { useT } from '../../i18n';
import { useAppStore } from '../../store/useAppStore';
import { radius, spacing, type, usePalette } from '../../theme/tokens';

export default function ReportsScreen() {
  const palette = usePalette();
  const t = useT();
  const trips = useAppStore((s) => s.trips);
  const activeTripId = useAppStore((s) => s.activeTripId);
  const allExpenses = useAppStore((s) => s.expenses);
  const customFields = useAppStore((s) => s.customFields);
  const custom = useAppStore((s) => s.reportPresets);
  const templates = useAppStore((s) => s.companyTemplates);
  const saveTemplate = useAppStore((s) => s.saveTemplate);
  const saveField = useAppStore((s) => s.saveField);
  const presets = [...BUILTIN_PRESETS, ...custom];

  const [tripId, setTripId] = useState(activeTripId ?? trips[0]?.id ?? '');
  const lastFormatId = useAppStore((s) => s.lastFormatId);
  const setLastFormatId = useAppStore((s) => s.setLastFormatId);
  // Open on the format used last time; a saved company template beats the built-in ones.
  const known = (id: string | null) => !!id && (presets.some((p) => p.id === id) || templates.some((x) => x.id === id));
  const [presetId, setPresetIdState] = useState(known(lastFormatId) ? lastFormatId! : templates[0]?.id ?? presets[0]!.id);
  const setPresetId = (id: string) => {
    setPresetIdState(id);
    setLastFormatId(id);
  };
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trip = trips.find((x) => x.id === tripId) ?? trips[0];
  const companyTemplate = templates.find((x) => x.id === presetId) ?? null;
  const preset = presets.find((p) => p.id === presetId) ?? presets[0]!;
  const fileFormat = useAppStore((s) => s.fileFormat);
  const setFileFormat = useAppStore((s) => s.setFileFormat);
  // A company template is always filled in as Excel; other formats can come out as PDF, Excel or Word.
  const exportFormat: ReportFormat = companyTemplate ? 'xlsx' : fileFormat ?? preset.format;

  const upload = async () => {
    setError(null);
    setUploading(true);
    try {
      const file = await pickTemplate();
      if (!file) return;
      const parsed = readTemplate(file.bytes);
      const { mapping, by } = await suggestMapping(parsed);
      const id = uuidv7();
      await saveTemplateFile(id, file.bytes);
      saveTemplate({ id, name: file.name.replace(/\.xlsx$/i, ''), fileName: file.name, mapping, values: {} });
      setPresetId(id);
      router.push({ pathname: '/template/[id]', params: { id, by } });
    } catch (e) {
      setError(t('template.uploadFailed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setUploading(false);
    }
  };

  // A template a friend set up and shared: same file, same places, nothing to redo.
  const importShared = async () => {
    setError(null);
    setUploading(true);
    try {
      const text = await pickSharedTemplate();
      if (!text) return;
      const { template, bytes, newFields } = unpackTemplate(text, customFields, uuidv7);
      for (const f of newFields) saveField(f);
      await saveTemplateFile(template.id, bytes);
      saveTemplate(template);
      setPresetId(template.id);
      router.push({ pathname: '/template/[id]', params: { id: template.id, by: 'shared' } });
    } catch {
      setError(t('template.importFailed'));
    } finally {
      setUploading(false);
    }
  };

  if (!trip) {
    return (
      <Screen title={t('tab.reports')} subtitle={t('reports.subtitle')}>
        <Card title={t('reports.trip')}>
          <Text style={[type.body, { color: palette.textMuted }]}>{t('reports.noTrips')}</Text>
          <Button title={t('home.createTrip')} onPress={() => router.push('/trip/new')} />
        </Card>
      </Screen>
    );
  }

  const expenses = allExpenses.filter((e) => e.tripId === trip.id);
  const base = toCurrencyCode(trip.baseCurrency);
  const total = sumMinor(expenses.map((e) => toMinor(e.totalBase, base)));

  const exportNow = async () => {
    setBusy(true);
    setError(null);
    try {
      if (companyTemplate) await runTemplateExport(trip, expenses, companyTemplate, t, customFields);
      else await runExport(trip, expenses, preset, t, customFields, exportFormat);
    } catch (e) {
      setError(t('reports.failed', { error: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(false);
    }
  };

  const formatRow = (row: { id: string; name: string; tag: string; sub: string; edit: { pathname: string; id: string } }) => {
    const selected = row.id === (companyTemplate?.id ?? preset.id);
    return (
      <Pressable
        key={row.id}
        onPress={() => setPresetId(row.id)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        style={[styles.preset, { borderColor: selected ? palette.brand : palette.border, borderWidth: selected ? 2 : 1 }]}
      >
        <Ionicons
          name={selected ? 'radio-button-on' : 'radio-button-off'}
          size={20}
          color={selected ? palette.brand : palette.textMuted}
        />
        <View style={styles.presetText}>
          <Text style={[type.body, { color: palette.text, fontWeight: '600' }]}>
            {row.name}
            <Text style={[type.caption, { color: palette.textMuted }]}>
              {'  '}{row.tag}{row.id === lastFormatId ? ` · ${t('template.lastUsed')}` : ''}
            </Text>
          </Text>
          <Text style={[type.caption, { color: palette.textMuted }]} numberOfLines={1}>
            {row.sub}
          </Text>
        </View>
        <Pressable
          onPress={() =>
            row.edit.pathname === '/template/[id]'
              ? router.push({ pathname: '/template/[id]', params: { id: row.edit.id } })
              : router.push({ pathname: '/report/[id]', params: { id: row.edit.id } })
          }
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={[type.label, { color: palette.brand }]}>{t('reports.edit')}</Text>
        </Pressable>
      </Pressable>
    );
  };

  const addButton = (a: { key: string; icon: 'create-outline' | 'cloud-upload-outline' | 'download-outline'; label: string; onPress: () => void }) => (
    <Pressable
      key={a.key}
      onPress={a.onPress}
      disabled={uploading}
      accessibilityRole="button"
      style={[styles.addButton, { borderColor: palette.border, opacity: uploading ? 0.5 : 1 }]}
    >
      <Ionicons name={a.icon} size={22} color={palette.brand} />
      <Text style={[type.caption, styles.addLabel, { color: palette.text }]}>{a.label}</Text>
    </Pressable>
  );

  return (
    <Screen title={t('tab.reports')} subtitle={t('reports.subtitle')}>
      <Card title={t('reports.trip')}>
        <Chips label="" options={trips.map((x) => x.id)} value={trip.id} labelOf={(id) => trips.find((x) => x.id === id)?.title ?? id} onChange={setTripId} />
        <Text style={[type.caption, { color: palette.textMuted }]}>
          {t('reports.summary', { n: expenses.length, total: formatMoney(total, base) })}
        </Text>
      </Card>

      {/* Two kinds of report format: the company's own Excel file, or one made in the app */}
      <Card title={t('reports.formats')}>
        <View style={styles.group}>
          <Text style={[type.body, { color: palette.text, fontWeight: '700' }]}>{t('reports.companyGroup')}</Text>
          <Text style={[type.caption, { color: palette.textMuted }]}>{t('reports.companyGroupHint')}</Text>
          {templates.map((x) => formatRow({ id: x.id, name: x.name, tag: t('template.badge'), sub: x.fileName, edit: { pathname: '/template/[id]', id: x.id } }))}
          <View style={styles.addRow}>
            {addButton({ key: 'excel', icon: 'cloud-upload-outline', label: uploading ? t('template.reading') : t('reports.addExcel'), onPress: upload })}
            {addButton({ key: 'shared', icon: 'download-outline', label: t('reports.addShared'), onPress: importShared })}
          </View>
        </View>
        <View style={[styles.divider, { backgroundColor: palette.border }]} />
        <View style={styles.group}>
          <Text style={[type.body, { color: palette.text, fontWeight: '700' }]}>{t('reports.appGroup')}</Text>
          <Text style={[type.caption, { color: palette.textMuted }]}>{t('reports.appGroupHint')}</Text>
          {presets.map((p) =>
            formatRow({
              id: p.id,
              name: p.name,
              tag: p.builtin ? t('reports.builtin') : t('reports.mine'),
              sub: `${t('reports.columnsSummary', { n: p.columns.length, group: t(`group.${p.groupBy}`) })} · ${p.columns.map((c) => t(`column.${c}`)).join(', ')}`,
              edit: { pathname: '/report/[id]', id: p.id },
            }),
          )}
          <View style={styles.addRow}>
            {addButton({ key: 'new', icon: 'create-outline', label: t('reports.addNew'), onPress: () => router.push({ pathname: '/report/[id]', params: { id: 'new' } }) })}
          </View>
        </View>
      </Card>

      {/* What kind of file, and send it */}
      <Card title={t('reports.exportTitle')}>
        <View style={styles.fileTypes}>
          {REPORT_FORMATS.map((f) => {
            const selected = f === exportFormat;
            const locked = !!companyTemplate && f !== 'xlsx';
            return (
              <Pressable
                key={f}
                onPress={() => setFileFormat(f)}
                disabled={!!companyTemplate}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: locked }}
                style={[
                  styles.fileType,
                  { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSoft : 'transparent', opacity: locked ? 0.35 : 1 },
                ]}
              >
                <Ionicons name={FILE_ICONS[f]} size={26} color={selected ? palette.brand : palette.textMuted} />
                <Text style={[type.label, { color: selected ? palette.brand : palette.text, fontWeight: '700' }]}>{t(`format.${f}`)}</Text>
              </Pressable>
            );
          })}
        </View>
        {companyTemplate ? <Text style={[type.caption, { color: palette.textMuted }]}>{t('reports.fileTypeTemplate')}</Text> : null}
        {expenses.length === 0 ? <Text style={[type.body, { color: palette.textMuted }]}>{t('reports.empty')}</Text> : null}
        <Button
          title={busy ? t('reports.exporting') : t('reports.export', { format: t(`format.${exportFormat}`) })}
          onPress={exportNow}
          disabled={busy || expenses.length === 0}
          icon={<Ionicons name="share-social" size={20} color={palette.onBrand} />}
        />
        {exportFormat === 'xlsx' ? <Text style={[type.caption, { color: palette.textMuted }]}>{t('reports.receiptsPdfHint')}</Text> : null}
        {Platform.OS === 'web' && exportFormat === 'pdf' ? (
          <Text style={[type.caption, { color: palette.textMuted }]}>{t('reports.webPdfHint')}</Text>
        ) : null}
      </Card>
      {error ? <Text style={[type.caption, { color: palette.block }]}>{error}</Text> : null}
      <SubmitCard trip={trip} expenses={expenses} />
    </Screen>
  );
}

const FILE_ICONS = { pdf: 'document-text', xlsx: 'grid', docx: 'document' } as const;

const styles = StyleSheet.create({
  fileTypes: { flexDirection: 'row', gap: spacing.sm },
  fileType: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.md, borderWidth: 1.5, borderRadius: radius.control },
  preset: { borderRadius: radius.card, padding: spacing.md, flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  presetText: { flex: 1, gap: 2 },
  addRow: { flexDirection: 'row', gap: spacing.sm },
  group: { gap: spacing.sm },
  divider: { height: 1, marginVertical: spacing.xs },
  addButton: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: spacing.md, paddingHorizontal: spacing.xs, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.control },
  addLabel: { textAlign: 'center', fontWeight: '600' },
});
