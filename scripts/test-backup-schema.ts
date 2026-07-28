/**
 * Offline verification for src/lib/backupSchema.ts — no network, no Supabase.
 * Run: npx tsx scripts/test-backup-schema.ts
 *
 * Covers real generated data for all 6 profile combos plus hostile/corrupt inputs.
 * This is the highest-value test in the backup feature: if parseBackup is wrong,
 * a restore can silently damage a student's data.
 */
import {
  buildEnvelope,
  checksum,
  CURRENT_SCHEMA_VERSION,
  parseBackup,
  summarize,
  type BackupData,
} from 'C:/Users/bilal/Desktop/app/src/lib/backupSchema';
import { generatePlan } from 'C:/Users/bilal/Desktop/app/src/lib/planEngine';
import { subjectsForProfile } from 'C:/Users/bilal/Desktop/app/src/data/syllabus';
import type { ClassLevel, Flashcard, StudentProfile, StudyGroup } from 'C:/Users/bilal/Desktop/app/src/lib/types';

const META = { appVersion: '1.0.0', platform: 'android', deviceLabel: 'Android (TEST)' };

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function makeProfile(classLevel: ClassLevel, group: StudyGroup): StudentProfile {
  const subjects = subjectsForProfile(classLevel, group);
  const confidence: Record<string, number> = {};
  subjects.forEach((s, i) => {
    confidence[s.id] = (i % 5) + 1;
  });
  return {
    name: 'Bilal',
    classLevel,
    group,
    boardId: 'lahore',
    examDate: '2027-03-01',
    dailyMinutes: 180,
    confidence,
    createdAt: new Date().toISOString(),
  };
}

function stateFor(classLevel: ClassLevel, group: StudyGroup): BackupData {
  const profile = makeProfile(classLevel, group);
  const plan = generatePlan(profile);
  const cards: Flashcard[] = [
    {
      id: 'c1',
      subjectId: subjectsForProfile(classLevel, group)[0].id,
      front: 'What is Ohm law?',
      back: 'V = IR',
      due: '2026-08-01',
      stability: 3.2,
      reps: 4,
      lapses: 1,
      createdAt: new Date().toISOString(),
    },
  ];
  return {
    profile,
    plan,
    quizAttempts: [
      { id: 'q1', subjectId: 'math', chapterId: 'ch1', date: '2026-07-20', total: 8, correct: 6 },
    ],
    flashcards: cards,
    chatHistory: [
      { id: 'm1', role: 'user', text: 'Salam', createdAt: new Date().toISOString() },
      { id: 'm2', role: 'model', text: 'Wa Alaikum Assalam', createdAt: new Date().toISOString() },
    ],
    activeDays: ['2026-07-20', '2026-07-21'],
    vibrationEnabled: true,
    focusGuardEnabled: true,
    focusVoiceEnabled: true,
    focusVoiceId: 'george',
    attentionSpans: [12, 18, 15],
  };
}

// ---------------------------------------------------------------- round trips
console.log('\n=== 1. Round trip across all 6 profile combos ===');
const COMBOS: [ClassLevel, StudyGroup][] = [
  ['9', 'science-bio'],
  ['9', 'science-cs'],
  ['9', 'arts'],
  ['10', 'science-bio'],
  ['10', 'science-cs'],
  ['10', 'arts'],
];

for (const [cls, grp] of COMBOS) {
  const state = stateFor(cls, grp);
  const env = buildEnvelope(state, META);
  const json = JSON.parse(JSON.stringify(env));
  const res = parseBackup(json);

  const label = `class ${cls} / ${grp}`;
  if (!res.ok) {
    check(`${label} round-trips`, false, res.error.message);
    continue;
  }
  const d = res.envelope.data;
  check(
    `${label} round-trips (${env.byteSize} B, ${env.itemCounts.sessions} sessions)`,
    res.warnings.length === 0 &&
      d.plan?.sessions.length === state.plan?.sessions.length &&
      d.quizAttempts.length === 1 &&
      d.flashcards.length === 1 &&
      d.chatHistory.length === 2 &&
      d.activeDays.length === 2 &&
      d.profile?.classLevel === cls &&
      d.profile?.group === grp,
    `warnings=${JSON.stringify(res.warnings)}`,
  );
  check(`${label} plan is non-empty`, (state.plan?.sessions.length ?? 0) > 0);
  check(`${label} 'hydrated' absent from payload`, !('hydrated' in (env.data as object)));
}

