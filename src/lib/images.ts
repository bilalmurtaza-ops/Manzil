import * as ImagePicker from 'expo-image-picker';

/** Base64 image bytes plus the mime type Gemini should decode them as. */
export interface PickedImage {
  base64: string;
  mimeType: string;
}

// Gemini's supported inline image types. Anything else (or a missing type) falls
// back to jpeg — which is what camera captures are and what the code assumed before,
// so this only ever *corrects* a mislabeled gallery pick, never regresses the common case.
const GEMINI_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
function geminiMime(m?: string | null): string {
  const lower = m?.toLowerCase();
  return lower && GEMINI_MIME.includes(lower) ? lower : 'image/jpeg';
}

function toPicked(asset: ImagePicker.ImagePickerAsset | undefined): PickedImage | null {
  if (!asset?.base64) return null;
  return { base64: asset.base64, mimeType: geminiMime(asset.mimeType) };
}

/** Pick an image from camera or gallery, returning base64 bytes + its real mime type. */
export async function pickImage(source: 'camera' | 'gallery'): Promise<PickedImage | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
    const result = await ImagePicker.launchCameraAsync({
      base64: true,
      quality: 0.5,
      allowsEditing: false,
    });
    return result.canceled ? null : toPicked(result.assets[0]);
  }
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    base64: true,
    quality: 0.5,
  });
  return result.canceled ? null : toPicked(result.assets[0]);
}
