import type { CustomField } from '../../domain/customFields';
import { buildReport, type ReportFormat, type ReportPreset } from '../../domain/report';
import type { Expense, Trip } from '../../domain/models';
import { localToday } from '../../domain/trip';
import type { Translate } from '../../i18n';
import { loadReceiptImage } from '../../store/receiptImages';
import { reportToDocx } from './docx';
import { shareDocx, sharePdf, shareXlsx } from './exportReport';
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
  // A spreadsheet preset turned into a PDF or Word file still gets its receipts at the back.
  const receiptAppendix = format !== 'xlsx' && (preset.format === 'xlsx' || preset.receiptAppendix);
  const table = buildReport(trip, expenses, { ...preset, receiptAppendix }, {
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
      perDiem: (days, perDay) => t('claim.perDiem', { days, perDay }),
      claim: t('claim.total'),
      vatDeductible: t('claim.vatDeductible'),
      vatForeign: t('claim.vatForeign'),
    },
    none: '',
  }, customFields);
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
    await shareXlsx(reportToXlsx(table, xlsxLabels), fileTitle);
    return;
  }
  const images: Record<string, string | null> = {};
  for (const a of table.attachments) if (a.receiptId) images[a.receiptId] = await loadReceiptImage(a.receiptId);
  const docLabels: HtmlLabels = {
    subtotal: t('report.subtotal'),
    total: t('report.total'),
    receipts: t('report.receipts'),
    receiptsHint: (photos, missing) => t('report.receiptsHint', { photos, missing }),
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
  if (format === 'docx') {
    await shareDocx(reportToDocx(table, images, docLabels), fileTitle);
    return;
  }
  await sharePdf(reportToHtml(table, images, docLabels), fileTitle);
}
