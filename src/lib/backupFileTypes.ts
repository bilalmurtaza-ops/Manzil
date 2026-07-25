import type { BackupData } from './backupSchema';
import type { EnvelopeMeta } from './backupSchema';

/**
 * Contract shared by the native and web implementations of file export/import.
 *
 * Each of backupFile.ts / backupFile.native.ts / backupFile.web.ts annotates its
 * exports with these member types (`BackupFileApi['exportBackupFile']` etc.), so
 * a signature drifting between platforms is a compile error rather than a runtime
 * surprise that only shows up on one platform.
 */
export interface BackupFileApi {
  /** Serialize state to a .json file and hand it to the user. Returns a description of where it went. */
  exportBackupFile: (state: BackupData, meta: EnvelopeMeta) => Promise<ExportOutcome>;
  /** Let the user choose a .json backup and return its raw text. */
  pickBackupFile: () => Promise<string>;
}

export interface ExportOutcome {
  /** File name written, e.g. "manzil-backup-2026-07-25.json". */
  fileName: string;
  /** How it was delivered — shapes the confirmation copy shown to the student. */
  via: 'share-sheet' | 'download' | 'saved-to-device';
  /** Set when the file was left on disk rather than shared, so we can show the path. */
  uri?: string;
}

export function backupFileName(): string {
  return `manzil-backup-${new Date().toISOString().slice(0, 10)}.json`;
}
