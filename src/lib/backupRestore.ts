import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCloudStore } from '../store/useCloudStore';
import { useAppStore, type BackedUpState } from '../store/useAppStore';
import type { BackupEnvelope } from './backupSchema';
import { repairPlan, todayISO } from './planEngine';

/**
 * Applying a restore to local state, plus the local safety net around it.
 *
 * A restore REPLACES this device's data, so it is the most destructive action in
 * the app. Two protections wrap it: a raw snapshot of the previous store written
 * before anything changes (surfaced as "Undo restore" in Settings), and the
 * caller's confirm dialog which quantifies both sides.
 */

const STORE_KEY = 'manzil-store';
const UNDO_KEY = 'manzil-restore-undo-v1';

/**
 * Skip the undo snapshot above this size. Android's AsyncStorage sits on SQLite
 * with a default budget around 6 MB; holding a second full copy of an already
 * large store (quizAttempts and flashcards are uncapped in the store) is a real
 * way to hit it, and failing to write a backup copy must never break the restore.
 */
const MAX_UNDO_BYTES = 2 * 1024 * 1024;

interface UndoSnapshot {
  savedAt: string;
  raw: string;
}

/** A device "has data" exactly when it has a profile — see app/index.tsx routing. */
export function hasLocalData(state: Pick<BackedUpState, 'profile'>): boolean {
  return state.profile !== null;
}

/**
 * Content fingerprint used to decide whether anything actually changed.
 *
 * Cheap by design (no deep equality, no JSON.stringify of the whole store):
 * summing flashcard `reps` is what catches an FSRS review that changes no array
 * length, which a naive length-only check would miss. O(sessions + cards),
 * sub-millisecond on a ~640-session plan.
 */
export function fingerprint(state: BackedUpState): string {
  const p = state.profile;
  const sessions = state.plan?.sessions ?? [];
  let done = 0;
  for (const s of sessions) if (s.done) done++;
  let reps = 0;
  for (const c of state.flashcards) reps += c.reps + c.lapses;

  return [
    p?.name ?? '',
    p?.classLevel ?? '',
    p?.group ?? '',
    p?.boardId ?? '',
    p?.examDate ?? '',
    p?.dailyMinutes ?? 0,
    p ? Object.entries(p.confidence).sort().map(([k, v]) => `${k}:${v}`).join(',') : '',
    state.plan?.generatedAt ?? '',
    sessions.length,
    done,
    state.quizAttempts.length,
    state.flashcards.length,
    reps,
    state.chatHistory.length,
    state.activeDays.length,
    state.vibrationEnabled ? 1 : 0,
  ].join('|');
}

/** Reads the seven backed-up fields out of the live store. */
export function currentBackupState(): BackedUpState {
  const s = useAppStore.getState();
  return {
    profile: s.profile,
    plan: s.plan,
    quizAttempts: s.quizAttempts,
    flashcards: s.flashcards,
    chatHistory: s.chatHistory,
    activeDays: s.activeDays,
    vibrationEnabled: s.vibrationEnabled,
  };
}

export interface ApplyResult {
  /** False when the pre-restore snapshot was skipped (oversized or unreadable). */
  undoSaved: boolean;
  /** True when a stale restored plan was reflowed forward. */
  planRepaired: boolean;
}

/**
 * Overwrite local state with a validated envelope.
 *
 * Order matters and is deliberate — the undo copy is written BEFORE any mutation,
 * so an interruption mid-restore still leaves a way back.
 */
export async function applyEnvelope(envelope: BackupEnvelope): Promise<ApplyResult> {
  // 1. Snapshot the current store, before touching anything.
  let undoSaved = false;
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (raw && raw.length <= MAX_UNDO_BYTES) {
      const snapshot: UndoSnapshot = { savedAt: new Date().toISOString(), raw };
      await AsyncStorage.setItem(UNDO_KEY, JSON.stringify(snapshot));
      undoSaved = true;
    }
  } catch {
    // Undo is a convenience, not a precondition — never block the restore on it.
    undoSaved = false;
  }

  // 2. Apply. Non-replacing setState, so store actions survive; zustand's persist
  //    middleware writes 'manzil-store' itself. `hydrated` is untouched because
  //    BackupData structurally does not contain it.
  const data = envelope.data;
  useAppStore.setState({
    profile: data.profile,
    plan: data.plan,
    quizAttempts: data.quizAttempts,
    flashcards: data.flashcards,
    chatHistory: data.chatHistory,
    activeDays: data.activeDays,
    vibrationEnabled: data.vibrationEnabled,
  });

  // 3. A restored plan is stale almost by definition — it was made on another day.
  //    today.tsx only repairs on mount, which has already happened by now.
  let planRepaired = false;
  const { profile, plan } = useAppStore.getState();
  if (profile && plan) {
    const today = todayISO();
    const hasStale = plan.sessions.some((s) => !s.done && s.date < today);
    if (hasStale) {
      useAppStore.getState().setPlan(repairPlan(plan, profile));
      planRepaired = true;
    }
  }

  // 4. Seed the fingerprint to the just-restored content so the scheduler doesn't
  //    immediately consider this "dirty" and bounce a redundant upload (which
  //    would burn a server rev for no change).
  const cloud = useCloudStore.getState();
  cloud.setFingerprint(fingerprint(currentBackupState()));
  cloud.setUndoAvailableAt(undoSaved ? new Date().toISOString() : null);

  return { undoSaved, planRepaired };
}

/** Whether an undo snapshot is present on disk (not just flagged in the store). */
export async function undoSnapshotExists(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(UNDO_KEY)) !== null;
  } catch {
    return false;
  }
}

/**
 * Put back the store exactly as it was before the last restore.
 * Writes the raw persisted string and rehydrates, rather than reconstructing
 * fields — that way the undo is byte-faithful even for data this app version
 * wouldn't otherwise produce.
 */
export async function undoRestore(): Promise<void> {
  const raw = await AsyncStorage.getItem(UNDO_KEY);
  if (!raw) throw new Error('There is no restore to undo.');

  let snapshot: UndoSnapshot;
  try {
    snapshot = JSON.parse(raw) as UndoSnapshot;
  } catch {
    await AsyncStorage.removeItem(UNDO_KEY);
    throw new Error("The undo copy is damaged and can't be used.");
  }
  if (typeof snapshot.raw !== 'string') {
    await AsyncStorage.removeItem(UNDO_KEY);
    throw new Error("The undo copy is damaged and can't be used.");
  }

  await AsyncStorage.setItem(STORE_KEY, snapshot.raw);
  await useAppStore.persist.rehydrate();
  await AsyncStorage.removeItem(UNDO_KEY);

  const cloud = useCloudStore.getState();
  cloud.setUndoAvailableAt(null);
  cloud.setFingerprint(fingerprint(currentBackupState()));
}

export async function clearUndoSnapshot(): Promise<void> {
  try {
    await AsyncStorage.removeItem(UNDO_KEY);
  } catch {
    // Non-fatal.
  }
  useCloudStore.getState().setUndoAvailableAt(null);
}
