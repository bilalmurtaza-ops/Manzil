import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

/** Base64 image bytes plus the mime type Gemini should decode them as. */
export interface PickedImage {
  base64: string;
  mimeType: string;
}

// Gemini downsamples anything larger to ~this working resolution internally, so capping the
// longest edge here is lossless from the model's point of view while cutting the payload ~5-10x.
// Measured live: prompt-token cost is flat from 256px up to 1568px on gemini-3.5-flash.
const TARGET_EDGE = 1568;
// Near-lossless — a deliberate jump up from the old quality:0.5, so text/handwriting reaches
// Gemini *sharper* than before even though the file is far smaller. JPEG stays tiny for photos.
const JPEG_QUALITY = 0.92;

/**
 * Downscale (never upscale) to TARGET_EDGE on the longest side and re-encode as high-quality
 * JPEG with base64. Resizing by one dimension preserves aspect ratio. Falls back to a plain
 * re-encode if the resize path throws, so the feature can never hard-break on an odd file.
 */
async function processAsset(asset: ImagePicker.ImagePickerAsset): Promise<PickedImage | null> {
  const { uri, width, height } = asset;
  const longest = Math.max(width ?? 0, height ?? 0);

  const encode = async (resize: boolean): Promise<PickedImage | null> => {
    const ctx = ImageManipulator.manipulate(uri);
    if (resize && width && height) {
      if (width >= height) ctx.resize({ width: TARGET_EDGE });
      else ctx.resize({ height: TARGET_EDGE });
    }
    const rendered = await ctx.renderAsync();
    const out = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: JPEG_QUALITY, base64: true });
    if (__DEV__) {
      console.log('[pickImage]', {
        origW: width, origH: height, outW: out.width, outH: out.height,
        base64KB: out.base64 ? Math.round(out.base64.length / 1024) : 0,
      });
    }
    return out.base64 ? { base64: out.base64, mimeType: 'image/jpeg' } : null;
  };

  try {
    return await encode(longest > TARGET_EDGE);
  } catch {
    // Resize failed on this file — try a straight re-encode (no resize) before giving up.
    try {
      return await encode(false);
    } catch {
      return null;
    }
  }
}

/** Pick an image from camera or gallery, downscaled + re-encoded for a fast, sharp Gemini call. */
export async function pickImage(source: 'camera' | 'gallery'): Promise<PickedImage | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
    // No base64 here: we never encode the full-res image — processAsset encodes the downscaled one.
    const result = await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: false });
    return result.canceled || !result.assets[0] ? null : processAsset(result.assets[0]);
  }
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  return result.canceled || !result.assets[0] ? null : processAsset(result.assets[0]);
}
