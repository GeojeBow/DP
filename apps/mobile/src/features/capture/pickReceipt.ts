import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import { uuidv7 } from '../../domain/id';
import { saveReceiptImage } from '../../store/receiptImages';

export type PickSource = 'camera' | 'gallery';

export type PickResult =
  | { status: 'picked'; receiptId: string }
  | { status: 'cancelled' }
  | { status: 'denied'; message: string };

const MAX_EDGE = 1600;

/** Opens the camera or gallery, compresses the photo and stores it on the device. */
export async function pickReceipt(source: PickSource): Promise<PickResult> {
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

  const resize = asset.width >= asset.height ? { width: Math.min(asset.width, MAX_EDGE) } : { height: Math.min(asset.height, MAX_EDGE) };
  const rendered = await ImageManipulator.manipulate(asset.uri).resize(resize).renderAsync();
  const saved = await rendered.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
  if (!saved.base64) throw new Error('Image compression returned no data');

  const receiptId = uuidv7();
  await saveReceiptImage(receiptId, `data:image/jpeg;base64,${saved.base64}`);
  return { status: 'picked', receiptId };
}