// ------------------------------------------------------------- payload sizes
console.log('\n=== 2. Payload size sanity ===');
{
  const env = buildEnvelope(stateFor('10', 'science-bio'), META);
  const kb = Math.round(env.byteSize / 1024);
  console.log(`  info: class 10 science-bio payload = ${kb} KB`);
  check('payload under 3 MB server ceiling', env.byteSize < 3 * 1024 * 1024);
  check('payload plausibly sized (10 KB - 1 MB)', env.byteSize > 10_000 && env.byteSize < 1_000_000);
}

// ----------------------------------------------------------- hostile inputs
console.log('\n=== 3. Hostile / corrupt inputs ===');
const good = buildEnvelope(stateFor('10', 'science-cs'), META);
const clone = () => JSON.parse(JSON.stringify(good));

function expectReject(name: string, input: unknown, kind: string) {
  const res = parseBackup(input);
  check(
    `${name} → rejected (${kind})`,
    !res.ok && res.error.kind === kind,
    res.ok ? 'was ACCEPTED' : `got kind=${res.error.kind}: ${res.error.message}`,
  );
}

expectReject('null', null, 'corrupt');
expectReject('empty array', [], 'corrupt');
expectReject('plain string', 'hello', 'corrupt');
expectReject('number', 42, 'corrupt');
expectReject('empty object', {}, 'schema');
expectReject('missing format', { schemaVersion: 1, data: {} }, 'schema');
expectReject('wrong format tag', { format: 'other.backup', schemaVersion: 1, data: {} }, 'schema');

{
  const f = clone();
  f.schemaVersion = 99;
  expectReject('future schemaVersion 99', f, 'schema');
}
{
  const f = clone();
  f.schemaVersion = CURRENT_SCHEMA_VERSION - 1; // 0, with no migration registered
  expectReject('unmigratable old schemaVersion', f, 'schema');
}
{
  const f = clone();
  delete f.data;
  expectReject('missing data', f, 'corrupt');
}
{
  const f = clone();
  f.data.profile = null;
  expectReject('null profile', f, 'corrupt');
}
{
  const f = clone();
  f.data.profile.classLevel = '11';
  expectReject('invalid classLevel 11', f, 'corrupt');
}
{
  const f = clone();
  f.data.profile.group = 'commerce';
  expectReject('invalid group', f, 'corrupt');
}
{
  const f = clone();
  f.data.profile.examDate = '01-03-2027';
  expectReject('malformed examDate', f, 'corrupt');
}
{
  const f = clone();
  f.byteSize = 4 * 1024 * 1024;
  expectReject('oversize byteSize claim', f, 'quota');
}

// ------------------------------------------------- tolerated-with-warning cases
console.log('\n=== 4. Damaged-but-recoverable inputs (warn, do not reject) ===');

function expectAccept(name: string, input: unknown, assertion: (r: Extract<ParseOk, { ok: true }>) => boolean, detail = '') {
  const res = parseBackup(input);
  if (!res.ok) {
    check(name, false, `rejected: ${res.error.message}`);
    return;
  }
  check(name, assertion(res), detail || `warnings=${JSON.stringify(res.warnings)}`);
}
type ParseOk = ReturnType<typeof parseBackup>;

