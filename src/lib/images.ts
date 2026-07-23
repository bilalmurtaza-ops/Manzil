import * as ImagePicker from 'expo-image-picker';

/** Pick an image from camera or gallery, returning base64 JPEG (no data URI prefix). */
export async function pickImage(source: 'camera' | 'gallery'): Promise<string | null> {
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return null;
    const result = await ImagePicker.launchCameraAsync({
      base64: true,
      quality: 0.5,
      allowsEditing: false,
    });
    return result.canceled ? null : (result.assets[0]?.base64 ?? null);
  }
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) return null;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    base64: true,
    quality: 0.5,
  });
  return result.canceled ? null : (result.assets[0]?.base64 ?? null);
}
