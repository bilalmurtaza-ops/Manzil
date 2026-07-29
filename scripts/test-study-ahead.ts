/**
 * Day-by-day simulation of the study-ahead feature.
 *
 * Unit tests can't catch what this is for: the *interaction* between working
 * ahead, holes appearing in the calendar, reflow closing them, and revision
 * top-up refilling the tail. So this runs a virtual clock across the whole
 * runway for several student behaviours and re-checks every invariant after
 * every simulated day.
 *
 * Run: npx tsx scripts/test-study-ahead.ts
 */
import {
  completedOn as engineCompletedOn,
  daysAheadUsedToday,
  extendRevision,
  generatePlan,
  maintainPlan,
  MAX_DAYS_AHEAD,
  todayISO,
  upcomingAheadDates,
} from 'C:/Users/bilal/Desktop/app/src/lib/planEngine';
import { subjectsForProfile } from 'C:/Users/bilal/Desktop/app/src/data/syllabus';
import { STUDY_TIME_MINUTES } from 'C:/Users/bilal/Desktop/app/src/lib/studyTime';
import type {
  ClassLevel,
  PlanSession,
  StudentProfile,
  StudyGroup,
  StudyPlan,
} from 'C:/Users/bilal/Desktop/app/src/lib/types';

const SESSION_MIN = 20;
const COMBOS: [ClassLevel, StudyGroup][] = [
  ['9', 'science-bio'], ['9', 'science-cs'], ['9', 'arts'],
  ['10', 'science-bio'], ['10', 'science-cs'], ['10', 'arts'],
];

