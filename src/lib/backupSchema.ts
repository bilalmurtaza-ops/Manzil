import type { BackedUpState } from '../store/useAppStore';
import type {
  ChatMessage,
  ClassLevel,
  Flashcard,
  PlanSession,
  QuizAttempt,
  StudentProfile,
  StudyGroup,
  StudyPlan,
} from './types';

/**
 * Backup envelope + validation. This is the correctness core of the backup
 * feature and has no dependencies on network, storage, or React — so it is
 * exhaustively testable offline with a plain `tsx` script.
 *
 * Central rule: untrusted JSON NEVER reaches the store. `parseBackup` rebuilds
 * every field from validated values and discards the raw parsed object, so a
 * hand-edited file, a truncated download, or a payload from a future app version
 * cannot corrupt a student's data or crash a screen.
 */

/** Bump when the shape of `BackupData` changes, and add a MIGRATIONS entry. */
export const CURRENT_SCHEMA_VERSION = 1;

/** zustand's persist `version` for 'manzil-store' (it has none set, so 0). */
export const STORE_PERSIST_VERSION = 0;

/** Hard ceiling, mirrored by a CHECK constraint on the server. */
export const MAX_PAYLOAD_BYTES = 3 * 1024 * 1024;

/** Matches `appendChat`'s own cap in useAppStore so a restore can't exceed it. */
const CHAT_CAP = 80;
/** `quizAttempts`/`flashcards` are uncapped in the store; bound them in backups. */
const COLLECTION_CAP = 5000;

export type BackupData = BackedUpState;

export interface BackupItemCounts {
  sessions: number;
  sessionsDone: number;
  quizAttempts: number;
  flashcards: number;
  chatMessages: number;
  activeDays: number;
}

export interface BackupEnvelope {
  format: 'manzil.backup';
  schemaVersion: number;
  storeVersion: number;
  appVersion: string;
  platform: string;
  deviceLabel: string;
  createdAt: string;
  itemCounts: BackupItemCounts;
  byteSize: number;
  checksum: string;
  data: BackupData;
}

export type BackupErrorKind = 'schema' | 'corrupt' | 'quota' | 'empty';

export interface BackupParseError {
  kind: BackupErrorKind;
  message: string;
}

export type ParseResult =
  | { ok: true; envelope: BackupEnvelope; warnings: string[] }
  | { ok: false; error: BackupParseError };

// ---------- checksum ----------

/**
 * FNV-1a 32-bit. This is an INTEGRITY check (truncated file, corrupted transfer),
 * NOT a security check — anyone editing a backup can recompute it. The real
 * protection against hostile input is the validators below.
 */
