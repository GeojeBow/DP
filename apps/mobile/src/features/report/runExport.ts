import type { CustomField } from '../../domain/customFields';
import { BUILTIN_PRESETS, buildReport, type ReportFormat, type ReportLabels, type ReportPreset, type ReportTable } from '../../domain/report';
import type { Expense, Trip } from '../../domain/models';
import { localToday } from '../../domain/trip';
import type { Translate } from '../../i18n';
import { loadReceiptImage } from '../../store/receiptImages';
import { reportToDocx } from './docx';
import { shareDocx, sharePdf, shareXlsxWithPdf } from './exportReport';
import { type HtmlLabels, reportToHtml } from './html';
import { reportToXlsx } from './xlsx';

/** Builds the report for a trip in the preset's format and hands it to the OS. */
export async function runExport(
  trip: Trip,
  expenses: readonly Expense[],
  preset: ReportPreset,
  t: Translate,
  customFields: readonly CustomField[] = [],
  /** File type to write; defaults to the preset's own */
  format: ReportFormat = preset.format,
): Promise<void> {
  // Receipts always go along: at the back of a PDF or Word file, or as a separate PDF next to a spreadsheet.
  const table = buildReport(trip, expenses, { ...preset, receiptAppendix: true }, tableLabels(t), customFields);
  const fileTitle = `${trip.title} ${trip.startDate}`;
  if (format === 'xlsx') {
    const xlsxLabels = {
      subtotal: t('report.subtotal'),
      total: t('report.total'),
      summary: t('report.summary'),
      byCategory: t('report.byCategory'),
      byDay: t('report.byDay'),
      share: t('report.share'),
      amount: t('report.amount'),
    };
    await shareXlsxWithPdf(reportToXlsx(table, xlsxLabels), fileTitle, await receiptsHtml(table, t), `${fileTitle} ${t('report.receipts')}`);
    return;
  }
  const images = await receiptImages(table);
  const labels = docLabels(t);
  if (format === 'docx') {
    await shareDocx(reportToDocx(table, images, labels), fileTitle);
    return;
  }
  await sharePdf(reportToHtml(table, images, labels), fileTitle);
}

/**
 * The receipt photos (and no-receipt statements) as the HTML of one PDF that goes along
 * with an Excel file; null when there are none. `tags` false leaves off the line numbers.
 */
export async function receiptsHtml(table: ReportTable, t: Translate, tags = true): Promise<string | null> {
  if (!table.attachments.length) return null;
  return reportToHtml(table, await receiptImages(table), docLabels(t), { receiptsOnly: true, tags });
}

async function receiptImages(table: ReportTable): Promise<Record<string, string | null>> {
  const images: Record<string, string | null> = {};
  for (const a of table.attachments) if (a.receiptId) images[a.receiptId] = await loadReceiptImage(a.receiptId);
  return images;
}

function docLabels(t: Translate): HtmlLabels {
  return {
    subtotal: t('report.subtotal'),
    total: t('report.total'),
    receipts: t('report.receipts'),
    receiptsHint: (photos, missing) => t('report.receiptsHint', { photos, missing }),
    receiptsHintByDay: (photos, missing) => t('report.receiptsHintByDay', { photos, missing }),
    day: (date, count, total) => {
      const [, m, d] = date.split('-').map(Number);
      const w = t('date.weekdays').split(',')[new Date(`${date}T00:00:00`).getDay()] ?? '';
      return t('report.dayHeading', { m: m ?? '', d: d ?? '', w, count, total });
    },
    noPhoto: {
      none: t('report.noPhoto.none'),
      affidavit: t('report.noPhoto.affidavit'),
      mileage: t('report.noPhoto.mileage'),
      failed: t('report.noPhoto.failed'),
    },
    generated: t('report.generated', { date: localToday() }),
    affidavit: {
      title: t('affidavit.title'),
      date: t('affidavit.date'),
      merchant: t('affidavit.merchant'),
      amount: t('affidavit.amount'),
      reason: t('affidavit.reason'),
      statement: t('affidavit.statement'),
      signer: t('affidavit.signer'),
      signedAt: t('affidavit.signedAt'),
    },
    byCategory: t('report.byCategory'),
    byDay: t('report.byDay'),
  };
}

function tableLabels(t: Translate): ReportLabels {
  return {
    column: (c) => t(`column.${c}`),
    category: (c) => t(`category.${c}`),
    payment: (p) => t(`payment.${p}`),
    tagColumn: t('report.tagColumn'),
    receiptNo: (tag) => t('report.attached', { tag }),
    missingReceipt: t('report.missingReceipt'),
    noReceipt: t('report.noReceipt'),
    mileage: t('report.mileageNoReceipt'),
    detail: { reason: t('affidavit.reason'), signer: t('affidavit.signer'), distance: t('report.distance') },
    proof: (p) => t(`proof.${p}`),
    claim: {
      spent: t('claim.spent'),
      companyPaid: t('claim.companyPaid'),
      personal: t('claim.personal'),
      perDiem: (days, perDay, pct) =>
        pct < 100 ? t('claim.perDiemTravel', { days, perDay, pct }) : t('claim.perDiem', { days, perDay }),
      claim: t('claim.total'),
      vatDeductible: t('claim.vatDeductible'),
      vatForeign: t('claim.vatForeign'),
    },
    none: '',
  };
}

/** The trip's receipts PDF for a company's own Excel file, which cannot hold photos; grouped by day, no line numbers. */
export async function tripReceiptsHtml(
  trip: Trip, expenses: readonly Expense[], t: Translate, customFields: readonly CustomField[] = [],
): Promise<string | null> {
  const table = buildReport(trip, expenses, { ...BUILTIN_PRESETS[0]!, receiptAppendix: true }, tableLabels(t), customFields);
  return receiptsHtml(table, t, false);
}
