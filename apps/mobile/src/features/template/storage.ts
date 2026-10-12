import AsyncStorage from '@react-native-async-storage/async-storage';

export { fromBase64, toBase64 } from './base64';
import { fromBase64, toBase64 } from './base64';

/** Uploaded template files, kept on the device like receipt images (see receiptImages.ts). */
const key = (id: string) => `company-template:${id}`;

export async function saveTemplateFile(id: string, bytes: Uint8Array): Promise<void> {
  await AsyncStorage.setItem(key(id), toBase64(bytes));
}

export async function loadTemplateFile(id: string): Promise<Uint8Array | null> {
  const b64 = await AsyncStorage.getItem(key(id));
  return b64 ? fromBase64(b64) : null;
}

export async function deleteTemplateFile(id: string): Promise<void> {
  await AsyncStorage.removeItem(key(id));
}