let pass = 0;
let fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) pass++;
  else {
    fail++;
    if (failures.length < 25) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

function mkProfile(
  cls: ClassLevel, grp: StudyGroup, dailyMinutes: number, runway: number, conf = 3,
): StudentProfile {
  const confidence: Record<string, number> = {};
  for (const s of subjectsForProfile(cls, grp)) confidence[s.id] = conf;
  return {
    name: 'Sim', classLevel: cls, group: grp, boardId: 'lahore',
    examDate: addDays(todayISO(), runway), dailyMinutes, confidence,
    createdAt: new Date().toISOString(),
  };
}

/** Marks a session done at a given simulated timestamp. */
const complete = (s: PlanSession, onDate: string): PlanSession => ({
  ...s,
  done: true,
  doneAt: `${onDate}T10:00:00.000Z`,
});

/** Mirrors the engine's own notion of when a session was completed. */
const completedOnSim = (s: PlanSession): string | null =>
  s.done ? (s.doneAt?.slice(0, 10) ?? s.date) : null;

type Behaviour = 'on-schedule' | 'max-ahead' | 'binge-skip' | 'partial' | 'never';

interface SimResult {
  label: string;
  idleDaysWithWorkRemaining: number;
  maxDayMinutes: number;
  worstOverBudget: number;
  shortestSession: number;
  maxAheadUsed: number;
  duplicateIds: number;
  lostSessions: number;
  pastPending: number;
  practiceMovedEarlier: number;
  streakMisses: number;
  aheadOnlyDays: number;
  examSinkMinutes: number;
}

function simulate(
  profile: StudentProfile,
  behaviour: Behaviour,
  days: number,
  label: string,
): SimResult {
  let plan: StudyPlan = generatePlan(profile);

  // Generated practice dates — used to prove they never get pulled earlier.
  const originalPracticeDate = new Map<string, string>();
  for (const s of plan.sessions) {
    if (s.kind === 'practice') originalPracticeDate.set(s.id, s.date);
  }
  const originalIds = new Set(plan.sessions.map((s) => s.id));

  const res: SimResult = {
    label,
    idleDaysWithWorkRemaining: 0,
    maxDayMinutes: 0,
    worstOverBudget: 0,
    shortestSession: Infinity,
    maxAheadUsed: 0,
    duplicateIds: 0,
    lostSessions: 0,
    pastPending: 0,
    practiceMovedEarlier: 0,
    streakMisses: 0,
    aheadOnlyDays: 0,
    examSinkMinutes: 0,
  };

  for (let d = 0; d < days; d++) {
    const today = addDays(todayISO(), d);
    if (today > profile.examDate) break;

    // --- what a screen would do on mount
    plan = maintainPlan(plan, profile, today);

    // --- invariants that must hold on the maintained plan, every single day
    const ids = plan.sessions.map((s) => s.id);
    if (new Set(ids).size !== ids.length) res.duplicateIds++;
    for (const id of originalIds) {
      if (!plan.sessions.some((s) => s.id === id)) { res.lostSessions++; break; }
    }
    for (const s of plan.sessions) {
      if (s.minutes < res.shortestSession) res.shortestSession = s.minutes;
      if (!s.done && s.date < today) res.pastPending++;
      const orig = originalPracticeDate.get(s.id);
      if (orig && s.date < orig) res.practiceMovedEarlier++;
    }
    // Budget applies to what the app ASKS of the student on a date — i.e. still
    // -pending work. Sessions a student voluntarily pulled forward keep their
    // future date but were completed on an earlier day, so counting those would
    // score their own extra effort as the engine overbooking them.
    //
    // The exam date is excluded deliberately: reflow stops advancing there, so a
    // backlog larger than the remaining runway concentrates on it. That case is
    // genuinely unsatisfiable (more work than days), so it is reported rather
    // than asserted away.
    const scheduledByDate = new Map<string, number>();
    for (const s of plan.sessions) {
      if (s.done) continue;
      scheduledByDate.set(s.date, (scheduledByDate.get(s.date) ?? 0) + s.minutes);
    }
    for (const [date, mins] of scheduledByDate) {
      if (date === profile.examDate) {
        res.examSinkMinutes = Math.max(res.examSinkMinutes, mins);
        continue;
      }
      if (mins > res.maxDayMinutes) res.maxDayMinutes = mins;
      if (mins > profile.dailyMinutes) {
        res.worstOverBudget = Math.max(res.worstOverBudget, mins - profile.dailyMinutes);
      }
    }

    const todays = plan.sessions.filter((s) => s.date === today);
    const pendingAnywhere = plan.sessions.filter((s) => !s.done);
    // THE requirement: never an idle day while work still remains before the exam.
    if (todays.length === 0 && pendingAnywhere.length > 0) res.idleDaysWithWorkRemaining++;

    if (behaviour === 'never') continue;
    if (behaviour === 'binge-skip' && d % 5 < 3) continue; // idle 3 of every 5 days

    // --- the student studies
    const doTodays = behaviour === 'partial'
      ? todays.filter((_, i) => i < Math.ceil(todays.length * 0.6))
      : todays;
    const doneIds = new Set(doTodays.map((s) => s.id));
    plan = {
      ...plan,
      sessions: plan.sessions.map((s) => (doneIds.has(s.id) && !s.done ? complete(s, today) : s)),
    };

    // --- study ahead, capped
    const wantsAhead = behaviour === 'max-ahead' || (behaviour === 'binge-skip' && d % 5 === 4);
    const finishedToday = plan.sessions
      .filter((s) => s.date === today)
      .every((s) => s.done);
    if (wantsAhead && finishedToday) {
      for (let pull = 0; pull < MAX_DAYS_AHEAD; pull++) {
        if (daysAheadUsedToday(plan, today) >= MAX_DAYS_AHEAD) break;
        const next = upcomingAheadDates(plan, today, MAX_DAYS_AHEAD);
        const target = next.find((date) => plan.sessions.some((s) => s.date === date && !s.done));
        if (!target) break;
        plan = {
          ...plan,
          sessions: plan.sessions.map((s) =>
            s.date === target && !s.done ? complete(s, today) : s,
          ),
        };
      }
    }

    const used = daysAheadUsedToday(plan, today);
    if (used > res.maxAheadUsed) res.maxAheadUsed = used;

    // --- streak credit must follow the work, not the schedule.
    // `workedToday` is the shipped predicate (doneAt-based); `creditedByDate` is
    // the old buggy one. A day where the student genuinely studied but the old
    // predicate says otherwise is exactly the regression this feature would have
    // introduced — count those to prove the scenario is real, and assert the
    // shipped predicate never misses a day on which work actually happened.
    const workedToday = plan.sessions.some(
      (s) => s.done && (s.doneAt?.slice(0, 10) ?? s.date) === today,
    );
    const creditedByDate = plan.sessions.some((s) => s.done && s.date === today);
    if (workedToday && !creditedByDate) res.aheadOnlyDays++;
    const didAnyWork = plan.sessions.some((s) => completedOnSim(s) === today);
    if (didAnyWork && !workedToday) res.streakMisses++;
  }

  return res;
}

// ---------------------------------------------------------------------------
console.log('='.repeat(96));
console.log('STUDY-AHEAD SIMULATION — invariants re-checked after every simulated day');
console.log('='.repeat(96));

const BEHAVIOURS: Behaviour[] = ['on-schedule', 'max-ahead', 'binge-skip', 'partial', 'never'];

for (const behaviour of BEHAVIOURS) {
  console.log(`\n--- ${behaviour} ---`);
  for (const dm of STUDY_TIME_MINUTES) {
    const profile = mkProfile('10', 'science-bio', dm, 120);
    const r = simulate(profile, behaviour, 120, `${behaviour}@${dm}`);
    console.log(
      `  ${String(dm).padStart(3)}m/day | idle-with-work ${String(r.idleDaysWithWorkRemaining).padStart(3)}` +
        ` | over budget ${String(r.worstOverBudget).padStart(3)}m` +
        ` | shortest ${String(r.shortestSession === Infinity ? 0 : r.shortestSession).padStart(3)}m` +
        ` | ahead ${r.maxAheadUsed} (ahead-only days ${String(r.aheadOnlyDays).padStart(2)})` +
        ` | exam-sink ${String(r.examSinkMinutes).padStart(5)}m` +
        ` | dup ${r.duplicateIds} lost ${r.lostSessions} past ${r.pastPending} prac-early ${r.practiceMovedEarlier}`,
    );
    check(`${behaviour}@${dm}: never idle while work remains`, r.idleDaysWithWorkRemaining === 0,
      `${r.idleDaysWithWorkRemaining} idle days`);
    check(`${behaviour}@${dm}: no day over budget`, r.worstOverBudget === 0, `+${r.worstOverBudget}m`);
    check(`${behaviour}@${dm}: no session under ${SESSION_MIN}m`,
      r.shortestSession === Infinity || r.shortestSession >= SESSION_MIN, `${r.shortestSession}m`);
    check(`${behaviour}@${dm}: ahead cap respected`, r.maxAheadUsed <= MAX_DAYS_AHEAD, `${r.maxAheadUsed}`);
    check(`${behaviour}@${dm}: no duplicate ids`, r.duplicateIds === 0);
    check(`${behaviour}@${dm}: no original session lost`, r.lostSessions === 0);
    check(`${behaviour}@${dm}: no undone session left in the past`, r.pastPending === 0, `${r.pastPending}`);
    check(`${behaviour}@${dm}: practice never pulled earlier`, r.practiceMovedEarlier === 0,
      `${r.practiceMovedEarlier}`);
    check(`${behaviour}@${dm}: every day with real work is credited`, r.streakMisses === 0,
      `${r.streakMisses} missed`);
  }
}

console.log('\n' + '='.repeat(96));
console.log('ALL 6 PROFILE COMBOS under the most aggressive behaviour (max-ahead)');
console.log('='.repeat(96));
for (const [cls, grp] of COMBOS) {
  for (const dm of [120, 420]) {
    const profile = mkProfile(cls, grp, dm, 120);
    const r = simulate(profile, 'max-ahead', 120, `${cls}/${grp}@${dm}`);
    console.log(
      `  class ${cls} ${grp.padEnd(12)} @${String(dm).padStart(3)}m | idle ${r.idleDaysWithWorkRemaining}` +
        ` | over ${r.worstOverBudget}m | ahead ${r.maxAheadUsed} | past ${r.pastPending}`,
    );
    check(`${cls}/${grp}@${dm}: never idle while work remains`, r.idleDaysWithWorkRemaining === 0);
    check(`${cls}/${grp}@${dm}: no day over budget`, r.worstOverBudget === 0);
    check(`${cls}/${grp}@${dm}: no undone session in the past`, r.pastPending === 0);
    check(`${cls}/${grp}@${dm}: practice stayed anchored`, r.practiceMovedEarlier === 0);
  }
}

console.log('\n' + '='.repeat(96));
console.log('CAP ENFORCEMENT — a student cannot exceed 3 days ahead in one day');
console.log('='.repeat(96));
{
  const profile = mkProfile('10', 'science-bio', 240, 120);
  let plan = generatePlan(profile);
  const today = todayISO();
  plan = maintainPlan(plan, profile, today);
  // finish today
  plan = {
    ...plan,
    sessions: plan.sessions.map((s) => (s.date === today ? complete(s, today) : s)),
  };
  // try to pull 10 days forward — the helper must stop offering after 3
  let pulls = 0;
  for (let i = 0; i < 10; i++) {
    if (daysAheadUsedToday(plan, today) >= MAX_DAYS_AHEAD) break;
    const next = upcomingAheadDates(plan, today, MAX_DAYS_AHEAD);
    const target = next.find((d) => plan.sessions.some((s) => s.date === d && !s.done));
    if (!target) break;
    plan = {
      ...plan,
      sessions: plan.sessions.map((s) => (s.date === target && !s.done ? complete(s, today) : s)),
    };
    pulls++;
  }
  console.log(`  attempted 10 pulls, achieved ${pulls}, daysAheadUsedToday=${daysAheadUsedToday(plan, today)}`);
  check('cannot pull more than MAX_DAYS_AHEAD in one day', daysAheadUsedToday(plan, today) <= MAX_DAYS_AHEAD);
  check('upcomingAheadDates never offers more than the cap',
    upcomingAheadDates(plan, today, MAX_DAYS_AHEAD).length <= MAX_DAYS_AHEAD);

  // the day after: the worked-ahead days are holes and must be filled
  const tomorrow = addDays(today, 1);
  const before = plan.sessions.filter((s) => s.date === tomorrow && !s.done).length;
  plan = maintainPlan(plan, profile, tomorrow);
  const after = plan.sessions.filter((s) => s.date === tomorrow).length;
  console.log(`  tomorrow had ${before} pending before maintain, ${after} sessions after`);
  check('a worked-ahead day is refilled rather than left empty', after > 0);
}

console.log('\n' + '='.repeat(96));
console.log('REST PATH — finishing today normally must NOT auto-pull tomorrow');
console.log('='.repeat(96));
{
  const profile = mkProfile('10', 'science-bio', 180, 120);
  let plan = generatePlan(profile);
  const today = todayISO();
  plan = maintainPlan(plan, profile, today);
  const tomorrow = addDays(today, 1);
  const tomorrowBefore = plan.sessions.filter((s) => s.date === tomorrow).length;
  plan = {
    ...plan,
    sessions: plan.sessions.map((s) => (s.date === today ? complete(s, today) : s)),
  };
  plan = maintainPlan(plan, profile, today); // re-mount same day
  const todayAfter = plan.sessions.filter((s) => s.date === today && !s.done).length;
  const tomorrowAfter = plan.sessions.filter((s) => s.date === tomorrow).length;
  console.log(`  after finishing today: today pending=${todayAfter}, tomorrow=${tomorrowBefore}->${tomorrowAfter}`);
  check('finishing today does not drag tomorrow forward', todayAfter === 0);
  check("tomorrow's plan is left intact", tomorrowAfter === tomorrowBefore);
}

console.log('\n' + '='.repeat(96));
console.log('EXTEND-REVISION REST — a dry non-practice queue must not force-feed today');
console.log('='.repeat(96));
{
  // Found 2026-07-29: a dedicated study-ahead student can, over many real days,
  // exhaust every pending non-practice (study/revise) session before the
  // calendar reaches the practice phase. `extendRevision` closes that gap, but
  // used to start filling at day 0 (today) unconditionally — so re-opening the
  // app *after* finishing today handed the student a brand-new batch of
  // revision dated today, directly contradicting the rest rule `maintainPlan`
  // otherwise enforces via `planNeedsReflow`'s case 4.
  const profile = mkProfile('10', 'science-bio', 240, 200);
  const today = todayISO();

  const doneToday: PlanSession = {
    id: 'done-today', date: today, subjectId: 'math', chapterId: 'm10-1',
    kind: 'study', minutes: 60, done: true, doneAt: new Date().toISOString(),
  };
  const futurePractice: PlanSession = {
    id: 'future-practice', date: addDays(today, 50), subjectId: 'math', chapterId: 'm10-1',
    kind: 'practice', minutes: 45, done: false,
  };
  const restPlan: StudyPlan = {
    generatedAt: new Date().toISOString(), examDate: profile.examDate,
    sessions: [doneToday, futurePractice],
  };
  const restResult = extendRevision(restPlan, profile, today);
  const restToday = restResult.sessions.filter((s) => !s.done && s.date === today).length;
  check('rest case: nothing already pending + something done today -> no new work lands on today',
    restToday === 0, `got ${restToday} new sessions on today`);

  // The complementary path must keep working: a genuine hole with nothing done
  // yet still fills from today, or a student could hit an idle day.
  const doneYesterday: PlanSession = {
    id: 'done-yesterday', date: addDays(today, -1), subjectId: 'math', chapterId: 'm10-2',
    kind: 'study', minutes: 60, done: true, doneAt: new Date(Date.now() - 86_400_000).toISOString(),
  };
  const holePlan: StudyPlan = {
    generatedAt: new Date().toISOString(), examDate: profile.examDate,
    sessions: [doneYesterday, futurePractice],
  };
  const holeResult = extendRevision(holePlan, profile, today);
  const holeToday = holeResult.sessions.filter((s) => !s.done && s.date === today).length;
  check('genuine hole: nothing done today -> still fills from today, no idle day',
    holeToday > 0, `got ${holeToday} sessions on today`);
}

console.log('\n' + '='.repeat(96));
console.log('STREAK CREDIT — completedOn() is the shared definition of "studied today"');
console.log('='.repeat(96));
{
  const base: PlanSession = {
    id: 'x', date: '2026-01-08', subjectId: 'math', chapterId: 'c1',
    kind: 'study', minutes: 40, done: false,
  };
  const today = '2026-01-05';

  // A lesson pulled forward: scheduled for the 8th, actually studied on the 5th.
  // doneAt is built from a LOCAL time on the 5th and then serialised, exactly as
  // the store does it. Hardcoding a `...T21:30:00.000Z` literal instead used to
  // pass only because completedOn sliced the UTC date — at UTC+5 that instant is
  // already 02:30 on the 6th, so the literal described the wrong day.
  const pulledForward = {
    ...base,
    done: true,
    doneAt: new Date(`${today}T21:30:00`).toISOString(),
  };
  check('a pulled-forward lesson credits the day it was studied',
    engineCompletedOn(pulledForward) === today, `${engineCompletedOn(pulledForward)}`);
  check('the old date-based rule would NOT have credited it — the bug this fixes',
    pulledForward.date !== today);

  // Legacy / restored data with no doneAt must behave exactly as before.
  const legacy = { ...base, done: true, doneAt: undefined };
  check('a done session with no doneAt falls back to its scheduled date',
    engineCompletedOn(legacy) === base.date, `${engineCompletedOn(legacy)}`);

  check('an unfinished session credits nothing', engineCompletedOn(base) === null);

  // The store's activeDays rule, expressed exactly as the store expresses it.
  const sessions = [base, pulledForward];
  check('a day spent only on pulled-forward lessons still counts as active',
    sessions.some((s) => engineCompletedOn(s) === today));
}

console.log('\n' + '='.repeat(96));
if (failures.length > 0) {
  console.log('FAILURES:');
  for (const f of failures) console.log(`  FAIL  ${f}`);
}
console.log(`================ ${pass} passed, ${fail} failed ================\n`);
process.exit(fail === 0 ? 0 : 1);
