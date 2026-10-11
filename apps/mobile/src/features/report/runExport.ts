import type { CustomField } from '../../domain/customFields';
import { buildReport, type ReportPreset } from '../../domain/report';
import type { Expense, Trip } from '../../domain/models';
import { localToday } from '../../domain/trip';
import type { Translate } from '../../i18n';
import { loadReceiptImage } from '../../store/receiptImages';
import { sharePdf, shareXlsx } from './exportReport';
import { reportToHtml } from './html';
import { reportToXlsx } from './xlsx';

/** Builds the report for a trip in the preset's format and hands it to the OS. */
export async function runExport(
  trip: Trip,
  expenses: readonly Expense[],
  preset: ReportPreset,
  t: Translate,
  customFields: readonly CustomField[] = [],
): Promise<void> {
  const table = buildReport(trip, expenses, preset, {
    column: (c) => t(`column.${c}`),
    category: (c) => t(`category.${c}`),
    payment: (p) => t(`payment.${p}`),
    receiptNo: (n) => `#${n}`,
    none: '',
  }, customFields);
  const fileTitle = `${trip.title} ${trip.startDate}`;
  if (preset.format === 'xlsx') {
    const xlsxLabels = {
      subtotal: t('report.subtotal'),
      total: t('report.total'),
      summary: t('report.summary'),
      byCategory: t('report.byCategory'),
      byDay: t('report.byDay'),
      share: t('report.share'),
      amount: t('report.amount'),
    };
    await shareXlsx(reportToXlsx(table, xlsxLabels), fileTitle);
    return;
  }
  const images: Record<string, string | null> = {};
  for (const r of table.receipts) images[r.receiptId] = await loadReceiptImage(r.receiptId);
  const html = reportToHtml(table, images, {
    subtotal: t('report.subtotal'),
    total: t('report.total'),
    receipts: t('report.receipts'),
    receiptNo: (n) => t('report.receiptNo', { n }),
    generated: t('report.generated', { date: localToday() }),
    byCategory: t('report.byCategory'),
    byDay: t('report.byDay'),
  });
  await sharePdf(html, fileTitle);
}
