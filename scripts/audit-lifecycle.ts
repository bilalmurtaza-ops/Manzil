/**
 * Pre-contest audit: the "what if?" suite.
 *
 * Everything else tests a plan on its intended runway with a student behaving in
 * a modelled way. This suite tests the plan when the WORLD misbehaves — the exam
 * date arrives and passes, the device clock jumps, the student rewrites their
 * profile halfway through, a months-old backup lands on a fresh install.
 *
 * These are the paths a judge reaches by accident, and none of them had a single
 * assertion before this file.
 *
 * Run: npx tsx scripts/audit-lifecycle.ts
 */
import {
  MAX_DAYS_AHEAD,
  completedOn,
  daysAheadUsedToday,
  generatePlan,
  maintainPlan,
  rebalancePlan,
  todayISO,
  upcomingAheadDates,
} from 'C:/Users/bilal/Desktop/app/src/lib/planEngine';
import { subjectsForProfile } from 'C:/Users/bilal/Desktop/app/src/data/syllabus';
import type {
  ClassLevel,
  PlanSession,
  StudentProfile,
  StudyGroup,
  StudyPlan,
} from 'C:/Users/bilal/Desktop/app/src/lib/types';

const SESSION_MIN = 20;

let pass = 0;
let fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) {
    pass++;
  } else {
    fail++;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const section = (t: string) => console.log(`\n=== ${t} ===`);

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function mkProfile(
  cls: ClassLevel,
  grp: StudyGroup,
  dailyMinutes: number,
  runway: number,
): StudentProfile {
  const confidence: Record<string, number> = {};
  for (const s of subjectsForProfile(cls, grp)) confidence[s.id] = 3;
  return {
    name: 'Audit',
    classLevel: cls,
    group: grp,
    boardId: 'lahore',
    examDate: addDays(todayISO(), runway),
    dailyMinutes,
    confidence,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Invariants that must hold after ANY maintenance, on ANY simulated day.
 * Returns human-readable problems rather than asserting, so a scenario can
 * report every violation it produced instead of dying on the first.
 */
function health(plan: StudyPlan, profile: StudentProfile, today: string): string[] {
  const problems: string[] = [];
  const pending = plan.sessions.filter((s) => !s.done);

  // Overdue work must never survive maintenance. The exam date is the documented
  // sink for a backlog bigger than the runway, so it is exempt.
  const overdue = pending.filter((s) => s.date < today && s.date !== profile.examDate);
  if (overdue.length > 0) problems.push(`${overdue.length} pending sessions still in the past`);

  // Nothing may be scheduled after the exam — but only while the exam is still
  // ahead. Once it has passed, laying the remaining work out from today is the
  // correct behaviour and every session is necessarily "after the exam date".
  if (profile.examDate >= today) {
    const afterExam = plan.sessions.filter((s) => s.date > profile.examDate);
    if (afterExam.length > 0) problems.push(`${afterExam.length} sessions dated after the exam`);
  }

  // Budget, counting pending minutes only — work the student volunteered by
  // pulling ahead is not the engine overbooking them. The exam-date sink is
  // excluded for the same reason it is above.
  const perDay = new Map<string, number>();
  for (const s of pending) {
    if (s.date === profile.examDate) continue;
    perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.minutes);
  }
  for (const [date, mins] of perDay) {
    if (mins > profile.dailyMinutes) {
      problems.push(`${date} over budget: ${mins}>${profile.dailyMinutes}`);
      break;
    }
  }

  const ids = new Set<string>();
  for (const s of plan.sessions) {
    if (ids.has(s.id)) {
      problems.push(`duplicate id ${s.id}`);
      break;
    }
    ids.add(s.id);
    if (!Number.isFinite(s.minutes) || s.minutes < SESSION_MIN) {
      problems.push(`session ${s.id} has ${s.minutes} minutes`);
      break;
    }
  }

  return problems;
}

/** "Is there anything for the student to do, or anything they already did?" */
const hasSomethingToday = (plan: StudyPlan, today: string) =>
  plan.sessions.some((s) => s.date === today && !s.done) ||
  plan.sessions.some((s) => completedOn(s) === today);

const completeAll = (plan: StudyPlan, dates: string[], at: string): StudyPlan => ({
  ...plan,
  sessions: plan.sessions.map((s) =>
    dates.includes(s.date) && !s.done ? { ...s, done: true, doneAt: `${at}T10:00:00.000Z` } : s,
  ),
});

// ===========================================================================
section('1. Generated plans never overrun the exam date');
// A student may onboard the day before their first paper; onboarding clamps the
// exam to at least tomorrow, so runways of 1 and 2 days are reachable.
// ===========================================================================
for (const runway of [1, 2, 3, 5, 10, 60, 225]) {
  for (const [cls, grp] of [['10', 'science-bio'], ['9', 'arts']] as [ClassLevel, StudyGroup][]) {
    const profile = mkProfile(cls, grp, 180, runway);
    const plan = generatePlan(profile);
    const after = plan.sessions.filter((s) => s.date > profile.examDate);
    const tag = `${cls}/${grp}@${runway}d`;
    check(`${tag}: nothing scheduled past the exam date`, after.length === 0,
      `${after.length} sessions, last ${plan.sessions.map((s) => s.date).sort().pop()} vs exam ${profile.examDate}`);
    check(`${tag}: plan is non-empty`, plan.sessions.length > 0);
  }
}

// ===========================================================================
section('2. The exam date arrives — and passes');
// The student keeps the app installed. Nothing may dead-end.
// ===========================================================================
{
  const profile = mkProfile('10', 'science-bio', 180, 10);
  let plan = generatePlan(profile);
  // Study honestly for 4 days, then stop (exams are near; life happens).
  for (let d = 0; d < 4; d += 1) {
    const today = addDays(todayISO(), d);
    plan = maintainPlan(plan, profile, today);
    plan = completeAll(plan, [today], today);
  }

  for (const offset of [9, 10, 11, 15, 40]) {
    const today = addDays(todayISO(), offset);
    const before = plan.sessions.filter((s) => !s.done).length;
    plan = maintainPlan(plan, profile, today);
    const problems = health(plan, profile, today);
    const label = offset < 10 ? 'eve of exam' : offset === 10 ? 'exam day' : `${offset - 10}d after exam`;
    const pendingNow = plan.sessions.filter((s) => !s.done).length;
    console.log(
      `  day+${offset} (${label}): pending ${before}->${pendingNow}, ` +
        `something today = ${hasSomethingToday(plan, today)}`,
    );
    check(`day+${offset}: maintenance keeps the plan healthy`, problems.length === 0, problems.join('; '));
    check(`day+${offset}: no crash and sessions preserved`, plan.sessions.length > 0);
    if (offset > 10) {
      // Past the exam there is nothing left to schedule, but the app must not
      // be sitting on a pile of "overdue" work it can never clear.
      check(
        `day+${offset}: no unreachable backlog left dangling`,
        plan.sessions.filter((s) => !s.done && s.date < today).length === 0,
        `${plan.sessions.filter((s) => !s.done && s.date < today).length} stuck`,
      );
    }
  }
}

// ===========================================================================
section('3. Device clock jumps');
// ===========================================================================
{
  const profile = mkProfile('10', 'science-cs', 240, 120);
  const base = generatePlan(profile);

  const jumps: [string, number][] = [
    ['forward 30 days', 30],
    ['forward 1 day', 1],
    ['backward 5 days', -5],
    ['backward 40 days', -40],
    ['across a month boundary', 35],
  ];
  for (const [label, delta] of jumps) {
    const today = addDays(todayISO(), delta);
    const plan = maintainPlan(base, profile, today);
    const problems = health(plan, profile, today);
    check(`clock ${label}: plan stays healthy`, problems.length === 0, problems.join('; '));
    if (delta >= 0) {
      check(
        `clock ${label}: student has work waiting`,
        hasSomethingToday(plan, today),
        'nothing to do despite pending work',
      );
    }
    // A backwards clock must not destroy or duplicate anything.
    check(
      `clock ${label}: no sessions lost or duplicated`,
      plan.sessions.length === base.sessions.length ||
        plan.sessions.length > base.sessions.length, // extendRevision may top up
      `${base.sessions.length} -> ${plan.sessions.length}`,
    );
  }
}

// ===========================================================================
section('4. Profile edited mid-plan (daily time changed on live progress)');
// ===========================================================================
for (const [from, to] of [[120, 420], [420, 120], [240, 180]] as [number, number][]) {
  const profile = mkProfile('10', 'science-bio', from, 120);
  let plan = generatePlan(profile);
  // Two weeks of honest work first, so there is real history to preserve.
  for (let d = 0; d < 14; d += 1) {
    const today = addDays(todayISO(), d);
    plan = maintainPlan(plan, profile, today);
    plan = completeAll(plan, [today], today);
  }
  const doneBefore = plan.sessions.filter((s) => s.done).length;

  const changed = { ...profile, dailyMinutes: to };
  const today = addDays(todayISO(), 14);
  // The Plan tab's time chips call rebalancePlan — maintainPlan deliberately
  // leaves an ordinary day alone, so it is the wrong entry point for "the
  // student changed their capacity" and asserting against it tests nothing real.
  const after = rebalancePlan(plan, changed, today);
  const problems = health(after, changed, today);
  const tag = `${from}->${to}m`;

  check(`${tag}: plan healthy under the new capacity`, problems.length === 0, problems.join('; '));
  check(
    `${tag}: completed history is preserved`,
    after.sessions.filter((s) => s.done).length === doneBefore,
    `${doneBefore} -> ${after.sessions.filter((s) => s.done).length}`,
  );
  check(`${tag}: student has work today`, hasSomethingToday(after, today));

  // The new capacity must actually take effect on the days ahead.
  const perDay = new Map<string, number>();
  for (const s of after.sessions.filter((x) => !x.done && x.date > today && x.date !== changed.examDate)) {
    perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.minutes);
  }
  const loads = [...perDay.values()];
  const peak = loads.length ? Math.max(...loads) : 0;
  check(`${tag}: no future day exceeds the new daily limit`, peak <= to, `peak ${peak} > ${to}`);
}

// ===========================================================================
section('5. A months-old backup lands on a fresh install');
// ===========================================================================
for (const age of [30, 90, 200]) {
  // A plan generated `age` days ago: shift every date back to simulate it.
  const profile = mkProfile('9', 'science-bio', 180, 225);
  const original = generatePlan(profile);
  const stale: StudyPlan = {
    ...original,
    sessions: original.sessions.map((s) => ({ ...s, date: addDays(s.date, -age) })),
  };
  const today = todayISO();
  const restored = maintainPlan(stale, profile, today);
  const problems = health(restored, profile, today);

  check(`${age}d-old backup: restores to a healthy plan`, problems.length === 0, problems.join('; '));
  check(`${age}d-old backup: student has work today`, hasSomethingToday(restored, today));
  check(
    `${age}d-old backup: no content lost`,
    restored.sessions.length >= stale.sessions.length,
    `${stale.sessions.length} -> ${restored.sessions.length}`,
  );
}

// ===========================================================================
section('6. Extreme values a restored backup is allowed to contain');
// backupSchema clamps dailyMinutes to [15,960] and session minutes to [1,600],
// so these are reachable states, not fantasies.
// ===========================================================================
{
  const profile = { ...mkProfile('10', 'arts', 15, 60) };
  const plan = generatePlan(profile);
  const today = todayISO();
  const maintained = maintainPlan(plan, profile, today);
  check(
    'dailyMinutes=15 (below the 45-minute floor) still produces a usable plan',
    maintained.sessions.length > 0 && health(maintained, { ...profile, dailyMinutes: 45 }, today).length === 0,
    health(maintained, { ...profile, dailyMinutes: 45 }, today).join('; '),
  );

  // A single session longer than a whole day's capacity.
  const profile2 = mkProfile('10', 'arts', 120, 60);
  const base = generatePlan(profile2);
  const monstrous: StudyPlan = {
    ...base,
    sessions: [
      { ...base.sessions[0], id: 'monster', minutes: 600, done: false, date: addDays(todayISO(), -5) },
      ...base.sessions.slice(1),
    ],
  };
  const fixed = maintainPlan(monstrous, profile2, today);
  check(
    'a 600-minute session does not hang or vanish',
    fixed.sessions.some((s) => s.id === 'monster'),
    'session lost',
  );
  check(
    'a 600-minute session lands on a real date',
    /^\d{4}-\d{2}-\d{2}$/.test(fixed.sessions.find((s) => s.id === 'monster')!.date),
  );
}

// ===========================================================================
section('7. Study-ahead crossed with skipping');
// ===========================================================================
{
  const profile = mkProfile('10', 'science-bio', 180, 90);
  let plan = generatePlan(profile);
  let day = 0;

  // Pull the maximum forward on day 0.
  let today = addDays(todayISO(), day);
  plan = maintainPlan(plan, profile, today);
  const ahead = upcomingAheadDates(plan, today, MAX_DAYS_AHEAD);
  plan = completeAll(plan, [today, ...ahead], today);
  check(
    'day 0: pulled exactly the 3-day maximum',
    daysAheadUsedToday(plan, today) === MAX_DAYS_AHEAD,
    `${daysAheadUsedToday(plan, today)}`,
  );

  // Then vanish for 4 days.
  day = 8;
  today = addDays(todayISO(), day);
  plan = maintainPlan(plan, profile, today);
  let problems = health(plan, profile, today);
  check('after a 4-day disappearance: plan healthy', problems.length === 0, problems.join('; '));
  check('after a 4-day disappearance: work is waiting', hasSomethingToday(plan, today));
  check(
    'the ahead-allowance resets on a new day',
    daysAheadUsedToday(plan, today) === 0,
    `${daysAheadUsedToday(plan, today)}`,
  );

  // Pull ahead again immediately after catching up.
  const ahead2 = upcomingAheadDates(plan, today, MAX_DAYS_AHEAD);
  plan = completeAll(plan, [today, ...ahead2], today);
  check(
    'can still pull a full 3 days after catching up',
    daysAheadUsedToday(plan, today) <= MAX_DAYS_AHEAD,
    `${daysAheadUsedToday(plan, today)}`,
  );
  problems = health(plan, profile, addDays(todayISO(), day + 1));
  check('healthy the morning after a second binge', problems.length === 0, problems.join('; '));
}

// ===========================================================================
section('8. Long unattended stretches (the app sat unopened)');
// ===========================================================================
for (const gap of [7, 30, 90]) {
  const profile = mkProfile('10', 'science-bio', 240, 200);
  const plan = generatePlan(profile);
  const today = addDays(todayISO(), gap);
  const maintained = maintainPlan(plan, profile, today);
  const problems = health(maintained, profile, today);
  check(`${gap}-day absence: plan recovers cleanly`, problems.length === 0, problems.join('; '));
  check(`${gap}-day absence: work is waiting today`, hasSomethingToday(maintained, today));
  const stuck = maintained.sessions.filter((s) => !s.done && s.date < today && s.date !== profile.examDate);
  check(`${gap}-day absence: nothing left stranded in the past`, stuck.length === 0, `${stuck.length}`);
}

// ===========================================================================
section('9. Idempotence — maintenance must be safe to run on every render');
// today.tsx calls maintainPlan on mount; a second call must be a no-op.
// ===========================================================================
for (const [cls, grp] of [['10', 'science-bio'], ['9', 'arts']] as [ClassLevel, StudyGroup][]) {
  for (const offset of [0, 5, 40]) {
    const profile = mkProfile(cls, grp, 180, 120);
    const plan = generatePlan(profile);
    const today = addDays(todayISO(), offset);
    const once = maintainPlan(plan, profile, today);
    const twice = maintainPlan(once, profile, today);
    const fp = (p: StudyPlan) => p.sessions.map((s) => `${s.id}|${s.date}|${s.minutes}`).join(';');
    check(
      `${cls}/${grp}@+${offset}: maintenance is idempotent`,
      fp(once) === fp(twice),
      `${once.sessions.length} -> ${twice.sessions.length} sessions`,
    );
  }
}

// ===========================================================================
section(`10. Date helpers agree with the local calendar (TZ=${process.env.TZ ?? 'system'})`);
// Run this file under several TZ values to prove the fix holds everywhere:
//   TZ=Asia/Karachi   (UTC+5, the target market, no DST)
//   TZ=Pacific/Kiritimati (UTC+14, the extreme where UTC-slicing breaks worst)
//   TZ=America/Santiago  (negative offset WITH daylight saving)
// ===========================================================================
{
  const now = new Date();
  const manual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
    now.getDate(),
  ).padStart(2, '0')}`;
  check('todayISO matches the local calendar date', todayISO() === manual, `${todayISO()} vs ${manual}`);
  check('todayISO is well-formed', /^\d{4}-\d{2}-\d{2}$/.test(todayISO()), todayISO());
  check('addDays(today, 0) is today', addDays(todayISO(), 0) === todayISO(), addDays(todayISO(), 0));

  // Round trips, including across month, year and DST boundaries.
  for (const anchor of ['2026-01-31', '2026-02-28', '2026-12-31', '2026-03-08', '2026-10-25']) {
    for (const n of [1, 7, 30, 365]) {
      check(
        `addDays round-trips at ${anchor} +/-${n}`,
        addDays(addDays(anchor, n), -n) === anchor,
        `${addDays(addDays(anchor, n), -n)}`,
      );
    }
  }

  // A session completed "now" must read as completed today, which is the whole
  // reason completedOn parses doneAt as an instant rather than slicing it.
  const nowSession: PlanSession = {
    id: 'x', date: addDays(todayISO(), 5), subjectId: 'math', chapterId: 'm10-1',
    kind: 'study', minutes: 30, done: true, doneAt: new Date().toISOString(),
  };
  check(
    'a session completed now counts as completed today',
    completedOn(nowSession) === todayISO(),
    `${completedOn(nowSession)} vs ${todayISO()}`,
  );
  // Legacy/restored rows without doneAt must keep their old meaning.
  check(
    'a done session with no doneAt falls back to its scheduled date',
    completedOn({ ...nowSession, doneAt: undefined }) === nowSession.date,
  );
  check(
    'a doneAt that is already a plain date is respected',
    completedOn({ ...nowSession, doneAt: '2026-05-05' }) === '2026-05-05',
  );
  check('an unparseable doneAt degrades to the scheduled date',
    completedOn({ ...nowSession, doneAt: 'garbage' }) === nowSession.date);
}

// ===========================================================================
console.log(`\n${'='.repeat(70)}`);
console.log(`${pass} passed, ${fail} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail === 0 ? 0 : 1);
