import type { PostgrestError, Session } from '@supabase/supabase-js';
import {
  buildEnvelope,
  parseBackup,
  type BackupData,
  type BackupEnvelope,
  type BackupItemCounts,
  type EnvelopeMeta,
} from './backupSchema';
import { getSupabase, isCloudConfigured } from './supabase';

/**
 * Cloud backup network layer. Deliberately mirrors src/lib/gemini.ts:
 * every failure becomes a typed error carrying user-facing copy that screens
 * render directly, retryable failures are distinguished from terminal ones, and
 * nothing here can throw an untyped error into a render.
 */

export type BackupErrorKind =
  | 'config' // env vars absent — cloud not set up in this build
  | 'offline' // no network
  | 'server' // 5xx, timeout, or a paused free-tier project
  | 'auth' // signed out, bad credentials, expired refresh token
  | 'rate-limit' // 429
  | 'quota' // payload too large for the free tier
  | 'conflict' // cloud copy is newer than this device's
  | 'schema' // backup unreadable / wrong version
  | 'corrupt' // backup contents damaged
  | 'empty' // nothing worth backing up yet
  | 'cancelled'; // user dismissed a picker

export class BackupError extends Error {
  constructor(
    message: string,
    public readonly kind: BackupErrorKind,
  ) {
    super(message);
    this.name = 'BackupError';
  }
}

/**
 * Only these are ever retried automatically. Mirrors gemini.ts's rule of never
 * retrying failures that would recur identically — retrying an auth or conflict
 * failure in a loop is how a sync feature destroys data.
 */
export function isRetryable(kind: BackupErrorKind): boolean {
  return kind === 'offline' || kind === 'server' || kind === 'rate-limit';
}

const TABLE = 'backups';

function client() {
  const c = getSupabase();
  if (!c) {
    throw new BackupError(
      "Cloud backup isn't set up in this build. You can still export a backup file.",
      'config',
    );
  }
  return c;
}

// ---------- error mapping ----------

/** Single translation point from any thrown/returned Supabase failure to BackupError. */
export function mapSupabaseError(e: unknown): BackupError {
  if (e instanceof BackupError) return e;

  const anyErr = e as { message?: string; name?: string; status?: number; code?: string } | null;
  const msg = anyErr?.message ?? '';
  const name = anyErr?.name ?? '';
  const status = anyErr?.status;
  const code = anyErr?.code;

  // Our own AbortController timeout in supabase.ts.
  if (name === 'AbortError' || /aborted/i.test(msg)) {
    return new BackupError(
      "Cloud backup didn't respond in time. Your data is safe on this device — it'll retry.",
      'server',
    );
  }

  // fetch() network failure surfaces as a TypeError in both RN and browsers.
  // These two messages are shown both for background backup attempts AND for
  // direct user actions (sign in, sign up, password reset) — the "will retry
  // automatically" framing only makes sense for the former, so the copy stays
  // neutral rather than promising a retry that only the backup scheduler does.
  if (name === 'TypeError' || /network|failed to fetch|fetch failed/i.test(msg)) {
    return new BackupError("You're offline. Your data is safe on this device.", 'offline');
  }

  if (status === 429 || /rate limit/i.test(msg)) {
    return new BackupError('Too many requests just now. Try again in a few minutes.', 'rate-limit');
  }

  if (status === 401 || status === 403 || /jwt|invalid token|not authenticated|refresh token/i.test(msg)) {
    return new BackupError('Please sign in again to resume cloud backup.', 'auth');
  }

  // Postgres CHECK / value-too-large, or an HTTP payload rejection.
  if (status === 413 || code === '23514' || code === '54000' || /too large|payload/i.test(msg)) {
    return new BackupError(
      'This backup is too large for the free cloud tier. Use "Export backup file" instead.',
      'quota',
    );
  }

  // Unique violation on insert = a backup already exists this device didn't know about.
  if (code === '23505') {
    return new BackupError('There is already a cloud backup for this account.', 'conflict');
  }

  // A paused free-tier project, a gateway error, or an outage all land here. The
  // copy is deliberately honest for all three rather than guessing which it is.
  if ((status && status >= 500) || /<html|gateway|unavailable|paused/i.test(msg)) {
    return new BackupError(
      "Cloud backup is unreachable right now. Your data is safe on this device — it'll retry.",
      'server',
    );
  }

  return new BackupError(
    msg ? `Cloud backup failed: ${msg}` : 'Cloud backup failed. Your data is safe on this device.',
    'server',
  );
}

