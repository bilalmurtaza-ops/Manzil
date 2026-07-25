import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { BackupErrorKind } from '../lib/cloudBackup';
import type { RemoteMeta } from '../lib/cloudBackup';

/**
 * Cloud-backup sync metadata, deliberately kept in a SEPARATE store on its own
 * AsyncStorage key rather than inside 'manzil-store'. Three reasons, all
 * load-bearing:
 *
 *  1. Sync state can never end up inside a backup payload (which would restore
 *     one device's revision/arming state onto another device).
 *  2. `resetAll()` in useAppStore cannot silently re-arm or disarm backup.
 *  3. A reinstall wipes this key, so `autoBackup` is 'off' on a fresh install by
 *     construction — a wall against overwriting a good cloud backup with an
 *     empty one (see cloudBackup.pushBackup).
 */

export type AutoBackupMode = 'off' | 'armed';
export type CloudStatus = 'idle' | 'checking' | 'uploading' | 'downloading';

export interface CloudErrorInfo {
  kind: BackupErrorKind;
  message: string;
  at: string;
}

interface CloudState {
  // ---- persisted ----
  /** Short stable id used to label which device made a backup. */
  deviceId: string;
  /** Display mirror only — supabase-js owns the real session. */
  session: { userId: string; email: string } | null;
  /**
   * Whether this device may upload automatically. Starts 'off' and is only ever
   * flipped by armDevice(), which is called from exactly two confirmed actions.
   */
  autoBackup: AutoBackupMode;
  lastBackupAt: string | null;
  /** Server revision this device believes is current; drives optimistic concurrency. */
  lastBackupRev: number | null;
  /** Content fingerprint at last successful upload — how "dirty" is determined. */
  lastFingerprint: string | null;
  lastError: CloudErrorInfo | null;
  consecutiveFailures: number;
  /** Set when a push was refused because the cloud copy moved on. */
  conflict: boolean;
  /** ISO time a pre-restore undo snapshot was written, if one exists. */
  undoAvailableAt: string | null;
  /** Set once the student dismisses the Today-screen nudge. */
  nudgeDismissedAt: string | null;

  // ---- transient (never persisted) ----
  hydrated: boolean;
  status: CloudStatus;
  remoteMeta: RemoteMeta | null;

  // ---- actions ----
  setSession: (session: { userId: string; email: string } | null) => void;
  armDevice: (reason: 'user-backed-up' | 'user-restored') => void;
  disarm: (reason: string) => void;
  setStatus: (status: CloudStatus) => void;
  setRemoteMeta: (meta: RemoteMeta | null) => void;
  recordSuccess: (rev: number, fingerprint: string, at?: string) => void;
  recordFailure: (info: CloudErrorInfo) => void;
  clearError: () => void;
  setConflict: (conflict: boolean) => void;
  setFingerprint: (fingerprint: string) => void;
  setUndoAvailableAt: (at: string | null) => void;
  dismissNudge: () => void;
  /** Called on sign-out: forget account-scoped state but keep deviceId + nudge. */
  clearAccountState: () => void;
}

/** Short device tag, e.g. "A7F3" — follows the repo's local-counter id convention. */
const makeDeviceId = () =>
  Math.floor(Math.random() * 0xffff)
    .toString(16)
    .toUpperCase()
    .padStart(4, '0');

export const useCloudStore = create<CloudState>()(
  persist(
    (set) => ({
      deviceId: makeDeviceId(),
      session: null,
      autoBackup: 'off',
      lastBackupAt: null,
      lastBackupRev: null,
      lastFingerprint: null,
      lastError: null,
      consecutiveFailures: 0,
      conflict: false,
      undoAvailableAt: null,
      nudgeDismissedAt: null,

      hydrated: false,
      status: 'idle',
      remoteMeta: null,

      setSession: (session) => set({ session }),

      // The ONLY function that enables automatic uploads. Both call sites sit
      // behind an explicit user confirmation, so grepping this name shows every
      // way a device can start writing to the cloud.
      armDevice: (reason) => {
        if (__DEV__) console.log('[cloud] armed:', reason);
        set({ autoBackup: 'armed', conflict: false, lastError: null, consecutiveFailures: 0 });
      },

      disarm: (reason) => {
        if (__DEV__) console.log('[cloud] disarmed:', reason);
        set({ autoBackup: 'off' });
      },

      setStatus: (status) => set({ status }),
      setRemoteMeta: (remoteMeta) => set({ remoteMeta }),

      recordSuccess: (rev, fingerprint, at) =>
        set({
          lastBackupAt: at ?? new Date().toISOString(),
          lastBackupRev: rev,
          lastFingerprint: fingerprint,
          lastError: null,
          consecutiveFailures: 0,
          conflict: false,
          status: 'idle',
        }),

      recordFailure: (info) =>
        set((s) => ({
          lastError: info,
          consecutiveFailures: s.consecutiveFailures + 1,
          status: 'idle',
          conflict: info.kind === 'conflict' ? true : s.conflict,
          // A conflict must stop automatic uploads until the student chooses a
          // copy — retrying would be exactly how the newer copy gets destroyed.
          autoBackup: info.kind === 'conflict' || info.kind === 'auth' ? 'off' : s.autoBackup,
        })),

      clearError: () => set({ lastError: null }),
      setConflict: (conflict) => set({ conflict }),
      setFingerprint: (lastFingerprint) => set({ lastFingerprint }),
      setUndoAvailableAt: (undoAvailableAt) => set({ undoAvailableAt }),
      dismissNudge: () => set({ nudgeDismissedAt: new Date().toISOString() }),

      clearAccountState: () =>
        set({
          session: null,
          autoBackup: 'off',
          lastBackupAt: null,
          lastBackupRev: null,
          lastFingerprint: null,
          lastError: null,
          consecutiveFailures: 0,
          conflict: false,
          remoteMeta: null,
          status: 'idle',
        }),
    }),
    {
      name: 'manzil-cloud-v1',
      storage: createJSONStorage(() => AsyncStorage),
      // This store we fully control, so transient fields are excluded explicitly
      // rather than relying on nobody adding one by accident.
      partialize: (s) => ({
        deviceId: s.deviceId,
        session: s.session,
        autoBackup: s.autoBackup,
        lastBackupAt: s.lastBackupAt,
        lastBackupRev: s.lastBackupRev,
        lastFingerprint: s.lastFingerprint,
        lastError: s.lastError,
        consecutiveFailures: s.consecutiveFailures,
        conflict: s.conflict,
        undoAvailableAt: s.undoAvailableAt,
        nudgeDismissedAt: s.nudgeDismissedAt,
      }),
      onRehydrateStorage: () => () => {
        useCloudStore.setState({ hydrated: true, status: 'idle', remoteMeta: null });
      },
    },
  ),
);

/** Human label for which device a backup came from, e.g. "Android (A7F3)". */
export function deviceLabel(platform: string, deviceId: string): string {
  const os = platform === 'ios' ? 'iPhone' : platform === 'web' ? 'Browser' : 'Android';
  return `${os} (${deviceId})`;
}