export function checksum(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // Math.imul keeps this a 32-bit multiply instead of overflowing to a double.
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------- primitive guards ----------

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const isISODate = (v: unknown): v is string => isStr(v) && ISO_DATE.test(v);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const CLASS_LEVELS: readonly ClassLevel[] = ['9', '10'];
const GROUPS: readonly StudyGroup[] = ['science-bio', 'science-cs', 'arts'];
const SESSION_KINDS: readonly PlanSession['kind'][] = ['study', 'revise', 'practice'];

// ---------- field validators ----------

/**
 * All-or-nothing: without a valid profile nothing else is restorable, since the
 * syllabus, plan engine and readiness scoring are all keyed off class + group.
 */
function validateProfile(v: unknown): StudentProfile | null {
  if (!isObject(v)) return null;
  if (!isStr(v.name)) return null;
  if (!isStr(v.classLevel) || !CLASS_LEVELS.includes(v.classLevel as ClassLevel)) return null;
  if (!isStr(v.group) || !GROUPS.includes(v.group as StudyGroup)) return null;
  if (!isStr(v.boardId) || v.boardId.length === 0) return null;
  if (!isISODate(v.examDate)) return null;
  if (!isNum(v.dailyMinutes)) return null;

  // `confidence` drives study-time allocation, so drop junk entries rather than
  // letting a NaN through into the plan engine.
  const confidence: Record<string, number> = {};
  if (isObject(v.confidence)) {
    for (const [k, raw] of Object.entries(v.confidence)) {
      if (isNum(raw)) confidence[k] = clamp(Math.round(raw), 1, 5);
    }
  }

  return {
    name: v.name.slice(0, 60),
    classLevel: v.classLevel as ClassLevel,
    group: v.group as StudyGroup,
    boardId: v.boardId,
    examDate: v.examDate,
    dailyMinutes: clamp(Math.round(v.dailyMinutes), 15, 960),
    confidence,
    createdAt: isStr(v.createdAt) ? v.createdAt : new Date().toISOString(),
  };
}

function validateSession(v: unknown): PlanSession | null {
  if (!isObject(v)) return null;
  if (!isStr(v.id) || !isISODate(v.date)) return null;
  if (!isStr(v.subjectId) || !isStr(v.chapterId)) return null;
  if (!isStr(v.kind) || !SESSION_KINDS.includes(v.kind as PlanSession['kind'])) return null;
  if (!isNum(v.minutes)) return null;
  return {
    id: v.id,
    date: v.date,
    subjectId: v.subjectId,
    chapterId: v.chapterId,
    kind: v.kind as PlanSession['kind'],
    minutes: clamp(Math.round(v.minutes), 1, 600),
    done: v.done === true,
    // doneAt drives streak credit and the study-ahead counter, so an
    // unparseable value must be dropped rather than carried into the store.
    // Dropping it is safe: completedOn() falls back to the scheduled date.
    ...(isStr(v.doneAt) && !Number.isNaN(new Date(v.doneAt).getTime())
      ? { doneAt: v.doneAt }
      : {}),
  };
}

/** Returns the plan plus how many malformed sessions were dropped. */
function validatePlan(v: unknown): { plan: StudyPlan | null; dropped: number } {
  if (!isObject(v) || !Array.isArray(v.sessions)) return { plan: null, dropped: 0 };
  if (!isISODate(v.examDate)) return { plan: null, dropped: 0 };

  const sessions: PlanSession[] = [];
  let dropped = 0;
  for (const raw of v.sessions) {
    const s = validateSession(raw);
    if (s) sessions.push(s);
    else dropped++;
  }
  // A plan with no usable sessions is not a plan — let the caller regenerate.
  if (sessions.length === 0) return { plan: null, dropped };

  return {
    plan: {
      generatedAt: isStr(v.generatedAt) ? v.generatedAt : new Date().toISOString(),
      examDate: v.examDate,
      sessions,
    },
    dropped,
  };
}

function validateQuizAttempt(v: unknown): QuizAttempt | null {
  if (!isObject(v)) return null;
  if (!isStr(v.id) || !isStr(v.subjectId) || !isStr(v.chapterId)) return null;
  if (!isISODate(v.date) || !isNum(v.total) || !isNum(v.correct)) return null;
  const total = clamp(Math.round(v.total), 0, 500);
  return {
    id: v.id,
    subjectId: v.subjectId,
    chapterId: v.chapterId,
    date: v.date,
    total,
    // `correct` above `total` would corrupt mastery scoring in readiness.ts.
    correct: clamp(Math.round(v.correct), 0, total),
  };
}

function validateFlashcard(v: unknown): Flashcard | null {
  if (!isObject(v)) return null;
  if (!isStr(v.id) || !isStr(v.subjectId)) return null;
  if (!isStr(v.front) || !isStr(v.back)) return null;
  if (!isISODate(v.due) || !isNum(v.stability)) return null;
  return {
    id: v.id,
    subjectId: v.subjectId,
    ...(isStr(v.chapterId) ? { chapterId: v.chapterId } : {}),
    front: v.front,
    back: v.back,
    due: v.due,
    // Keep FSRS state inside the range fsrs.ts can reason about.
    stability: clamp(v.stability, 0.1, 60),
    reps: isNum(v.reps) ? clamp(Math.round(v.reps), 0, 10_000) : 0,
    lapses: isNum(v.lapses) ? clamp(Math.round(v.lapses), 0, 10_000) : 0,
    createdAt: isStr(v.createdAt) ? v.createdAt : new Date().toISOString(),
  };
}

function validateChatMessage(v: unknown): ChatMessage | null {
  if (!isObject(v)) return null;
  if (!isStr(v.id) || !isStr(v.text)) return null;
  if (v.role !== 'user' && v.role !== 'model') return null;
  return {
    id: v.id,
    role: v.role,
    text: v.text,
    ...(v.hadImage === true ? { hadImage: true as const } : {}),
    createdAt: isStr(v.createdAt) ? v.createdAt : new Date().toISOString(),
  };
}

/** Filters an array field, reporting how many items were unusable. */
function validateList<T>(
  v: unknown,
  each: (x: unknown) => T | null,
  cap: number,
): { items: T[]; dropped: number; wasArray: boolean } {
  if (!Array.isArray(v)) return { items: [], dropped: 0, wasArray: false };
  const items: T[] = [];
  let dropped = 0;
  for (const raw of v) {
    const item = each(raw);
    if (item) items.push(item);
    else dropped++;
  }
  // Keep the newest when over cap — recent study history is the useful part.
  return { items: items.length > cap ? items.slice(-cap) : items, dropped, wasArray: true };
}

// ---------- build ----------

export interface EnvelopeMeta {
  appVersion: string;
  platform: string;
  deviceLabel: string;
}

/**
 * Whitelist-by-construction: the seven fields are named explicitly, so a future
 * transient store field cannot leak into a backup even if nobody remembers to
 * exclude it. Key order is fixed and literal so the checksum is reproducible.
 */
export function buildEnvelope(state: BackupData, meta: EnvelopeMeta): BackupEnvelope {
  const data: BackupData = {
    profile: state.profile,
    plan: state.plan,
    quizAttempts: state.quizAttempts,
    flashcards: state.flashcards,
    chatHistory: state.chatHistory,
    activeDays: state.activeDays,
    vibrationEnabled: state.vibrationEnabled,
  };

  const serialized = JSON.stringify(data);
  const sessions = data.plan?.sessions ?? [];

  return {
    format: 'manzil.backup',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    storeVersion: STORE_PERSIST_VERSION,
    appVersion: meta.appVersion,
    platform: meta.platform,
    deviceLabel: meta.deviceLabel,
    createdAt: new Date().toISOString(),
    itemCounts: {
      sessions: sessions.length,
      sessionsDone: sessions.filter((s) => s.done).length,
      quizAttempts: data.quizAttempts.length,
      flashcards: data.flashcards.length,
      chatMessages: data.chatHistory.length,
      activeDays: data.activeDays.length,
    },
    byteSize: serialized.length,
    checksum: checksum(serialized),
    data,
  };
}

// ---------- migrations ----------

/**
 * Registry applied in ascending order for backups older than CURRENT_SCHEMA_VERSION.
 * Empty today — the machinery is the deliverable, so a v1 backup restored by a
 * future v2 app has a defined path instead of an ad-hoc rescue.
 */
const MIGRATIONS: Record<number, (data: Record<string, unknown>) => Record<string, unknown>> = {};

// ---------- parse ----------

const err = (kind: BackupErrorKind, message: string): ParseResult => ({
  ok: false,
  error: { kind, message },
});

/**
 * Validate an untrusted parsed-JSON value into a usable envelope.
 * Rules run in a deliberate order — cheapest and most decisive first.
 */
export function parseBackup(raw: unknown): ParseResult {
  const warnings: string[] = [];

  if (!isObject(raw)) {
    return err('corrupt', "That file isn't a readable Manzil backup.");
  }
  if (raw.format !== 'manzil.backup') {
    return err('schema', "That doesn't look like a Manzil backup file.");
  }
  if (!isNum(raw.schemaVersion)) {
    return err('schema', 'This backup is missing its version and cannot be read safely.');
  }

  // Never guess forward: a newer app may have added fields this build cannot
  // interpret, and a partial restore is worse than a refused one.
  if (raw.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return err(
      'schema',
      'This backup was made by a newer version of Manzil. Update the app, then restore it.',
    );
  }

  if (!isObject(raw.data)) {
    return err('corrupt', 'This backup is missing its contents.');
  }

  // Migrate up to the current schema before validating field shapes.
  let data = raw.data;
  if (raw.schemaVersion < CURRENT_SCHEMA_VERSION) {
    for (let v = raw.schemaVersion; v < CURRENT_SCHEMA_VERSION; v++) {
      const step = MIGRATIONS[v];
      if (!step) {
        return err(
          'schema',
          'This backup is from an older version of Manzil that can no longer be restored.',
        );
      }
      try {
        data = step(data);
      } catch {
        return err('corrupt', "This backup couldn't be upgraded to the current format.");
      }
    }
    warnings.push('This backup was made by an older version of Manzil and has been upgraded.');
  }

  // Size guard, checked against the real serialization rather than a claimed field.
  const serializedIn = JSON.stringify(data);
  if (serializedIn.length > MAX_PAYLOAD_BYTES || (isNum(raw.byteSize) && raw.byteSize > MAX_PAYLOAD_BYTES)) {
    return err('quota', 'This backup is too large to restore.');
  }

  // Integrity: a WARNING, never a rejection. JSON.stringify(JSON.parse(s)) is not
  // byte-identical for every number literal, so a hard reject here could dead-end
  // a student holding a perfectly good file.
  if (isStr(raw.checksum)) {
    if (checksum(serializedIn) !== raw.checksum) {
      warnings.push("Integrity check didn't match — this file may have been edited.");
    }
  } else {
    warnings.push('This backup has no integrity check.');
  }

  if (isNum(raw.storeVersion) && raw.storeVersion !== STORE_PERSIST_VERSION) {
    warnings.push('This backup came from a different storage format version.');
  }

  // ---- fields ----

  const profile = validateProfile(data.profile);
  if (!profile) {
    return err(
      'corrupt',
      data.profile == null
        ? 'This backup has no study profile, so there is nothing to restore.'
        : "This backup's study profile is damaged and cannot be restored.",
    );
  }

  const { plan, dropped: droppedSessions } = validatePlan(data.plan);
  if (!plan && data.plan != null) {
    warnings.push("The saved study plan couldn't be read — regenerate it from Settings.");
  }
  if (droppedSessions > 0) {
    warnings.push(`${droppedSessions} damaged study session(s) were skipped.`);
  }

  const quiz = validateList(data.quizAttempts, validateQuizAttempt, COLLECTION_CAP);
  if (quiz.dropped > 0) warnings.push(`${quiz.dropped} quiz result(s) were skipped.`);

  const cards = validateList(data.flashcards, validateFlashcard, COLLECTION_CAP);
  if (cards.dropped > 0) warnings.push(`${cards.dropped} flashcard(s) were skipped.`);

  const chat = validateList(data.chatHistory, validateChatMessage, CHAT_CAP);
  if (chat.dropped > 0) warnings.push(`${chat.dropped} chat message(s) were skipped.`);

  const activeDays = Array.isArray(data.activeDays)
    ? Array.from(new Set(data.activeDays.filter(isISODate))).sort()
    : [];

  const restored: BackupData = {
    profile,
    plan,
    quizAttempts: quiz.items,
    flashcards: cards.items,
    chatHistory: chat.items,
    activeDays,
    // Matches the store's own `!== false` reading convention: only an explicit
    // false disables haptics.
    vibrationEnabled: isBool(data.vibrationEnabled) ? data.vibrationEnabled : true,
  };

  const sessions = restored.plan?.sessions ?? [];

  return {
    ok: true,
    warnings,
    envelope: {
      format: 'manzil.backup',
      schemaVersion: CURRENT_SCHEMA_VERSION,
      storeVersion: STORE_PERSIST_VERSION,
      appVersion: isStr(raw.appVersion) ? raw.appVersion : '',
      platform: isStr(raw.platform) ? raw.platform : '',
      deviceLabel: isStr(raw.deviceLabel) ? raw.deviceLabel : '',
      createdAt: isStr(raw.createdAt) ? raw.createdAt : new Date().toISOString(),
      itemCounts: {
        sessions: sessions.length,
        sessionsDone: sessions.filter((s) => s.done).length,
        quizAttempts: restored.quizAttempts.length,
        flashcards: restored.flashcards.length,
        chatMessages: restored.chatHistory.length,
        activeDays: restored.activeDays.length,
      },
      byteSize: JSON.stringify(restored).length,
      checksum: checksum(JSON.stringify(restored)),
      data: restored,
    },
  };
}

// ---------- display ----------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Human one-liner for confirm dialogs, e.g. "24 Jul 2026 · Android (A7F3) · plan + 12 quizzes + 40 cards". */
export function summarize(envelope: Pick<BackupEnvelope, 'createdAt' | 'deviceLabel' | 'itemCounts'>): string {
  const d = new Date(envelope.createdAt);
  const when = Number.isNaN(d.getTime())
    ? 'unknown date'
    : `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

  const c = envelope.itemCounts;
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts: string[] = [];
  if (c.sessions > 0) parts.push(`plan (${c.sessionsDone}/${c.sessions} done)`);
  if (c.quizAttempts > 0) parts.push(plural(c.quizAttempts, 'quiz', 'quizzes'));
  if (c.flashcards > 0) parts.push(plural(c.flashcards, 'card', 'cards'));
  if (c.activeDays > 0) parts.push(plural(c.activeDays, 'active day', 'active days'));

  return [when, envelope.deviceLabel || null, parts.length ? parts.join(' + ') : 'no study data']
    .filter(Boolean)
    .join(' · ');
}
