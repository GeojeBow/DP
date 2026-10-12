import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform, TurboModuleRegistry } from 'react-native';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'report';

function downloadOnWeb(bytes: Uint8Array, filename: string, mime: string) {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Phone browsers can hand a file to other apps; desktop ones download it. */
async function shareOnWeb(bytes: Uint8Array, filename: string, mime: string) {
  const file = new globalThis.File([bytes as BlobPart], filename, { type: mime });
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: filename });
      return;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return; // the user closed the share sheet
    }
  }
  downloadOnWeb(bytes, filename, mime);
}

function writeCache(bytes: Uint8Array, filename: string): File {
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  return file;
}

async function pdfFile(html: string, title: string): Promise<File> {
  const { uri } = await Print.printToFileAsync({ html });
  const file = new File(Paths.cache, `${safeName(title)}.pdf`);
  if (file.exists) file.delete();
  new File(uri).move(file);
  return file;
}

/** Opens the share sheet (phone, phone browsers) or downloads (desktop) an .xlsx file. */
export async function shareXlsx(bytes: Uint8Array, title: string): Promise<void> {
  const filename = `${safeName(title)}.xlsx`;
  if (Platform.OS === 'web') {
    await shareOnWeb(bytes, filename, XLSX_MIME);
    return;
  }
  const file = writeCache(bytes, filename);
  await Sharing.shareAsync(file.uri, { mimeType: XLSX_MIME, UTI: 'org.openxmlformats.spreadsheetml.sheet', dialogTitle: filename });
}

/**
 * The phone's multi-file share, or null on an install built before it was added
 * (an over-the-air update can reach such an install).
 */
function multiShare(): typeof import('react-native-share').default | null {
  if (!TurboModuleRegistry.get('RNShare')) return null;
  try {
    return (require('react-native-share') as typeof import('react-native-share')).default;
  } catch {
    return null;
  }
}

/**
 * An Excel file and its receipts PDF in one share, so mail or a messenger gets both
 * attachments from a single pick. Falls back to one after the other where that isn't possible.
 */
export async function shareXlsxWithPdf(bytes: Uint8Array, title: string, html: string | null, pdfTitle: string): Promise<void> {
  if (!html) {
    await shareXlsx(bytes, title);
    return;
  }
  const share = Platform.OS === 'web' ? null : multiShare();
  if (!share) {
    await shareXlsx(bytes, title);
    await sharePdf(html, pdfTitle);
    return;
  }
  const xlsx = writeCache(bytes, `${safeName(title)}.xlsx`);
  const pdf = await pdfFile(html, pdfTitle);
  await share.open({ urls: [xlsx.uri, pdf.uri], filenames: [xlsx.name, pdf.name], title, failOnCancel: false });
}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Opens the share sheet (phone, phone browsers) or downloads (desktop) a .docx file. */
export async function shareDocx(bytes: Uint8Array, title: string): Promise<void> {
  const filename = `${safeName(title)}.docx`;
  if (Platform.OS === 'web') {
    await shareOnWeb(bytes, filename, DOCX_MIME);
    return;
  }
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: DOCX_MIME, UTI: 'org.openxmlformats.wordprocessingml.document', dialogTitle: filename });
}

/** Renders HTML to PDF and shares it (phone), or opens the print dialog to save as PDF (web). */
export async function sharePdf(html: string, title: string): Promise<void> {
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const file = await pdfFile(html, title);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: file.name });
}

/** Opens the share sheet (phone, phone browsers) or downloads (desktop) a shared template file. */
export async function shareTemplateFile(text: string, filename: string): Promise<void> {
  const bytes = new TextEncoder().encode(text);
  const name = safeName(filename);
  if (Platform.OS === 'web') {
    await shareOnWeb(bytes, name, 'application/json');
    return;
  }
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: name });
}