{
  const f = clone();
  f.checksum = 'deadbeef';
  expectAccept(
    'tampered checksum → accepted with warning',
    f,
    (r) => r.warnings.some((w) => w.includes('Integrity check')),
  );
}
{
  const f = clone();
  delete f.checksum;
  expectAccept(
    'missing checksum → accepted with warning',
    f,
    (r) => r.warnings.some((w) => w.includes('no integrity check')),
  );
}
{
  const f = clone();
  f.data.plan = { generatedAt: 'x', examDate: 'nonsense', sessions: [] };
  expectAccept(
    'unreadable plan → profile kept, plan null, warned',
    f,
    (r) => r.envelope.data.plan === null && r.envelope.data.profile !== null &&
      r.warnings.some((w) => w.includes('regenerate')),
  );
}
{
  const f = clone();
  const n = f.data.plan.sessions.length;
  f.data.plan.sessions[0] = null;
  f.data.plan.sessions[1] = { id: 'x' };
  expectAccept(
    'malformed sessions → filtered and counted',
    f,
    (r) => r.envelope.data.plan!.sessions.length === n - 2 &&
      r.warnings.some((w) => w.includes('damaged study session')),
  );
}
{
  const f = clone();
  f.data.profile.confidence = { math: 'high', physics: 9, chemistry: 3 };
  expectAccept(
    'junk confidence values → dropped/clamped',
    f,
    (r) => {
      const c = r.envelope.data.profile!.confidence;
      return !('math' in c) && c.physics === 5 && c.chemistry === 3;
    },
  );
}
{
  const f = clone();
  f.data.quizAttempts = [{ id: 'q', subjectId: 's', chapterId: 'c', date: '2026-07-01', total: 5, correct: 99 }];
  expectAccept(
    'correct > total → clamped to total',
    f,
    (r) => r.envelope.data.quizAttempts[0].correct === 5,
  );
}
{
  const f = clone();
  f.data.chatHistory = Array.from({ length: 5000 }, (_, i) => ({
    id: `m${i}`, role: 'user', text: 'hi', createdAt: new Date().toISOString(),
  }));
  expectAccept('5000 chat messages → capped at 80', f, (r) => r.envelope.data.chatHistory.length === 80);
}
{
  const f = clone();
  f.data.flashcards = Array.from({ length: 6000 }, (_, i) => ({
    id: `c${i}`, subjectId: 'math', front: 'a', back: 'b',
    due: '2026-08-01', stability: 2, reps: 1, lapses: 0, createdAt: new Date().toISOString(),
  }));
  expectAccept('6000 flashcards → capped at 5000', f, (r) => r.envelope.data.flashcards.length === 5000);
}
{
  const f = clone();
  f.data.quizAttempts = 'not-an-array';
  f.data.flashcards = { nope: true };
  f.data.activeDays = 5;
  expectAccept(
    'non-array collections → empty arrays, no crash',
    f,
    (r) => r.envelope.data.quizAttempts.length === 0 && r.envelope.data.flashcards.length === 0 &&
      r.envelope.data.activeDays.length === 0,
  );
}
{
  const f = clone();
  f.data.activeDays = ['2026-07-20', '2026-07-20', 'garbage', '2026-07-19'];
  expectAccept(
    'activeDays deduped, filtered and sorted',
    f,
    (r) => JSON.stringify(r.envelope.data.activeDays) === JSON.stringify(['2026-07-19', '2026-07-20']),
  );
}
{
  const f = clone();
  f.data.vibrationEnabled = 'yes';
  expectAccept('non-boolean vibrationEnabled → true', f, (r) => r.envelope.data.vibrationEnabled === true);
}
{
  const f = clone();
  f.data.vibrationEnabled = false;
  expectAccept('explicit false vibrationEnabled preserved', f, (r) => r.envelope.data.vibrationEnabled === false);
}
// ---- Focus Guard preferences -------------------------------------------
// The camera flag defaults the OPPOSITE way to haptics: anything other than a
// literal `true` must leave Focus Guard off. A restored backup silently
// switching on a camera would be the worst bug this feature could have.
{
  const f = clone();
  delete f.data.focusGuardEnabled;
  expectAccept('missing focusGuardEnabled → OFF', f, (r) => r.envelope.data.focusGuardEnabled === false);
}
{
  const f = clone();
  f.data.focusGuardEnabled = 'yes';
  expectAccept('non-boolean focusGuardEnabled → OFF', f, (r) => r.envelope.data.focusGuardEnabled === false);
}
{
  const f = clone();
  f.data.focusGuardEnabled = 1;
  expectAccept('truthy-but-not-true focusGuardEnabled → OFF', f, (r) => r.envelope.data.focusGuardEnabled === false);
}
{
  const f = clone();
  f.data.focusGuardEnabled = true;
  expectAccept('explicit true focusGuardEnabled preserved', f, (r) => r.envelope.data.focusGuardEnabled === true);
}
// Voice carries the same strict default as the camera: a restored backup must
// never make a phone start talking out loud on its own.
{
  const f = clone();
  delete f.data.focusVoiceEnabled;
  expectAccept('missing focusVoiceEnabled → OFF', f, (r) => r.envelope.data.focusVoiceEnabled === false);
}
{
  const f = clone();
  f.data.focusVoiceEnabled = 'yes';
  expectAccept('non-boolean focusVoiceEnabled → OFF', f, (r) => r.envelope.data.focusVoiceEnabled === false);
}
{
  const f = clone();
  f.data.focusVoiceEnabled = true;
  expectAccept('explicit true focusVoiceEnabled preserved', f, (r) => r.envelope.data.focusVoiceEnabled === true);
}
// The chosen voice must always be one this build can actually play.
{
  const f = clone();
  f.data.focusVoiceId = 'not-a-voice';
  expectAccept('unknown focusVoiceId falls back to the default', f, (r) => r.envelope.data.focusVoiceId === 'alice');
}
{
  const f = clone();
  delete f.data.focusVoiceId;
  expectAccept('missing focusVoiceId falls back to the default', f, (r) => r.envelope.data.focusVoiceId === 'alice');
}
{
  const f = clone();
  f.data.focusVoiceId = 42;
  expectAccept('non-string focusVoiceId falls back', f, (r) => r.envelope.data.focusVoiceId === 'alice');
}
{
  const f = clone();
  f.data.focusVoiceId = 'river';
  expectAccept('a known focusVoiceId is preserved', f, (r) => r.envelope.data.focusVoiceId === 'river');
}
{
  const f = clone();
  f.data.attentionSpans = [10, 'x', -5, 0, 999999, 22.6, null];
  expectAccept(
    'attentionSpans drops non-numbers and impossible values',
    f,
    (r) => JSON.stringify(r.envelope.data.attentionSpans) === JSON.stringify([10, 23]),
  );
}
{
  const f = clone();
  f.data.attentionSpans = Array.from({ length: 60 }, (_, i) => i + 1);
  expectAccept(
    'attentionSpans is capped at the recent window',
    f,
    (r) => r.envelope.data.attentionSpans.length === 20,
  );
}
{
  const f = clone();
  f.data.attentionSpans = 'not-an-array';
  expectAccept('malformed attentionSpans → empty', f, (r) => r.envelope.data.attentionSpans.length === 0);
}
{
  const f = clone();
  f.data.chatHistory = [{ id: 'm', role: 'system', text: 'x', createdAt: 'now' }];
  expectAccept('invalid chat role → dropped', f, (r) => r.envelope.data.chatHistory.length === 0);
}

// ------------------------------------------------------------------ checksum
console.log('\n=== 5. Checksum + summarize ===');
check('checksum is deterministic', checksum('abc') === checksum('abc'));
check('checksum differs on change', checksum('abc') !== checksum('abd'));
check('checksum is 8 hex chars', /^[0-9a-f]{8}$/.test(checksum('anything')));
{
  const s = summarize(good);
  console.log(`  info: summarize() = "${s}"`);
  check('summarize mentions device label', s.includes('Android (TEST)'));
  check('summarize mentions plan', s.includes('plan'));
}

// --------------------------------------------------------------------- result
console.log(`\n================ ${pass} passed, ${fail} failed ================\n`);
process.exit(fail === 0 ? 0 : 1);
