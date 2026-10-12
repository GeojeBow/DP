import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Lets the user choose an .xlsx file; null when they cancel. */
export async function pickTemplate(): Promise<{ name: string; bytes: Uint8Array } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: [XLSX, 'application/octet-stream'], copyToCacheDirectory: true });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  let bytes: Uint8Array;
  if (Platform.OS === 'web') {
    const blob: Blob = asset.file ?? (await (await fetch(asset.uri)).blob());
    bytes = new Uint8Array(await blob.arrayBuffer());
  } else {
    bytes = await new File(asset.uri).bytes();
  }
  return { name: asset.name, bytes };
}

/** Lets the user choose a template file a friend shared; its text, or null when they cancel. */
export async function pickSharedTemplate(): Promise<string | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ['application/json', 'text/plain', 'application/octet-stream', '*/*'], copyToCacheDirectory: true });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  if (Platform.OS === 'web') {
    const blob: Blob = asset.file ?? (await (await fetch(asset.uri)).blob());
    return blob.text();
  }
  return new File(asset.uri).text();
}
