import * as DocumentPicker from 'expo-document-picker';
import { buildEnvelope } from './backupSchema';
import { backupFileName, type BackupFileApi } from './backupFileTypes';
import { BackupError } from './cloudBackup';

/**
 * Web file export/import, used by `npm run web` — this project's primary QA path.
 *
 * Deliberately imports NO expo-file-system and NO expo-sharing: neither is
 * supported on web, and Metro would still bundle them if this file referenced
 * them. Browser-native Blob/anchor-download and the picker's own `File` object
 * cover both directions.
 */

export const exportBackupFile: BackupFileApi['exportBackupFile'] = async (state, meta) => {
  if (!state.profile) {
    throw new BackupError('Nothing to export yet — finish setting up your study plan first.', 'empty');
  }

  const fileName = backupFileName();
  const json = JSON.stringify(buildEnvelope(state, meta), null, 2);

  let url: string | null = null;
  try {
    const blob = new Blob([json], { type: 'application/json' });
    url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (e) {
    throw new BackupError(
      `Couldn't download the backup file: ${e instanceof Error ? e.message : 'unknown error'}`,
      'server',
    );
  } finally {
    // Revoke on the next tick — revoking synchronously can cancel the download
    // in some browsers before it starts.
    if (url) setTimeout(() => URL.revokeObjectURL(url as string), 10_000);
  }

  return { fileName, via: 'download' };
};

export const pickBackupFile: BackupFileApi['pickBackupFile'] = async () => {
  let result: DocumentPicker.DocumentPickerResult;
  try {
    result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      multiple: false,
    });
  } catch (e) {
    throw new BackupError(
      `Couldn't open the file picker: ${e instanceof Error ? e.message : 'unknown error'}`,
      'server',
    );
  }

  if (result.canceled) throw new BackupError('No file chosen.', 'cancelled');

  const asset = result.assets?.[0];
  if (!asset) throw new BackupError("That file couldn't be read.", 'corrupt');

  // On web the picker exposes the real browser File object; prefer it.
  if (asset.file) {
    const text = await asset.file.text();
    if (!text.trim()) throw new BackupError('That file is empty.', 'corrupt');
    return text;
  }

  // Fallback: base64 data (the web picker's default when `base64` isn't disabled).
  if (asset.base64) {
    try {
      const raw = asset.base64.includes(',') ? asset.base64.split(',')[1] : asset.base64;
      // decodeURIComponent/escape round-trip keeps multi-byte Urdu text intact,
      // which a bare atob() would mangle.
      const text = decodeURIComponent(escape(atob(raw)));
      if (!text.trim()) throw new BackupError('That file is empty.', 'corrupt');
      return text;
    } catch (e) {
      if (e instanceof BackupError) throw e;
      throw new BackupError("That file couldn't be decoded.", 'corrupt');
    }
  }

  // Last resort: the URI may be a blob: or data: URL we can fetch.
  if (asset.uri) {
    try {
      const res = await fetch(asset.uri);
      const text = await res.text();
      if (!text.trim()) throw new BackupError('That file is empty.', 'corrupt');
      return text;
    } catch (e) {
      if (e instanceof BackupError) throw e;
      throw new BackupError("That file couldn't be read.", 'corrupt');
    }
  }

  throw new BackupError("That file couldn't be read.", 'corrupt');
};

export type { ExportOutcome } from './backupFileTypes';
