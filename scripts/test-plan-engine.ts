/**
 * Plan-engine regression suite. Asserts the invariants that were violated by the
 * bugs found on 2026-07-25 (daily time ignored, session count pinned at 2, days
 * over budget, confidence partially ignored) plus general correctness.
 *
 * Run: npx tsx scripts/test-plan-engine.ts
 */
import { generatePlan, repairPlan, todayISO } from 'C:/Users/bilal/Desktop/app/src/lib/planEngine';
import { computeReadiness } from 'C:/Users/bilal/Desktop/app/src/lib/readiness';
import { subjectsForProfile } from 'C:/Users/bilal/Desktop/app/src/data/syllabus';
import { STUDY_TIME_MINUTES } from 'C:/Users/bilal/Desktop/app/src/lib/studyTime';
import type { ClassLevel, StudentProfile, StudyGroup, StudyPlan } from 'C:/Users/bilal/Desktop/app/src/lib/types';

const SESSION_MIN = 20; // mirrors planEngine
const TIME_OPTIONS = STUDY_TIME_MINUTES;
const COMBOS: [ClassLevel, StudyGroup][] = [
  ['9', 'science-bio'], ['9', 'science-cs'], ['9', 'arts'],
  ['10', 'science-bio'], ['10', 'science-cs'], ['10', 'arts'],
];

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`); }
};

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function mkProfile(
  cls: ClassLevel, grp: StudyGroup, dailyMinutes: number, runway: number, conf = 3,
): StudentProfile {
  const confidence: Record<string, number> = {};
  for (const s of subjectsForProfile(cls, grp)) confidence[s.id] = conf;
  return {
    name: 'T', classLevel: cls, group: grp, boardId: 'lahore',
    examDate: addDays(todayISO(), runway), dailyMinutes, confidence,
    createdAt: new Date().toISOString(),
  };
}

function dayTotals(plan: StudyPlan): Map<string, { minutes: number; count: number }> {
  const m = new Map<string, { minutes: number; count: number }>();
  for (const s of plan.sessions) {
    const d = m.get(s.date) ?? { minutes: 0, count: 0 };
    d.minutes += s.minutes; d.count += 1; m.set(s.date, d);
  }
  return m;
}

const studyAvg = (plan: StudyPlan) => {
  const days = new Map<string, number>();
  for (const s of plan.sessions) {
    if (s.kind !== 'study') continue;
    days.set(s.date, (days.get(s.date) ?? 0) + s.minutes);
  }
  const v = [...days.values()];
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};

const studySessionsPerDay = (plan: StudyPlan) => {
  const days = new Map<string, number>();
  for (const s of plan.sessions) {
    if (s.kind !== 'study') continue;
    days.set(s.date, (days.get(s.date) ?? 0) + 1);
  }
  const v = [...days.values()];
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
};

// ---------------------------------------------------------------- 1. budget
console.log('\n=== 1. No day may exceed the student\'s stated daily minutes ===');
for (const runway of [225, 90, 30, 14, 7]) {
  for (const dm of TIME_OPTIONS) {
    for (const [cls, grp] of COMBOS) {
      const plan = generatePlan(mkProfile(cls, grp, dm, runway));
      const over = [...dayTotals(plan).values()].filter((d) => d.minutes > dm);
      if (over.length > 0) {
        check(`runway ${runway}d ${dm}m ${cls}/${grp}`, false,
          `${over.length} days over, worst ${Math.max(...over.map((o) => o.minutes))}m`);
        continue;
      }
    }
  }
}
check('every combo x runway x daily-time stays within budget', fail === 0);

// ------------------------------------------------------- 2. daily time matters
console.log('\n=== 2. Daily study time must actually change the plan (the reported bug) ===');
for (const runway of [225, 90]) {
  const loads = TIME_OPTIONS.map((dm) => ({ dm, avg: studyAvg(generatePlan(mkProfile('10', 'science-bio', dm, runway))) }));
  for (let i = 1; i < loads.length; i++) {
    const prev = loads[i - 1], cur = loads[i];
    check(
      `runway ${runway}d: ${prev.dm}m -> ${cur.dm}m raises study load (${Math.round(prev.avg)} -> ${Math.round(cur.avg)})`,
      cur.avg > prev.avg * 1.1,
    );
  }
  // and the load should be a genuine fraction of what was asked for
  for (const { dm, avg } of loads) {
    check(`runway ${runway}d: ${dm}m/day delivers >=85% of it (${Math.round(avg)}m)`, avg >= dm * 0.85, `${Math.round(avg)} < ${Math.round(dm * 0.85)}`);
  }
}

console.log('\n=== 3. Session count must grow with available time, not stay pinned ===');
{
  const at = (dm: number) => studySessionsPerDay(generatePlan(mkProfile('10', 'science-bio', dm, 225)));
  const s120 = at(120), s360 = at(360), s420 = at(420);
  console.log(`  info: 120m -> ${s120.toFixed(2)} sessions/day, 360m -> ${s360.toFixed(2)}, 420m -> ${s420.toFixed(2)}`);
  check('420m/day yields more study sessions than 120m/day', s420 > s120 + 3);
  check('360m/day yields more study sessions than 120m/day', s360 > s120 + 2);
}

// ------------------------------------------------------------ 4. session floor
console.log('\n=== 4. No stub sessions below the 20-minute design floor ===');
{
  let worst = Infinity; let where = '';
  for (const runway of [225, 90, 30, 14, 7]) {
    for (const dm of TIME_OPTIONS) {
      for (const [cls, grp] of COMBOS) {
        const plan = generatePlan(mkProfile(cls, grp, dm, runway));
        for (const s of plan.sessions) {
          if (s.minutes < worst) { worst = s.minutes; where = `${runway}d/${dm}m/${cls}-${grp}/${s.kind}`; }
        }
      }
    }
  }
  check(`shortest session across all configs is >= ${SESSION_MIN}m (got ${worst}m at ${where})`, worst >= SESSION_MIN);
}

// -------------------------------------------------------------- 5. confidence
console.log('\n=== 5. Every confidence step must change that subject\'s time ===');
{
  const subjects = subjectsForProfile('10', 'science-bio');
  const target = subjects[0];
  const totals: number[] = [];
  const reviseDepth: number[] = [];
  for (const conf of [1, 2, 3, 4, 5]) {
    const confidence: Record<string, number> = {};
    for (const s of subjects) confidence[s.id] = 3;
    confidence[target.id] = conf;
    const plan = generatePlan({
      name: 'T', classLevel: '10', group: 'science-bio', boardId: 'lahore',
      examDate: addDays(todayISO(), 225), dailyMinutes: 180, confidence,
      createdAt: new Date().toISOString(),
    });
    const mine = plan.sessions.filter((s) => s.subjectId === target.id);
    totals.push(mine.filter((s) => s.kind === 'study').reduce((a, b) => a + b.minutes, 0));
    // Per-session depth, NOT total: a confident student finishes the first pass
    // sooner and therefore earns MORE revision cycles, so total revise minutes is
    // deliberately not monotonic. What must fall with confidence is how long each
    // individual revision of a chapter takes.
    const rev = mine.filter((s) => s.kind === 'revise');
    reviseDepth.push(rev.length ? +(rev.reduce((a, b) => a + b.minutes, 0) / rev.length).toFixed(2) : 0);
  }
  console.log(`  info: study minutes by confidence 1..5 = ${totals.join(', ')}`);
  console.log(`  info: avg revise session length by confidence 1..5 = ${reviseDepth.join(', ')}`);
  for (let i = 1; i < totals.length; i++) {
    check(`confidence ${i} -> ${i + 1} reduces study time`, totals[i] < totals[i - 1]);
  }
  check('revision depth never increases with confidence (no binary cliff)',
    reviseDepth.every((v, i) => i === 0 || v <= reviseDepth[i - 1]),
    reviseDepth.join(','));
  check('revision depth at confidence 5 is clearly below confidence 1',
    reviseDepth[4] < reviseDepth[0], `${reviseDepth[4]} vs ${reviseDepth[0]}`);
}

// --------------------------------------------------------------- 5b. variety
console.log('\n=== 5b. A long day must spread across subjects, not stack one ===');
for (const [runway, dm] of [[12, 420], [30, 420], [225, 420], [90, 360]] as [number, number][]) {
  const plan = generatePlan(mkProfile('10', 'science-bio', dm, runway));
  const perDay = new Map<string, string[]>();
  for (const s of plan.sessions) {
    if (s.kind === 'practice') continue;
    perDay.set(s.date, [...(perDay.get(s.date) ?? []), s.subjectId]);
  }
  let worstRun = 0;
  let worstDay = '';
  for (const [date, subs] of perDay) {
    let run = 1;
    for (let i = 1; i < subs.length; i++) {
      run = subs[i] === subs[i - 1] ? run + 1 : 1;
      if (run > worstRun) { worstRun = run; worstDay = date; }
    }
  }
  check(
    `runway ${runway}d @${dm}m: longest same-subject run in a day is <= 2 (got ${worstRun}${worstDay ? ` on ${worstDay}` : ''})`,
    worstRun <= 2,
  );
}

// ---------------------------------------------------------------- 6. coverage
console.log('\n=== 6. Every examined chapter still gets a first pass ===');
for (const [cls, grp] of COMBOS) {
  for (const dm of [120, 420]) {
    const p = mkProfile(cls, grp, dm, 225);
    const plan = generatePlan(p);
    const expected = new Set<string>();
    for (const s of subjectsForProfile(cls, grp)) {
      for (const c of s.chapters[cls]) if (c.weight > 1) expected.add(c.id);
    }
    const got = new Set(plan.sessions.filter((s) => s.kind === 'study').map((s) => s.chapterId));
    const missing = [...expected].filter((c) => !got.has(c));
    check(`class ${cls} ${grp} @${dm}m covers all ${expected.size} chapters`, missing.length === 0, `missing ${missing.length}`);
  }
}

// ------------------------------------------------------- 6b. practice capacity
console.log('\n=== 6b. Practice phase honors every selected daily-time target ===');
for (const dm of TIME_OPTIONS) {
  const plan = generatePlan(mkProfile('10', 'science-bio', dm, 225));
  const practiceByDay = new Map<string, number>();
  for (const s of plan.sessions) {
    if (s.kind === 'practice') practiceByDay.set(s.date, (practiceByDay.get(s.date) ?? 0) + s.minutes);
  }
  const totals = [...practiceByDay.values()];
  check(`${dm}m/day practice days use the full daily target`, totals.length > 0 && totals.every((total) => total === dm), totals.join(', '));
}

// -------------------------------------------------------- 7. no empty stretches
console.log('\n=== 7. No long empty gap before the exam ===');
for (const dm of TIME_OPTIONS) {
  const plan = generatePlan(mkProfile('10', 'science-bio', dm, 225));
  const dates = [...dayTotals(plan).keys()].sort();
  let maxGap = 0;
  for (let i = 1; i < dates.length; i++) {
    const gap = Math.round(
      (new Date(`${dates[i]}T00:00:00`).getTime() - new Date(`${dates[i - 1]}T00:00:00`).getTime()) / 86_400_000,
    );
    if (gap > maxGap) maxGap = gap;
  }
  check(`${dm}m/day: largest gap between scheduled days is <= 2 (got ${maxGap})`, maxGap <= 2);
}

// --------------------------------------------------------------- 8. structural
console.log('\n=== 8. Structural sanity ===');
for (const runway of [3, 5, 7, 30, 225]) {
  const plan = generatePlan(mkProfile('10', 'science-bio', 180, runway));
  check(`runway ${runway}d produces sessions`, plan.sessions.length > 0);
  check(`runway ${runway}d has unique session ids`, new Set(plan.sessions.map((s) => s.id)).size === plan.sessions.length);
  check(`runway ${runway}d schedules nothing after the exam date`,
    plan.sessions.every((s) => s.date <= plan.examDate));
  check(`runway ${runway}d schedules nothing before today`, plan.sessions.every((s) => s.date >= todayISO()));
}

// ----------------------------------------------------------------- 9. repair
console.log('\n=== 9. repairPlan preserves history and respects capacity ===');
{
  const p = mkProfile('10', 'science-bio', 180, 225);
  const plan = generatePlan(p);
  // Backdate a chunk of sessions and mark some done.
  const stale: StudyPlan = {
    ...plan,
    sessions: plan.sessions.map((s, i) => ({
      ...s,
      date: i < 40 ? addDays(todayISO(), -5) : s.date,
      done: i < 10,
    })),
  };
  const repaired = repairPlan(stale, p);
  const doneBefore = stale.sessions.filter((s) => s.done).length;
  const doneAfter = repaired.sessions.filter((s) => s.done).length;
  check('completed sessions are preserved', doneAfter === doneBefore);
  check('no session count lost', repaired.sessions.length === stale.sessions.length);
  const pendingPast = repaired.sessions.filter((s) => !s.done && s.date < todayISO());
  check('no undone session left in the past', pendingPast.length === 0, `${pendingPast.length} remain`);
}

// -------------------------------------------------------------- 10. readiness
console.log('\n=== 10. Every supported plan remains readable by readiness scoring ===');
for (const [cls, grp] of COMBOS) {
  for (const dm of TIME_OPTIONS) {
    const profile = mkProfile(cls, grp, dm, 225);
    const plan = generatePlan(profile);
    const readiness = computeReadiness(profile, plan, []);
    check(
      `${cls}/${grp} @${dm}m returns finite readiness for every subject`,
      readiness.subjects.length === subjectsForProfile(cls, grp).length
        && Number.isFinite(readiness.overall)
        && readiness.subjects.every((subject) => Number.isFinite(subject.score)),
    );
  }
}

console.log(`\n================ ${pass} passed, ${fail} failed ================\n`);
process.exit(fail === 0 ? 0 : 1);