/** Postgrest returns errors in-band rather than throwing. */
function throwIfPostgrest(error: PostgrestError | null): void {
  if (error) throw mapSupabaseError(error);
}

// ---------- auth ----------

export interface CloudSession {
  userId: string;
  email: string;
}

const toSession = (s: Session | null): CloudSession | null =>
  s?.user ? { userId: s.user.id, email: s.user.email ?? '' } : null;

export async function getSession(): Promise<CloudSession | null> {
  if (!isCloudConfigured()) return null;
  try {
    const { data, error } = await client().auth.getSession();
    if (error) throw mapSupabaseError(error);
    return toSession(data.session);
  } catch (e) {
    // A missing/expired session is a normal signed-out state, not an error to show.
    if (e instanceof BackupError && e.kind === 'auth') return null;
    throw mapSupabaseError(e);
  }
}

export async function signUp(email: string, password: string): Promise<CloudSession> {
  try {
    const { data, error } = await client().auth.signUp({ email: email.trim(), password });

    // Verified live against this project's config (Confirm email OFF): a duplicate
    // signup throws an explicit error here rather than the obfuscated-null-session
    // response some Supabase configs use. Handle both, so this holds even if the
    // dashboard's email-confirmation setting changes later.
    if (error) {
      if (/already registered|already exists|user already/i.test(error.message)) {
        throw new BackupError('That email is already registered. Sign in instead.', 'auth');
      }
      throw mapSupabaseError(error);
    }

    if (!data.session) {
      throw new BackupError('That email is already registered. Sign in instead.', 'auth');
    }
    const s = toSession(data.session);
    if (!s) throw new BackupError('Sign up did not complete. Try again.', 'auth');
    return s;
  } catch (e) {
    throw mapSupabaseError(e);
  }
}

export async function signIn(email: string, password: string): Promise<CloudSession> {
  try {
    const { data, error } = await client().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      // Supabase's generic "Invalid login credentials" is unhelpful to a student.
      if (/invalid login credentials/i.test(error.message)) {
        throw new BackupError('Wrong email or password.', 'auth');
      }
      throw mapSupabaseError(error);
    }
    const s = toSession(data.session);
    if (!s) throw new BackupError('Sign in did not complete. Try again.', 'auth');
    return s;
  } catch (e) {
    throw mapSupabaseError(e);
  }
}

export async function signOut(): Promise<void> {
  try {
    await client().auth.signOut();
  } catch {
    // Signing out must always succeed locally, even if the network call fails.
  }
}

/** Step 1 of recovery: emails a 6-digit {{ .Token }} (no link, no deep linking). */
export async function sendPasswordReset(email: string): Promise<void> {
  try {
    const { error } = await client().auth.resetPasswordForEmail(email.trim());
    if (error) throw mapSupabaseError(error);
  } catch (e) {
    throw mapSupabaseError(e);
  }
}

/** Step 2: exchange the emailed code for a session so the password can be changed. */
export async function verifyRecoveryCode(email: string, token: string): Promise<CloudSession> {
  try {
    const { data, error } = await client().auth.verifyOtp({
      email: email.trim(),
      token: token.trim(),
      type: 'recovery',
    });
    if (error) {
      if (/expired|invalid/i.test(error.message)) {
        throw new BackupError('That code is wrong or has expired. Request a new one.', 'auth');
      }
      throw mapSupabaseError(error);
    }
    const s = toSession(data.session);
    if (!s) throw new BackupError('That code could not be verified. Request a new one.', 'auth');
    return s;
  } catch (e) {
    throw mapSupabaseError(e);
  }
}

/** Step 3: set the new password on the recovery session. */
export async function setNewPassword(password: string): Promise<void> {
  try {
    const { error } = await client().auth.updateUser({ password });
    if (error) throw mapSupabaseError(error);
  } catch (e) {
    throw mapSupabaseError(e);
  }
}

// ---------- remote metadata ----------

