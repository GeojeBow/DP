import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform, TurboModuleRegistry } from 'react-native';

import { uuidv7 } from '../../domain/id';
import { loadReceiptImage, saveReceiptImage } from '../../store/receiptImages';
import { cropArea } from './cropArea';
import type { ReceiptBox } from './readReceipt';

export type PickSource = 'camera' | 'gallery';

export type PickResult =
  | { status: 'picked'; receiptId: string }
  | { status: 'cancelled' }
  | { status: 'denied'; message: string };

const MAX_EDGE = 1600;

type Scanner = typeof import('react-native-document-scanner-plugin').default;

/**
 * The phone's document scanner (Google ML Kit on Android): finds the receipt's edges,
 * straightens it and cleans it up like a flatbed scan. Null on web and on installs built
 * before it was added, which an over-the-air update can still reach.
 */
function documentScanner(): Scanner | null {
  if (Platform.OS !== 'android' || !TurboModuleRegistry.get('DocumentScanner')) return null;
  try {
    return (require('react-native-document-scanner-plugin') as typeof import('react-native-document-scanner-plugin')).default;
  } catch {
    return null;
  }
}

/** A scanned receipt's file, null when cancelled, undefined when the scanner isn't usable here. */
async function scan(): Promise<{ uri: string } | null | undefined> {
  const scanner = documentScanner();
  if (!scanner) return undefined;
  try {
    const result = await scanner.scanDocument({ maxNumDocuments: 1, croppedImageQuality: 95 });
    const uri = result.scannedImages?.[0];
    if (result.status === 'cancel' || !uri) return null;
    return { uri: uri.startsWith('file://') || uri.startsWith('content://') ? uri : `file://${uri}` };
  } catch {
    return undefined; // e.g. Google Play services missing: use the plain camera
  }
}

/** Opens the scanner, camera or gallery, compresses the image and stores it on the device. */
export async function pickReceipt(source: PickSource): Promise<PickResult> {
  if (source === 'camera') {
    const scanned = await scan();
    if (scanned === null) return { status: 'cancelled' };
    if (scanned) return { status: 'picked', receiptId: await store(scanned.uri) };
  }

  // Browsers ask through the file picker itself; the permission APIs would try getUserMedia.
  const permission =
    Platform.OS === 'web'
      ? { granted: true }
      : source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return {
      status: 'denied',
      message: source === 'camera' ? '카메라 권한이 필요합니다. 설정에서 허용해 주세요.' : '사진 접근 권한이 필요합니다.',
    };
  }

  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
  const result =
    source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return { status: 'cancelled' };

  return { status: 'picked', receiptId: await store(asset.uri, asset.width, asset.height) };
}

async function store(uri: string, width?: number, height?: number): Promise<string> {
  let context = ImageManipulator.manipulate(uri);
  if (!width || !height) {
    const probe = await context.renderAsync();
    width = probe.width;
    height = probe.height;
    context = ImageManipulator.manipulate(uri);
  }
  const resize = width >= height ? { width: Math.min(width, MAX_EDGE) } : { height: Math.min(height, MAX_EDGE) };
  const rendered = await context.resize(resize).renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
  if (!saved.base64) throw new Error('Image compression returned no data');

  const receiptId = uuidv7();
  await saveReceiptImage(receiptId, `data:image/jpeg;base64,${saved.base64}`);
  return receiptId;
}

/**
 * Crops a stored receipt photo to the receipt paper the AI found, so photos picked from the
 * gallery look like scans in reports too. Returns the new image, or null when nothing changed.
 */
export async function cropToReceipt(receiptId: string, box: ReceiptBox): Promise<string | null> {
  const area = cropArea(box);
  if (!area) return null;
  const dataUri = await loadReceiptImage(receiptId);
  const base64 = dataUri && /^data:image\/[a-z]+;base64,(.+)$/.exec(dataUri)?.[1];
  if (!dataUri || !base64) return null;
  let source = dataUri;
  let temp: File | undefined;
  if (Platform.OS !== 'web') {
    temp = new File(Paths.cache, `crop-${receiptId}.jpg`);
    if (temp.exists) temp.delete();
    temp.create();
    temp.write(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
    source = temp.uri;
  }
  try {
    const { width, height } = await ImageManipulator.manipulate(source).renderAsync();
    const crop = {
      originX: Math.round(area.left * width),
      originY: Math.round(area.top * height),
      width: Math.round((area.right - area.left) * width),
      height: Math.round((area.bottom - area.top) * height),
    };
    const rendered = await ImageManipulator.manipulate(source).crop(crop).renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: true });
    if (!saved.base64) return null;
    const cropped = `data:image/jpeg;base64,${saved.base64}`;
    await saveReceiptImage(receiptId, cropped);
    return cropped;
  } finally {
    if (temp?.exists) temp.delete();
  }
}
