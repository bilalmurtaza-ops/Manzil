import Constants from 'expo-constants';
import { useEffect } from 'react';
import { AppState, type AppStateStatus, Platform } from 'react-native';
import { deviceLabel, useCloudStore } from '../store/useCloudStore';
import { useAppStore } from '../store/useAppStore';
import { currentBackupState, fingerprint } from './backupRestore';
import { BackupError, isRetryable, mapSupabaseError, pushBackup } from './cloudBackup';
import { isCloudConfigured, startAuthAutoRefresh, stopAuthAutoRefresh } from './supabase';

/**
 * Decides WHEN a backup uploads. Backup is strictly best-effort background work:
 * nothing here may block, delay, or gate a study action, and no failure here may
 * reach a render — every callback body is wrapped.
 */

/** Wait for changes to settle, so a quiz's burst of writes becomes one upload. */
const DEBOUNCE_MS = 45_000;
/** Floor between automatic attempts. Manual and background flushes bypass it. */
const MIN_INTERVAL_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 30 * 60_000;

type Reason = 'idle' | 'background' | 'foreground-retry' | 'manual' | 'armed';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let lastAttemptAt = 0;
let unsubscribeStore: (() => void) | null = null;
let appStateSub: { remove: () => void } | null = null;
let started = false;

function envelopeMeta() {
  const { deviceId } = useCloudStore.getState();
  return {
    appVersion: Constants.expoConfig?.version ?? '',
    platform: Platform.OS,
    deviceLabel: deviceLabel(Platform.OS, deviceId),
  };
}

function clearDebounce() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** True when local content differs from what was last successfully uploaded. */
export function isDirty(): boolean {
  const { lastFingerprint } = useCloudStore.getState();
  return fingerprint(currentBackupState()) !== lastFingerprint;
}

function backoffRemainingMs(): number {
  const { consecutiveFailures, lastError } = useCloudStore.getState();
  if (consecutiveFailures === 0 || !lastError) return 0;
  const wait = Math.min(BACKOFF_BASE_MS * 2 ** (consecutiveFailures - 1), BACKOFF_MAX_MS);
  const since = Date.now() - new Date(lastError.at).getTime();
  return Math.max(0, wait - since);
}

/**
 * Whether an automatic attempt is allowed right now. Manual attempts skip this
 * entirely — a student pressing "Back up now" should always get an attempt and a
 * real error message if it fails.
 */
function canAutoAttempt(reason: Reason): boolean {
  const s = useCloudStore.getState();
  if (!isCloudConfigured()) return false;
  if (!s.session) return false;
  if (s.autoBackup !== 'armed') return false;
  // A conflict must be resolved by the student; retrying is how the newer copy dies.
  if (s.conflict) return false;
  if (s.status !== 'idle') return false;
  if (backoffRemainingMs() > 0) return false;
  if (reason !== 'background' && Date.now() - lastAttemptAt < MIN_INTERVAL_MS) return false;
  return true;
}

/**
 * Perform one upload. Coalesced: concurrent triggers await the same promise
 * rather than racing two writes at the same `rev`.
 */
export function requestBackup(reason: Reason): Promise<void> {
  if (inFlight) return inFlight;

  const manual = reason === 'manual';
  if (!manual && !canAutoAttempt(reason)) return Promise.resolve();
  if (manual && (!isCloudConfigured() || !useCloudStore.getState().session)) {
    return Promise.resolve();
  }
  if (!manual && !isDirty()) return Promise.resolve();

  clearDebounce();
  lastAttemptAt = Date.now();

  const cloud = useCloudStore.getState();
  cloud.setStatus('uploading');

  const state = currentBackupState();
  const fp = fingerprint(state);

  inFlight = (async () => {
    try {
      const result = await pushBackup(state, envelopeMeta(), {
        expectedRev: useCloudStore.getState().lastBackupRev,
      });
      useCloudStore.getState().recordSuccess(result.rev, fp, result.updatedAt);
      if (__DEV__) console.log(`[cloud] uploaded rev ${result.rev} (${result.byteSize} B, ${reason})`);
    } catch (e) {
      const err = e instanceof BackupError ? e : mapSupabaseError(e);
      useCloudStore.getState().recordFailure({
        kind: err.kind,
        message: err.message,
        at: new Date().toISOString(),
      });
      if (__DEV__) console.log(`[cloud] upload failed (${err.kind}): ${err.message}`);
      // Manual callers surface the error themselves; automatic ones stay silent
      // and let the Settings status line carry it.
      if (manual) throw err;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/** Schedules a debounced attempt; repeated calls push the deadline out. */
function scheduleDebounced() {
  clearDebounce();
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void requestBackup('idle').catch(() => {
      // requestBackup already recorded the failure; nothing to do here.
    });
  }, DEBOUNCE_MS);
}

function handleAppStateChange(next: AppStateStatus) {
  try {
    if (next === 'active') {
      startAuthAutoRefresh();
      const s = useCloudStore.getState();
      // Retry only what is genuinely retryable — auth/conflict/quota recur identically.
      if (s.lastError && isRetryable(s.lastError.kind) && isDirty()) {
        void requestBackup('foreground-retry').catch(() => {});
      }
      return;
    }

    stopAuthAutoRefresh();
    // Backgrounding is the important one on Android, where the OS can kill the
    // process outright. Flush immediately, bypassing the rate floor.
    if (isDirty()) {
      void requestBackup('background').catch(() => {});
    }
  } catch {
    // Never let lifecycle plumbing throw into React.
  }
}

/**
 * Registers the store subscription and AppState listener for the app's lifetime.
 * Idempotent — safe if a Fast Refresh re-runs the hook.
 */
export function startBackupScheduler(): void {
  if (started) return;
  started = true;

  try {
    if (Platform.OS !== 'web') startAuthAutoRefresh();

    unsubscribeStore = useAppStore.subscribe(() => {
      try {
        // Never upload on hydration: lastFingerprint is persisted, so relaunching
        // with unchanged data is not dirty and schedules nothing.
        if (!useCloudStore.getState().hydrated) return;
        if (!canAutoAttempt('idle')) return;
        if (!isDirty()) return;
        scheduleDebounced();
      } catch {
        // A fingerprint failure must not break the app's state updates.
      }
    });

    appStateSub = AppState.addEventListener('change', handleAppStateChange);
  } catch {
    started = false;
  }
}

export function stopBackupScheduler(): void {
  clearDebounce();
  try {
    unsubscribeStore?.();
    appStateSub?.remove();
  } catch {
    // Best effort.
  }
  unsubscribeStore = null;
  appStateSub = null;
  started = false;
}

/** One-line hook for app/_layout.tsx. */
export function useBackupScheduler(): void {
  useEffect(() => {
    startBackupScheduler();
    return () => stopBackupScheduler();
  }, []);
}