export interface RemoteMeta {
  schemaVersion: number;
  appVersion: string;
  deviceLabel: string;
  platform: string;
  byteSize: number;
  itemCounts: BackupItemCounts;
  rev: number;
  createdAt: string;
  updatedAt: string;
  hasPrevious: boolean;
}

const EMPTY_COUNTS: BackupItemCounts = {
  sessions: 0,
  sessionsDone: 0,
  quizAttempts: 0,
  flashcards: 0,
  chatMessages: 0,
  activeDays: 0,
};

/**
 * Cheap existence + description check that deliberately does NOT select `payload`
 * — the decide screen needs to describe the cloud copy without downloading ~80 KB.
 */
export async function fetchRemoteMeta(): Promise<RemoteMeta | null> {
  try {
    const { data, error } = await client()
      .from(TABLE)
      .select(
        'schema_version, app_version, device_label, platform, byte_size, item_counts, rev, created_at, updated_at, prev_rev',
      )
      .maybeSingle();
    throwIfPostgrest(error);
    if (!data) return null;

    const counts = data.item_counts as Partial<BackupItemCounts> | null;
    return {
      schemaVersion: Number(data.schema_version ?? 0),
      appVersion: String(data.app_version ?? ''),
      deviceLabel: String(data.device_label ?? ''),
      platform: String(data.platform ?? ''),
      byteSize: Number(data.byte_size ?? 0),
      itemCounts: { ...EMPTY_COUNTS, ...(counts ?? {}) },
      rev: Number(data.rev ?? 0),
      createdAt: String(data.created_at ?? ''),
      updatedAt: String(data.updated_at ?? ''),
      hasPrevious: data.prev_rev != null,
    };
  } catch (e) {
    throw mapSupabaseError(e);
  }
}

// ---------- push ----------

export interface PushResult {
  rev: number;
  updatedAt: string;
  byteSize: number;
}

export interface PushOptions {
  /** Server `rev` this device believes is current. null = expecting no row yet. */
  expectedRev: number | null;
  /** Bypass the concurrency check. Only ever set from an explicit overwrite confirm. */
  force?: boolean;
}

/**
 * The single upload chokepoint. Every guard that protects a student's cloud copy
 * lives HERE rather than at call sites, so no future caller can forget one.
 */
export async function pushBackup(
  state: BackupData,
  meta: EnvelopeMeta,
  opts: PushOptions,
): Promise<PushResult> {
  const c = client();

  // Trap-1 wall #3: a device with no profile has nothing worth uploading, and
  // "no profile" is exactly the fresh-install state (app/index.tsx routes such a
  // user to onboarding). This makes clobbering a good cloud backup with an empty
  // one structurally impossible, not merely unlikely.
  if (!state.profile) {
    throw new BackupError('Nothing to back up yet — finish setting up your study plan first.', 'empty');
  }

  const envelope = buildEnvelope(state, meta);
  const payload = JSON.stringify(envelope.data);

  const { data: userData, error: userErr } = await c.auth.getUser();
  if (userErr) throw mapSupabaseError(userErr);
  const userId = userData.user?.id;
  if (!userId) throw new BackupError('Please sign in again to resume cloud backup.', 'auth');

  const row = {
    user_id: userId,
    payload,
    schema_version: envelope.schemaVersion,
    app_version: envelope.appVersion,
    device_label: envelope.deviceLabel,
    platform: envelope.platform,
    byte_size: envelope.byteSize,
    checksum: envelope.checksum,
    item_counts: envelope.itemCounts,
    // `rev`, timestamps and prev_* are owned by the server trigger — never sent.
  };

  try {
    if (opts.force) {
      const { data, error } = await c
        .from(TABLE)
        .upsert(row, { onConflict: 'user_id' })
        .select('rev, updated_at')
        .single();
      throwIfPostgrest(error);
      return { rev: Number(data!.rev), updatedAt: String(data!.updated_at), byteSize: envelope.byteSize };
    }

    if (opts.expectedRev === null) {
      // First upload for this account. A 23505 here means a backup appeared that
      // this device didn't know about → conflict, never a silent overwrite.
      const { data, error } = await c.from(TABLE).insert(row).select('rev, updated_at').single();
      throwIfPostgrest(error);
      return { rev: Number(data!.rev), updatedAt: String(data!.updated_at), byteSize: envelope.byteSize };
    }

    // Trap-1 wall #4: conditional update. If the server has moved on, zero rows
    // match and we refuse rather than overwriting a newer copy.
    const { data, error } = await c
      .from(TABLE)
      .update(row)
      .eq('user_id', userId)
      .eq('rev', opts.expectedRev)
      .select('rev, updated_at');
    throwIfPostgrest(error);

    if (!data || data.length === 0) {
      throw new BackupError(
        'The cloud backup is newer than this device. Choose which copy to keep.',
        'conflict',
      );
    }
    return { rev: Number(data[0].rev), updatedAt: String(data[0].updated_at), byteSize: envelope.byteSize };
  } catch (e) {
    throw mapSupabaseError(e);
  }
}

