/**
 * LIVE Supabase verification for the cloud-backup feature.
 * Requires a real project (see the plan's manual setup steps).
 *
 *   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... \
 *     npx tsx scripts/test-cloud-backup-live.ts
 *
 * This exists because tsc cannot catch a wrong endpoint, a missing RLS policy, or
 * a concurrency check that doesn't actually hold. In particular it PROVES:
 *   - the optimistic-concurrency wall (a stale rev cannot overwrite a newer copy)
 *   - cross-user isolation, which is the only reason shipping the anon key is safe
 *
 * It creates two throwaway accounts. With "Confirm email" OFF they sign in
 * immediately. Delete them afterwards from the Supabase dashboard if you like.
 */
import { createClient } from '@supabase/supabase-js';
import { generatePlan } from 'C:/Users/bilal/Desktop/app/src/lib/planEngine';
import { subjectsForProfile } from 'C:/Users/bilal/Desktop/app/src/data/syllabus';
import { buildEnvelope } from 'C:/Users/bilal/Desktop/app/src/lib/backupSchema';
import type { BackupData } from 'C:/Users/bilal/Desktop/app/src/lib/backupSchema';
import type { ClassLevel, StudentProfile, StudyGroup } from 'C:/Users/bilal/Desktop/app/src/lib/types';

const URL_ = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

if (!URL_ || !KEY) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY first.');
  process.exit(1);
}

const TABLE = 'backups';
const META = { appVersion: '1.0.0', platform: 'node', deviceLabel: 'Test (LIVE)' };

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const fresh = () => createClient(URL_, KEY, { auth: { persistSession: false } });

function stateFor(classLevel: ClassLevel, group: StudyGroup): BackupData {
  const subjects = subjectsForProfile(classLevel, group);
  const confidence: Record<string, number> = {};
  subjects.forEach((s, i) => {
    confidence[s.id] = (i % 5) + 1;
  });
  const profile: StudentProfile = {
    name: 'LiveTest',
    classLevel,
    group,
    boardId: 'lahore',
    examDate: '2027-03-01',
    dailyMinutes: 180,
    confidence,
    createdAt: new Date().toISOString(),
  };
  return {
    profile,
    plan: generatePlan(profile),
    quizAttempts: [],
    flashcards: [],
    chatHistory: [],
    activeDays: [],
    vibrationEnabled: true,
  };
}

function rowFor(state: BackupData, userId: string) {
  const env = buildEnvelope(state, META);
  return {
    row: {
      user_id: userId,
      payload: JSON.stringify(env.data),
      schema_version: env.schemaVersion,
      app_version: env.appVersion,
      device_label: env.deviceLabel,
      platform: env.platform,
      byte_size: env.byteSize,
      checksum: env.checksum,
      item_counts: env.itemCounts,
    },
    env,
  };
}

const stamp = Date.now();
const userA = { email: `manzil.test.a.${stamp}@example.com`, password: 'test-passw0rd-A' };
const userB = { email: `manzil.test.b.${stamp}@example.com`, password: 'test-passw0rd-B' };

