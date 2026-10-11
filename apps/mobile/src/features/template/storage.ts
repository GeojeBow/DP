import AsyncStorage from '@react-native-async-storage/async-storage';

/** Uploaded template files, kept on the device like receipt images (see receiptImages.ts). */
const key = (id: string) => `company-template:${id}`;

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

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