// ---------- pull ----------

async function parseStoredPayload(payload: unknown, revLabel: string): Promise<BackupEnvelope> {
  if (typeof payload !== 'string' || payload.length === 0) {
    throw new BackupError(`The ${revLabel} cloud backup is empty.`, 'corrupt');
  }
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    throw new BackupError(`The ${revLabel} cloud backup is damaged and can't be read.`, 'corrupt');
  }
  // The stored payload is bare BackupData; wrap it so parseBackup sees an envelope.
  const res = parseBackup({ format: 'manzil.backup', schemaVersion: 1, data: json });
  if (!res.ok) throw new BackupError(res.error.message, res.error.kind === 'quota' ? 'quota' : res.error.kind);
  return res.envelope;
}

export interface PullResult {
  envelope: BackupEnvelope;
  rev: number;
  warnings: string[];
  /** Server-side metadata, which is more trustworthy than the payload's own. */
  meta: Pick<RemoteMeta, 'deviceLabel' | 'updatedAt' | 'itemCounts'>;
}

export async function pullBackup(): Promise<PullResult> {
  try {
    const { data, error } = await client()
      .from(TABLE)
      .select('payload, rev, device_label, updated_at, item_counts, schema_version, checksum')
      .maybeSingle();
    throwIfPostgrest(error);
    if (!data) throw new BackupError('There is no cloud backup for this account yet.', 'empty');

    const res = parseBackup({
      format: 'manzil.backup',
      schemaVersion: Number(data.schema_version ?? 1),
      checksum: data.checksum,
      deviceLabel: data.device_label,
      createdAt: data.updated_at,
      data: JSON.parse(String(data.payload)),
    });
    if (!res.ok) throw new BackupError(res.error.message, res.error.kind);

    const counts = data.item_counts as Partial<BackupItemCounts> | null;
    return {
      envelope: res.envelope,
      rev: Number(data.rev),
      warnings: res.warnings,
      meta: {
        deviceLabel: String(data.device_label ?? ''),
        updatedAt: String(data.updated_at ?? ''),
        itemCounts: { ...EMPTY_COUNTS, ...(counts ?? {}) },
      },
    };
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new BackupError("The cloud backup is damaged and can't be read.", 'corrupt');
    }
    throw mapSupabaseError(e);
  }
}

/** One level of server-side undo: the copy that existed before the last upload. */
export async function pullPreviousBackup(): Promise<BackupEnvelope> {
  try {
    const { data, error } = await client()
      .from(TABLE)
      .select('prev_payload, prev_rev')
      .maybeSingle();
    throwIfPostgrest(error);
    if (!data || data.prev_payload == null) {
      throw new BackupError('There is no earlier cloud backup to go back to.', 'empty');
    }
    return parseStoredPayload(data.prev_payload, 'earlier');
  } catch (e) {
    throw mapSupabaseError(e);
  }
}

export async function deleteRemoteBackup(): Promise<void> {
  try {
    const { data: userData, error: userErr } = await client().auth.getUser();
    if (userErr) throw mapSupabaseError(userErr);
    const userId = userData.user?.id;
    if (!userId) throw new BackupError('Please sign in again first.', 'auth');

    const { error } = await client().from(TABLE).delete().eq('user_id', userId);
    throwIfPostgrest(error);
  } catch (e) {
    throw mapSupabaseError(e);
  }
}
