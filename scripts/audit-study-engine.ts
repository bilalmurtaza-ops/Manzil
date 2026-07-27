/**
 * Pre-contest audit: does the study engine actually RESPOND to its inputs?
 *
 * test-plan-engine.ts asserts that a generated plan is well-formed. This suite
 * asserts something different and, for a contest, more important: that every
 * input the student can change visibly changes the output it claims to change.
 * A plan that is beautifully well-formed but identical whether you pick 2 hours
 * or 7 is a fabricated plan, and that exact bug has shipped here before.
 *
 * Matrix: 6 profile combos x 5 daily-time options x 4 confidence patterns
 * x 5 runways.
 *
 * Run: npx tsx scripts/audit-study-engine.ts
 */
import { generatePlan, todayISO } from 'C:/Users/bilal/Desktop/app/src/lib/planEngine';
import { computeReadiness } from 'C:/Users/bilal/Desktop/app/src/lib/readiness';
import { subjectsForProfile } from 'C:/Users/bilal/Desktop/app/src/data/syllabus';
import { STUDY_TIME_MINUTES } from 'C:/Users/bilal/Desktop/app/src/lib/studyTime';
import type {
  ClassLevel,
  PlanSession,
  StudentProfile,
  StudyGroup,
  StudyPlan,
} from 'C:/Users/bilal/Desktop/app/src/lib/types';

const SESSION_MIN = 20; // mirrors planEngine
const SESSION_MAX = 60;
const TIME_OPTIONS = STUDY_TIME_MINUTES; // 120 180 240 360 420
const COMBOS: [ClassLevel, StudyGroup][] = [
  ['9', 'science-bio'], ['9', 'science-cs'], ['9', 'arts'],
  ['10', 'science-bio'], ['10', 'science-cs'], ['10', 'arts'],
];
const RUNWAYS = [400, 225, 60, 20, 3];

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
const section = (title: string) => console.log(`\n=== ${title} ===`);

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

type ConfPattern = 'all-weak' | 'all-strong' | 'mixed' | 'missing';

