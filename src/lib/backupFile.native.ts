import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { buildEnvelope } from './backupSchema';
import { backupFileName, type BackupFileApi } from './backupFileTypes';
import { BackupError } from './cloudBackup';

/**
 * Native file export/import — the vendor-independent safety net. Needs no
 * account, no network, and no Supabase project, so it keeps working when the
 * cloud path is unconfigured, paused, or rate-limited.
 *
 * API verified against the installed expo-file-system@57 shipped types:
 * `new File(Paths.cache, name)`, `file.create({ overwrite })`, `file.write(str)`,
 * `await file.text()`.
 */

export const exportBackupFile: BackupFileApi['exportBackupFile'] = async (state, meta) => {
  if (!state.profile) {
    throw new BackupError('Nothing to export yet — finish setting up your study plan first.', 'empty');
  }

  const fileName = backupFileName();
  const envelope = buildEnvelope(state, meta);
  const json = JSON.stringify(envelope, null, 2);

  // Cache first: this is a hand-off artifact, and the OS may reclaim it later.
  let file = new File(Paths.cache, fileName);
  try {
    // overwrite so exporting twice on the same day doesn't fail on the date-based name.
    file.create({ overwrite: true });
    file.write(json);
  } catch (e) {
    throw new BackupError(
      `Couldn't write the backup file: ${e instanceof Error ? e.message : 'unknown error'}`,
      'server',
    );
  }

  // Sharing is how the student actually gets the file off the device (Drive,
  // WhatsApp, email). If it's unavailable, fall back to leaving it somewhere
  // permanent and telling them the path — never a dead end.
  try {
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(file.uri, {
        mimeType: 'application/json',
        dialogTitle: 'Save your Manzil backup',
        UTI: 'public.json',
      });
      return { fileName, via: 'share-sheet', uri: file.uri };
    }
  } catch (e) {
    // A cancelled share sheet also lands here on some Android OEMs; the file is
    // already written, so treat this as "saved" rather than failing outright.
    if (__DEV__) console.log('[backupFile] share failed, falling back to disk', e);
  }

  try {
    const permanent = new File(Paths.document, fileName);
    permanent.create({ overwrite: true });
    permanent.write(json);
    file = permanent;
  } catch {
    // Keep the cache copy if the document-directory write fails.
  }

  return { fileName, via: 'saved-to-device', uri: file.uri };
};

export const pickBackupFile: BackupFileApi['pickBackupFile'] = async () => {
  let result: DocumentPicker.DocumentPickerResult;
  try {
    result = await DocumentPicker.getDocumentAsync({
      // Some Android file providers report JSON as octet-stream, so accept both
      // rather than showing the student an empty picker.
      type: ['application/json', 'application/octet-stream', 'text/plain'],
      copyToCacheDirectory: true,
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
  if (!asset?.uri) throw new BackupError("That file couldn't be read.", 'corrupt');

  try {
    const text = await new File(asset.uri).text();
    if (!text.trim()) throw new BackupError('That file is empty.', 'corrupt');
    return text;
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError("That file couldn't be read.", 'corrupt');
  }
};

export type { ExportOutcome } from './backupFileTypes';
