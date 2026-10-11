import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

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

/** Saves (web) or opens the share sheet (phone) for an .xlsx file. */
export async function shareXlsx(bytes: Uint8Array, title: string): Promise<void> {
  const filename = `${safeName(title)}.xlsx`;
  if (Platform.OS === 'web') {
    downloadOnWeb(bytes, filename, XLSX_MIME);
    return;
  }
  const file = new File(Paths.cache, filename);
  if (file.exists) file.delete();
  file.create();
  file.write(bytes);
  await Sharing.shareAsync(file.uri, { mimeType: XLSX_MIME, UTI: 'org.openxmlformats.spreadsheetml.sheet', dialogTitle: filename });
}

/** Renders HTML to PDF and shares it (phone), or opens the print dialog to save as PDF (web). */
export async function sharePdf(html: string, title: string): Promise<void> {
  if (Platform.OS === 'web') {
    await Print.printAsync({ html });
    return;
  }
  const { uri } = await Print.printToFileAsync({ html });
  const file = new File(Paths.cache, `${safeName(title)}.pdf`);
  if (file.exists) file.delete();
  new File(uri).move(file);
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: file.name });
}