async function main() {
  // ---------------------------------------------------------------- 1. sign up
  console.log('\n=== 1. Auth ===');
  const a = fresh();
  const signUpA = await a.auth.signUp(userA);
  check(
    'signUp returns a session immediately (proves "Confirm email" is OFF)',
    !!signUpA.data.session && !signUpA.error,
    signUpA.error?.message ?? 'no session returned — check the Email provider settings',
  );
  const userAId = signUpA.data.user?.id ?? '';
  if (!userAId) {
    console.error('\nCannot continue without a user id.');
    process.exit(1);
  }

  const dup = fresh();
  const signUpDup = await dup.auth.signUp(userA);
  check(
    'duplicate signUp returns null session (already-registered obfuscation)',
    !signUpDup.error && !signUpDup.data.session,
    `error=${signUpDup.error?.message} session=${!!signUpDup.data.session}`,
  );

  // -------------------------------------------------------------- 2. insert
  console.log('\n=== 2. Insert + server-owned rev ===');
  const stateV1 = stateFor('10', 'science-cs');
  const { row: rowV1, env: envV1 } = rowFor(stateV1, userAId);
  console.log(`  info: payload = ${Math.round(envV1.byteSize / 1024)} KB`);

  const ins = await a.from(TABLE).insert(rowV1).select('rev, updated_at').single();
  check('insert succeeds with rev = 1', !ins.error && Number(ins.data?.rev) === 1, ins.error?.message);

  // Client-sent rev must be ignored by the trigger.
  const tamper = await a
    .from(TABLE)
    .update({ ...rowV1, rev: 999 } as never)
    .eq('user_id', userAId)
    .eq('rev', 1)
    .select('rev')
    .single();
  check(
    'client cannot forge rev (server trigger owns it)',
    !tamper.error && Number(tamper.data?.rev) === 2,
    `rev=${tamper.data?.rev} err=${tamper.error?.message}`,
  );

  // ------------------------------------------- 3. optimistic concurrency wall
  console.log('\n=== 3. Concurrency wall (the Trap-1 proof) ===');
  const stateV2 = stateFor('10', 'arts');
  const { row: rowV2 } = rowFor(stateV2, userAId);

  const stale = await a.from(TABLE).update(rowV2).eq('user_id', userAId).eq('rev', 1).select('rev');
  check(
    'conditional update with a STALE rev affects 0 rows',
    !stale.error && (stale.data?.length ?? 0) === 0,
    `rows=${stale.data?.length} err=${stale.error?.message}`,
  );

  const currentRev = Number(tamper.data?.rev ?? 2);
  const good = await a
    .from(TABLE)
    .update(rowV2)
    .eq('user_id', userAId)
    .eq('rev', currentRev)
    .select('rev');
  check(
    `conditional update with the CORRECT rev succeeds (${currentRev} -> ${currentRev + 1})`,
    !good.error && Number(good.data?.[0]?.rev) === currentRev + 1,
    `err=${good.error?.message}`,
  );

  const prev = await a.from(TABLE).select('prev_rev, prev_payload').single();
  check(
    'previous version is retained server-side for undo',
    !prev.error && prev.data?.prev_payload != null && Number(prev.data?.prev_rev) === currentRev,
    `prev_rev=${prev.data?.prev_rev}`,
  );

  // ----------------------------------------------------------- 4. RLS isolation
  console.log('\n=== 4. RLS isolation (why shipping the anon key is safe) ===');
  const b = fresh();
  const signUpB = await b.auth.signUp(userB);
  check('second test account created', !!signUpB.data.session, signUpB.error?.message);

  const bRead = await b.from(TABLE).select('payload').eq('user_id', userAId);
  check(
    "user B cannot READ user A's backup",
    !bRead.error && (bRead.data?.length ?? 0) === 0,
    `rows=${bRead.data?.length}`,
  );

  const bWrite = await b.from(TABLE).update({ payload: 'hacked' }).eq('user_id', userAId).select('rev');
  check(
    "user B cannot UPDATE user A's backup",
    (bWrite.data?.length ?? 0) === 0,
    `rows=${bWrite.data?.length} err=${bWrite.error?.message}`,
  );

  const bDelete = await b.from(TABLE).delete().eq('user_id', userAId).select('user_id');
  check(
    "user B cannot DELETE user A's backup",
    (bDelete.data?.length ?? 0) === 0,
    `rows=${bDelete.data?.length}`,
  );

  const anon = fresh();
  const anonRead = await anon.from(TABLE).select('payload');
  check(
    'unauthenticated anon key reads nothing',
    (anonRead.data?.length ?? 0) === 0,
    `rows=${anonRead.data?.length} err=${anonRead.error?.message}`,
  );

  const anonWrite = await anon.from(TABLE).insert({
    user_id: userAId,
    payload: '{}',
    schema_version: 1,
    byte_size: 2,
    checksum: 'x',
  } as never);
  check('unauthenticated anon key cannot write', !!anonWrite.error, 'insert unexpectedly succeeded');

  // ------------------------------------------------------------- 5. size guard
  console.log('\n=== 5. Size ceiling ===');
  const huge = { ...rowV1, payload: 'x'.repeat(4 * 1024 * 1024), byte_size: 4 * 1024 * 1024 };
  const hugeRes = await a.from(TABLE).update(huge).eq('user_id', userAId).select('rev');
  check(
    'a 4 MB payload is rejected by the CHECK constraint',
    !!hugeRes.error,
    `code=${(hugeRes.error as { code?: string } | null)?.code} — expected 23514`,
  );

  // ---------------------------------------------------------------- 6. latency
  console.log('\n=== 6. Round-trip latency ===');
  const t0 = Date.now();
  const readBack = await a.from(TABLE).select('payload, rev').single();
  const downMs = Date.now() - t0;
  check('payload reads back intact', !readBack.error && typeof readBack.data?.payload === 'string');
  console.log(`  info: download of ~${Math.round(envV1.byteSize / 1024)} KB took ${downMs} ms`);

  const t1 = Date.now();
  await a
    .from(TABLE)
    .update(rowV1)
    .eq('user_id', userAId)
    .eq('rev', Number(readBack.data?.rev))
    .select('rev');
  const upMs = Date.now() - t1;
  console.log(`  info: upload took ${upMs} ms`);
  check('round trip well within the 25s client timeout', downMs + upMs < 20_000, `${downMs + upMs} ms`);

  // ----------------------------------------------------------------- 7. delete
  console.log('\n=== 7. Delete ===');
  const del = await a.from(TABLE).delete().eq('user_id', userAId).select('user_id');
  check('owner can delete their own backup', !del.error && (del.data?.length ?? 0) === 1, del.error?.message);
  const after = await a.from(TABLE).select('rev').maybeSingle();
  check('backup is gone afterwards', !after.error && after.data === null);

  // ------------------------------------------------------------------- result
  console.log(`\n================ ${pass} passed, ${fail} failed ================`);
  console.log(
    '\nStill to verify MANUALLY (needs a real inbox, cannot be automated):\n' +
      '  resetPasswordForEmail -> read the 6-digit code from the Brevo email ->\n' +
      "  verifyOtp({ email, token, type: 'recovery' }) -> updateUser({ password }) -> sign in.\n" +
      `  Test accounts created: ${userA.email}, ${userB.email}\n`,
  );
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\nFAILED:', e);
  process.exit(1);
});
