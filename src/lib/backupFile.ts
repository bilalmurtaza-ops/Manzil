import { BackupError } from './cloudBackup';
import type { BackupFileApi } from './backupFileTypes';

/**
 * Fallback implementation and the file TypeScript resolves for `./backupFile`.
 *
 * At bundle time Metro picks `backupFile.native.ts` on Android/iOS and
 * `backupFile.web.ts` on web via platform extensions, so this body should never
 * actually run. It throws a typed, user-readable error rather than crashing, in
 * keeping with the rule that no failure mode may dead-end a screen.
 */

const unsupported = (): never => {
  throw new BackupError('Backup files are not supported on this platform.', 'config');
};

export const exportBackupFile: BackupFileApi['exportBackupFile'] = async () => unsupported();
export const pickBackupFile: BackupFileApi['pickBackupFile'] = async () => unsupported();

export type { ExportOutcome } from './backupFileTypes';
