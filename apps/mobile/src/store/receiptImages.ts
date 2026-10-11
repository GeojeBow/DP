import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Phase 1 keeps compressed receipt images (~100 KB JPEG data URIs) on the device.
 * Each image lives under its own key so the expense list stays small to load.
 * Phase 2 moves images to the file system and Supabase Storage.
 */
const key = (id: string) => `receipt-image:${id}`;

export async function saveReceiptImage(id: string, dataUri: string): Promise<void> {
  await AsyncStorage.setItem(key(id), dataUri);
}

export async function loadReceiptImage(id: string): Promise<string | null> {
  return AsyncStorage.getItem(key(id));
}

export async function deleteReceiptImage(id: string): Promise<void> {
  await AsyncStorage.removeItem(key(id));
}
