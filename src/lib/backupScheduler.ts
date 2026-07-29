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

/**
 * Heartbeat while the app is open. The scheduler was purely REACTIVE before
 * this — it uploaded on a store change or on backgrounding, and nothing else.
 * Two holes followed: data changed while an upload was already in flight (or
 * during backoff) could sit unsent indefinitely, and a process killed by
 * Android without a clean background transition left the change stranded until
 * the student happened to edit something else.
 *
 * Only fires when there is genuinely something to send, so an idle app costs
 * nothing. 30 minutes is well inside a study session and far under the once-a-
 * day expectation, without turning an 80 KB payload into chatter.
 */
const PERIODIC_MS = 30 * 60_000;

/**
 * Grace period after launch before the catch-up attempt, so hydration and the
 * first render settle first. Backup must never compete with the app becoming
 * usable.
 */
const LAUNCH_CATCHUP_MS = 20_000;

/**
 * Minimum gap between MANUAL uploads.
 *
 * Manual deliberately bypasses every automatic guard so a student always gets a
 * real attempt and a real error — which also means one tap is one full upload
 * and one server-side `rev` bump. Without a floor, holding the button spends
 * free-tier writes and inflates `rev` for nothing. Short enough to be invisible
 * to honest use: it only ever blocks a second tap seconds after the first.
 */
const MANUAL_MIN_INTERVAL_MS = 60_000;

type Reason =
  | 'idle'
  | 'background'
  | 'foreground-retry'
  | 'manual'
  | 'armed'
  /** Heartbeat tick while the app is open. */
  | 'periodic'
  /** One catch-up shortly after launch, for changes stranded by a killed process. */
  | 'launch';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
/**
 * Whether *any* caller currently awaiting `inFlight` needs its failure
 * rethrown. Set from the closure-captured `manual` flag of whichever call
 * started the upload, but ALSO updated by a manual call that joins an
 * already-running non-manual upload — otherwise a "Back up now" tap that
 * happens to land while an idle/background auto-attempt is mid-flight would
 * silently swallow that attempt's failure (it only rethrows for its
 * originator) and the manual caller would see a false success.
 */
let inFlightWantsThrow = false;
let lastAttemptAt = 0;
/** When a manual upload last actually STARTED — drives the anti-spam floor. */
let lastManualAt = 0;
let unsubscribeStore: (() => void) | null = null;
let appStateSub: { remove: () => void } | null = null;
let periodicTimer: ReturnType<typeof setInterval> | null = null;
let launchTimer: ReturnType<typeof setTimeout> | null = null;
let started = false;

/**
 * Milliseconds until "Back up now" may be tapped again, 0 when it is free.
 * Exported so the button can disable itself and count down, rather than the
 * student tapping into an error.
 */
export function manualCooldownRemainingMs(): number {
  if (lastManualAt === 0) return 0;
  return Math.max(0, MANUAL_MIN_INTERVAL_MS - (Date.now() - lastManualAt));
}

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
  // The 5-minute floor exists to stop a burst of store writes becoming a burst
  // of uploads. Reasons that are already self-spaced, or that are the last
  // chance to save the data at all, are exempt.
  const selfSpaced = reason === 'background' || reason === 'periodic' || reason === 'launch';
  if (!selfSpaced && Date.now() - lastAttemptAt < MIN_INTERVAL_MS) return false;
  return true;
}

/**
 * Perform one upload. Coalesced: concurrent triggers await the same promise
 * rather than racing two writes at the same `rev`.
 */
export function requestBackup(reason: Reason): Promise<void> {
  const manual = reason === 'manual';
  if (inFlight) {
    // Joining an existing upload rather than racing a second write is correct —
    // but if THIS caller is manual, its failure must still surface even though
    // it didn't start the request. Safe to set after the fact: `inFlight` is
    // only cleared in the `finally` below, which runs strictly after the catch
    // that reads this flag, so a manual joiner can never miss the check.
    if (manual) inFlightWantsThrow = true;
    return inFlight;
  }

  if (!manual && !canAutoAttempt(reason)) return Promise.resolve();
  if (manual && (!isCloudConfigured() || !useCloudStore.getState().session)) {
    return Promise.resolve();
  }
  if (!manual && !isDirty()) return Promise.resolve();

  if (manual) {
    // Anti-spam floor. Rejected BEFORE any store mutation or network call, so a
    // blocked tap leaves no trace in the error state — it is not a backup
    // failure, and must not show up as one in the status line or trip backoff.
    const wait = manualCooldownRemainingMs();
    if (wait > 0) {
      return Promise.reject(
        new BackupError(
          `Just backed up. You can back up again in ${Math.ceil(wait / 1000)}s.`,
          'rate-limit',
        ),
      );
    }
    lastManualAt = Date.now();
  }

  clearDebounce();
  lastAttemptAt = Date.now();

  const cloud = useCloudStore.getState();
  cloud.setStatus('uploading');

  const state = currentBackupState();
  const fp = fingerprint(state);
  inFlightWantsThrow = manual;

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
      // Manual callers (the original one, or one that joined mid-flight above)
      // surface the error themselves; purely automatic attempts stay silent and
      // let the Settings status line carry it.
      if (inFlightWantsThrow) throw err;
    } finally {
      inFlight = null;
      inFlightWantsThrow = false;
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

    // Catch-up: a process Android killed without a clean background transition
    // leaves its last change unsent, and nothing else here would notice until
    // the student happened to edit something new. Delayed so it never competes
    // with hydration or first paint.
    launchTimer = setTimeout(() => {
      launchTimer = null;
      try {
        if (isDirty()) void requestBackup('launch').catch(() => {});
      } catch {
        // Never let the catch-up throw into the app.
      }
    }, LAUNCH_CATCHUP_MS);

    // Heartbeat: uploads only when there is something outstanding, so an idle
    // app is free. This is what makes "it backs itself up" true even if the
    // student never leaves the app and the store subscription's debounce was
    // skipped (upload in flight, backoff, or the 5-minute floor).
    periodicTimer = setInterval(() => {
      try {
        if (isDirty()) void requestBackup('periodic').catch(() => {});
      } catch {
        // Same.
      }
    }, PERIODIC_MS);
  } catch {
    started = false;
  }
}

export function stopBackupScheduler(): void {
  clearDebounce();
  try {
    unsubscribeStore?.();
    appStateSub?.remove();
    if (periodicTimer) clearInterval(periodicTimer);
    if (launchTimer) clearTimeout(launchTimer);
  } catch {
    // Best effort.
  }
  unsubscribeStore = null;
  appStateSub = null;
  periodicTimer = null;
  launchTimer = null;
  started = false;
}

/** One-line hook for app/_layout.tsx. */
export function useBackupScheduler(): void {
  useEffect(() => {
    startBackupScheduler();
    return () => stopBackupScheduler();
  }, []);
}