function mkProfile(
  cls: ClassLevel,
  grp: StudyGroup,
  dailyMinutes: number,
  runway: number,
  conf: number | ConfPattern = 3,
): StudentProfile {
  const subjects = subjectsForProfile(cls, grp);
  const confidence: Record<string, number> = {};
  if (typeof conf === 'number') {
    for (const s of subjects) confidence[s.id] = conf;
  } else if (conf === 'all-weak') {
    for (const s of subjects) confidence[s.id] = 1;
  } else if (conf === 'all-strong') {
    for (const s of subjects) confidence[s.id] = 5;
  } else if (conf === 'mixed') {
    subjects.forEach((s, i) => (confidence[s.id] = (i % 5) + 1));
  }
  // 'missing' deliberately leaves confidence empty — the engine must default to 3
  // rather than producing NaN minutes. A restored/partial profile looks like this.
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

const byDate = (plan: StudyPlan): Map<string, PlanSession[]> => {
  const m = new Map<string, PlanSession[]>();
  for (const s of plan.sessions) {
    const list = m.get(s.date) ?? [];
    list.push(s); // insertion order == the order the student sees them
    m.set(s.date, list);
  }
  return m;
};

/** Mean minutes/day across days that contain at least one session of `kind`. */
function avgPerDay(plan: StudyPlan, kind: PlanSession['kind']): number {
  const days = new Map<string, number>();
  for (const s of plan.sessions) {
    if (s.kind !== kind) continue;
    days.set(s.date, (days.get(s.date) ?? 0) + s.minutes);
  }
  const v = [...days.values()];
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

function avgSessionsPerDay(plan: StudyPlan, kind: PlanSession['kind']): number {
  const days = new Map<string, number>();
  for (const s of plan.sessions) {
    if (s.kind !== kind) continue;
    days.set(s.date, (days.get(s.date) ?? 0) + 1);
  }
  const v = [...days.values()];
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

/** Day index (0-based from today) on which the first pass finishes. */
function firstPassEndDay(plan: StudyPlan): number {
  const dates = plan.sessions.filter((s) => s.kind === 'study').map((s) => s.date);
  if (dates.length === 0) return -1;
  const last = dates.reduce((a, b) => (a > b ? a : b));
  return Math.round(
    (new Date(`${last}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime()) /
      86_400_000,
  );
}

const totalMinutes = (plan: StudyPlan, kind?: PlanSession['kind']) =>
  plan.sessions.filter((s) => !kind || s.kind === kind).reduce((a, s) => a + s.minutes, 0);

const strictlyIncreasing = (xs: number[]) => xs.every((v, i) => i === 0 || v > xs[i - 1]);
const nonDecreasing = (xs: number[]) => xs.every((v, i) => i === 0 || v >= xs[i - 1] - 1e-9);
const fmt = (xs: number[]) => xs.map((x) => Math.round(x)).join(' -> ');

// ===========================================================================
section('1. Structural invariants hold across the whole matrix');
// Re-asserted here (not just in test-plan-engine) because this matrix adds the
// confidence patterns and the 400/3-day runways that suite never exercises.
// ===========================================================================
{
  let budgetViolations = 0;
  let shortSessions = 0;
  let longSessions = 0;
  let dupIds = 0;
  let badMinutes = 0;
  let stacked = 0;
  let plans = 0;

  for (const [cls, grp] of COMBOS) {
    for (const dm of TIME_OPTIONS) {
      for (const runway of RUNWAYS) {
        for (const conf of ['all-weak', 'all-strong', 'mixed', 'missing'] as ConfPattern[]) {
          const profile = mkProfile(cls, grp, dm, runway, conf);
          const plan = generatePlan(profile);
          plans += 1;
          const tag = `${cls}/${grp}@${dm}m/${runway}d/${conf}`;

          const seen = new Set<string>();
          for (const s of plan.sessions) {
            if (seen.has(s.id)) dupIds += 1;
            seen.add(s.id);
            if (!Number.isFinite(s.minutes) || s.minutes <= 0) badMinutes += 1;
            if (s.minutes < SESSION_MIN) shortSessions += 1;
            if (s.minutes > SESSION_MAX) longSessions += 1;
          }

          for (const [, list] of byDate(plan)) {
            const mins = list.reduce((a, s) => a + s.minutes, 0);
            if (mins > dm) {
              budgetViolations += 1;
              if (budgetViolations <= 3) console.log(`        over budget: ${tag} ${mins}>${dm}`);
            }
            // No more than 2 consecutive blocks of one subject.
            let run = 1;
            for (let i = 1; i < list.length; i += 1) {
              run = list[i].subjectId === list[i - 1].subjectId ? run + 1 : 1;
              if (run > 2) {
                stacked += 1;
                if (stacked <= 3) console.log(`        stacked x${run}: ${tag} ${list[i].subjectId}`);
                break;
              }
            }
          }
        }
      }
    }
  }
  console.log(`  (${plans} plans generated)`);
  check('no day exceeds the stated daily minutes', budgetViolations === 0, `${budgetViolations} days`);
  check('no session below SESSION_MIN', shortSessions === 0, `${shortSessions} sessions`);
  check('no session above SESSION_MAX', longSessions === 0, `${longSessions} sessions`);
  check('no duplicate session ids', dupIds === 0, `${dupIds} dupes`);
  check('every session has finite positive minutes', badMinutes === 0, `${badMinutes} bad`);
  check('never more than 2 consecutive blocks of one subject', stacked === 0, `${stacked} days`);
}

// ===========================================================================
section('2. Daily study time genuinely reshapes the plan');
// The regression that shipped: studyDailyLoad saturated at ~90 min, so 2h and
// 7h students received byte-identical plans.
// ===========================================================================
for (const [cls, grp] of COMBOS) {
  const runway = 225;
  const loads: number[] = [];
  const counts: number[] = [];
  const ends: number[] = [];
  const totals: number[] = [];
  const fingerprints = new Set<string>();

  for (const dm of TIME_OPTIONS) {
    const plan = generatePlan(mkProfile(cls, grp, dm, runway));
    loads.push(avgPerDay(plan, 'study'));
    counts.push(avgSessionsPerDay(plan, 'study'));
    ends.push(firstPassEndDay(plan));
    totals.push(totalMinutes(plan));
    fingerprints.add(
      plan.sessions.map((s) => `${s.date}|${s.subjectId}|${s.chapterId}|${s.minutes}`).join(';'),
    );
  }

  const tag = `${cls}/${grp}`;
  check(`${tag}: daily study load rises with time`, strictlyIncreasing(loads), fmt(loads));
  check(`${tag}: sessions/day rises with time`, strictlyIncreasing(counts), fmt(counts));
  check(
    `${tag}: first pass finishes sooner with more time`,
    ends.every((v, i) => i === 0 || v <= ends[i - 1]) && ends[ends.length - 1] < ends[0],
    fmt(ends),
  );
  check(`${tag}: total scheduled minutes rise with time`, nonDecreasing(totals), fmt(totals));
  check(
    `${tag}: all 5 plans are distinct`,
    fingerprints.size === TIME_OPTIONS.length,
    `${fingerprints.size}/${TIME_OPTIONS.length} unique`,
  );
}

// ===========================================================================
section('3. Confidence genuinely reshapes the plan');
// The regression that shipped: a binary weak/strong split made ratings 3, 4 and
// 5 produce identical revision depth.
// ===========================================================================
for (const [cls, grp] of COMBOS) {
  // Long runway on purpose: with a short one, `scale` compresses the first pass
  // to fit the window, which masks the confidence effect on study minutes.
  const runway = 400;
  const reviseDepth: number[] = [];
  const studyTotals: number[] = [];

  for (const conf of [5, 4, 3, 2, 1]) {
    const plan = generatePlan(mkProfile(cls, grp, 180, runway, conf));
    const rev = plan.sessions.filter((s) => s.kind === 'revise');
    reviseDepth.push(rev.length ? rev.reduce((a, s) => a + s.minutes, 0) / rev.length : 0);
    studyTotals.push(totalMinutes(plan, 'study'));
  }

  const tag = `${cls}/${grp}`;
  // Per-SESSION depth, not total revise minutes: total is deliberately not
  // monotonic, because a confident student finishes the first pass sooner and
  // therefore earns more revision cycles.
  check(
    `${tag}: revision depth per session deepens as confidence drops`,
    strictlyIncreasing(reviseDepth),
    fmt(reviseDepth),
  );
  check(
    `${tag}: first-pass minutes grow as confidence drops`,
    strictlyIncreasing(studyTotals),
    fmt(studyTotals),
  );
  check(
    `${tag}: every confidence step changes the plan`,
    new Set(reviseDepth.map((d) => d.toFixed(3))).size === 5,
    fmt(reviseDepth),
  );
}

// A profile with no confidence data at all must behave exactly like a neutral 3.
for (const [cls, grp] of COMBOS) {
  const a = generatePlan(mkProfile(cls, grp, 180, 225, 'missing'));
  const b = generatePlan(mkProfile(cls, grp, 180, 225, 3));
  check(
    `${cls}/${grp}: missing confidence defaults to neutral`,
    totalMinutes(a) === totalMinutes(b) && a.sessions.length === b.sessions.length,
    `${totalMinutes(a)} vs ${totalMinutes(b)}`,
  );
}

// ===========================================================================
section('4. Chapter weight and estMinutes drive allocation');
// ===========================================================================
for (const [cls, grp] of COMBOS) {
  const profile = mkProfile(cls, grp, 240, 400);
  const plan = generatePlan(profile);
  const subjects = subjectsForProfile(cls, grp);
  const tag = `${cls}/${grp}`;

  // Only examined chapters (weight >= 2) are revised.
  const revisedIds = new Set(plan.sessions.filter((s) => s.kind === 'revise').map((s) => s.chapterId));
  const lowWeightRevised = subjects.flatMap((s) =>
    s.chapters[cls].filter((c) => c.weight < 2 && revisedIds.has(c.id)).map((c) => c.id),
  );
  check(`${tag}: weight<2 chapters are never revised`, lowWeightRevised.length === 0, lowWeightRevised.join(','));

  // Within a subject's first revision cycle, heaviest chapters come first.
  let orderOk = 0;
  let orderBad = 0;
  for (const subject of subjects) {
    const rev = plan.sessions.filter((s) => s.kind === 'revise' && s.subjectId === subject.id);
    if (rev.length < 2) continue;
    const weightOf = new Map(subject.chapters[cls].map((c) => [c.id, c.weight]));
    const maxW = Math.max(...[...weightOf.values()].filter((w) => w >= 2));
    const minW = Math.min(...[...weightOf.values()].filter((w) => w >= 2));
    if (maxW === minW) continue;
    const firstMax = rev.findIndex((s) => weightOf.get(s.chapterId) === maxW);
    const firstMin = rev.findIndex((s) => weightOf.get(s.chapterId) === minW);
    if (firstMax >= 0 && firstMin >= 0 && firstMax < firstMin) orderOk += 1;
    else orderBad += 1;
  }
  check(`${tag}: revision visits heaviest chapters first`, orderBad === 0, `${orderBad} bad / ${orderOk} ok`);

  // A bigger estMinutes must earn more first-pass minutes within the same
  // subject (same confidence factor, same compression scale). Tolerance covers
  // fillDays folding a sub-SESSION_MIN remainder into the next queued block,
  // which can belong to the neighbouring chapter.
  let estBad = 0;
  let worstDrift = 0;
  for (const subject of subjects) {
    const mins = new Map<string, number>();
    for (const s of plan.sessions) {
      if (s.kind !== 'study' || s.subjectId !== subject.id) continue;
      mins.set(s.chapterId, (mins.get(s.chapterId) ?? 0) + s.minutes);
    }
    const chapters = subject.chapters[cls].filter((c) => c.weight >= 2 && mins.has(c.id));
    for (const a of chapters) {
      for (const b of chapters) {
        if (a.estMinutes <= b.estMinutes) continue;
        const drift = (mins.get(b.id) ?? 0) - (mins.get(a.id) ?? 0);
        if (drift > 0) worstDrift = Math.max(worstDrift, drift);
        if (drift > SESSION_MIN) estBad += 1;
      }
    }
  }
  check(
    `${tag}: larger estMinutes earns more first-pass time`,
    estBad === 0,
    `${estBad} inversions, worst drift ${worstDrift}m`,
  );
}

// riskChapters must only ever surface heavy chapters.
for (const [cls, grp] of COMBOS) {
  const profile = mkProfile(cls, grp, 180, 225);
  const plan = generatePlan(profile);
  const r = computeReadiness(profile, plan, []);
  check(
    `${cls}/${grp}: riskChapters are all weight>=4`,
    r.riskChapters.every((c) => c.weight >= 4),
    r.riskChapters.map((c) => c.weight).join(','),
  );
  check(`${cls}/${grp}: readiness starts at 0 with no work done`, r.overall === 0, `${r.overall}`);
}

// ===========================================================================
section('5. Coverage and phase ordering');
// ===========================================================================
for (const [cls, grp] of COMBOS) {
  for (const runway of [400, 225, 60]) {
    const profile = mkProfile(cls, grp, 180, runway);
    const plan = generatePlan(profile);
    const tag = `${cls}/${grp}/${runway}d`;
    const subjects = subjectsForProfile(cls, grp);

    const examined = subjects.flatMap((s) => s.chapters[cls].filter((c) => c.weight >= 2).map((c) => c.id));
    const studied = new Set(plan.sessions.filter((s) => s.kind === 'study').map((s) => s.chapterId));
    const missing = examined.filter((id) => !studied.has(id));
    check(`${tag}: every examined chapter gets a first pass`, missing.length === 0, `${missing.length} missing`);

    const lastStudy = plan.sessions.filter((s) => s.kind === 'study').map((s) => s.date).sort().pop();
    const firstPractice = plan.sessions.filter((s) => s.kind === 'practice').map((s) => s.date).sort()[0];
    check(`${tag}: practice phase exists`, firstPractice !== undefined);
    check(
      `${tag}: first pass completes before practice begins`,
      !lastStudy || !firstPractice || lastStudy < firstPractice,
      `study ends ${lastStudy}, practice starts ${firstPractice}`,
    );

    const practiceDays = byDate(plan);
    let practiceUnderfilled = 0;
    for (const [, list] of practiceDays) {
      if (!list.every((s) => s.kind === 'practice')) continue;
      const mins = list.reduce((a, s) => a + s.minutes, 0);
      // Practice has no content queue to run out of, so it must tile the whole
      // daily commitment. A previous fixed block-count guard capped it at 360.
      if (mins < profile.dailyMinutes) practiceUnderfilled += 1;
    }
    check(`${tag}: practice days tile the full daily target`, practiceUnderfilled === 0, `${practiceUnderfilled} days`);
  }
}

// ===========================================================================
section('6. Crunch runway — what a student who onboards late actually gets');
// Diagnostic first, assertion second: with very little runway the engine must
// still produce something usable rather than an empty or absurd plan.
// ===========================================================================
for (const runway of [3, 7, 14, 20]) {
  for (const [cls, grp] of [COMBOS[3], COMBOS[2]] as [ClassLevel, StudyGroup][]) {
    const profile = mkProfile(cls, grp, 240, runway);
    const plan = generatePlan(profile);
    const subjects = subjectsForProfile(cls, grp);
    const examined = subjects.flatMap((s) => s.chapters[cls].filter((c) => c.weight >= 2));
    const studied = new Set(plan.sessions.filter((s) => s.kind === 'study').map((s) => s.chapterId));
    const covered = examined.filter((c) => studied.has(c.id));
    const heavy = examined.filter((c) => c.weight >= 4);
    const heavyCovered = heavy.filter((c) => studied.has(c.id));
    const tag = `${cls}/${grp}@${runway}d`;

    console.log(
      `  ${tag}: ${covered.length}/${examined.length} chapters covered, ` +
        `heavy ${heavyCovered.length}/${heavy.length}, ${plan.sessions.length} sessions`,
    );

    check(`${tag}: plan is not empty`, plan.sessions.length > 0);
    check(`${tag}: schedules something for today`, plan.sessions.some((s) => s.date === todayISO()));
    // When the engine must triage, it should protect the chapters that carry the
    // most board marks — covering a higher share of heavy chapters than of the
    // syllabus at large.
    const heavyShare = heavy.length ? heavyCovered.length / heavy.length : 1;
    const overallShare = examined.length ? covered.length / examined.length : 1;
    check(
      `${tag}: triage favours heavy chapters`,
      heavyShare >= overallShare - 1e-9,
      `heavy ${(heavyShare * 100).toFixed(0)}% vs overall ${(overallShare * 100).toFixed(0)}%`,
    );
  }
}

// ===========================================================================
console.log(`\n${'='.repeat(70)}`);
console.log(`${pass} passed, ${fail} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail === 0 ? 0 : 1);
