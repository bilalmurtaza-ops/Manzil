import { subjectsForProfile } from '../data/syllabus';
import type { PlanSession, StudentProfile, StudyPlan } from './types';

/**
 * Deterministic study-plan generator.
 *
 * Design: the schedule itself is pure math over the syllabus dataset —
 * chapter exam weight (from pairing schemes), student confidence, days left
 * and daily capacity. AI enriches sessions with guidance, but never decides
 * the calendar. This keeps plans instant, offline-capable and trustworthy.
 *
 * Three phases across the runway to the exam:
 *   1. Study   (~62% of days): first pass over every examined chapter,
 *      weak subjects get more minutes, load spread evenly — no empty days.
 *   2. Revise  (middle): repeated revision cycles, highest-weight and
 *      weakest chapters first, cycling as long as days allow.
 *   3. Practice (final stretch): past-paper style drilling by subject.
 */

const SESSION_MAX = 60; // minutes per focused block
const SESSION_MIN = 20;
const MAX_SUBJECTS_PER_DAY = 3;

interface Block {
  subjectId: string;
  chapterId: string;
  minutes: number;
}

const addDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export const todayISO = (): string => new Date().toISOString().slice(0, 10);

export function daysUntil(dateISO: string): number {
  const ms =
    new Date(`${dateISO}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime();
  return Math.round(ms / 86_400_000);
}

/**
 * Split minutes into blocks that each genuinely fit within [SESSION_MIN, blockMax].
 *
 * Uses ceil, not round: with round, a 100-minute chapter against a 45-minute
 * blockMax produced 2 blocks of 50 — silently exceeding the cap it was given and
 * making real sessions longer than the student's block size implies.
 */
function splitBlocks(total: number, blockMax: number = SESSION_MAX): number[] {
  const cap = Math.max(SESSION_MIN, blockMax);
  let rem = Math.max(total, SESSION_MIN);
  const out: number[] = [];
  // Emit whole-cap blocks so they tile a day exactly (a 60-minute day takes two
  // 30s). Equal-sized splitting produced 4x25 for a 100-minute chapter, leaving a
  // dead 10-minute gap at the end of every 60-minute day; folding the tail into
  // the last block instead produced oversized blocks that tiled just as badly.
  while (rem - cap >= SESSION_MIN) {
    out.push(cap);
    rem -= cap;
  }
  if (rem === cap) {
    out.push(cap);
    rem = 0;
  }
  if (rem > 0) {
    // A tail longer than one block splits into two real sessions rather than
    // becoming an over-length block.
    if (rem > cap && rem >= 2 * SESSION_MIN) {
      const half = Math.round(rem / 2);
      out.push(half, rem - half);
    } else {
      out.push(rem);
    }
  }
  return out;
}

let idCounter = 0;
const nextId = () => `s${Date.now().toString(36)}${(idCounter++).toString(36)}`;

/**
 * Fill consecutive days from `startDay` with the given blocks at roughly
 * `dailyLoad` minutes/day, rotating subjects for variety (max 3-4 per day).
 * Returns the day index after the last filled day.
 */
function fillDays(
  sessions: PlanSession[],
  queues: Map<string, Block[]>,
  kind: PlanSession['kind'],
  startDay: number,
  endDay: number,
  dailyLoad: number,
  /** Day 0. Injectable so plan maintenance can run on a simulated clock. */
  baseDate: string = todayISO(),
): number {
  let day = startDay;
  while (day < endDay) {
    const remainingTotal = [...queues.values()].reduce(
      (a, q) => a + q.reduce((x, b) => x + b.minutes, 0),
      0,
    );
    if (remainingTotal === 0) return day;

    const date = addDays(baseDate, day);
    let left = dailyLoad;
    /** How many blocks each subject already has today — drives variety. */
    const usedCount = new Map<string, number>();
    // A long day must spread over more subjects. The flat cap of 3 was tuned when
    // every day was ~90 minutes; at 240 min/day it forced 8+ consecutive blocks of
    // the same subject once the three slots were taken.
    const maxSubjectsToday = Math.max(
      MAX_SUBJECTS_PER_DAY,
      Math.min(queues.size, Math.ceil(dailyLoad / 45)),
    );

    while (left >= SESSION_MIN) {
      // Subject with the most remaining work; prefer subjects not studied today.
      // Candidates are ranked, but a block is only placed if it can be placed
      // CLEANLY — either whole, or split so that both halves are still a real
      // session. Preferring a subject whose head block fits outright keeps days
      // full without ever overflowing the budget or emitting a 5-minute stub.
      let best: string | null = null;
      let bestScore = -1;
      let bestFits = false;
      for (const [subjectId, queue] of queues) {
        if (queue.length === 0) continue;
        const times = usedCount.get(subjectId) ?? 0;
        if (times === 0 && usedCount.size >= maxSubjectsToday) continue;
        const head = queue[0].minutes;
        const fits = head <= left;
        // A split whose tail is too short to be a session is only safe when there
        // is a following block to roll that tail into. On a subject's final block
        // there isn't one, so skip it today and let another subject use the time —
        // otherwise the plan ends up with 8- and 10-minute stub sessions.
        if (!fits && head - left < SESSION_MIN && queue.length === 1) continue;
        const remaining = queue.reduce((a, b) => a + b.minutes, 0);
        // Diminishing preference per repeat. A flat 0.6 penalty was too weak: a
        // subject with far more remaining work still won every slot, stacking the
        // same subject back-to-back all day.
        const score = remaining / (1 + times * 1.5);
        // A block that fits whole always beats one that would need splitting.
        if (fits !== bestFits ? fits : score > bestScore) {
          bestScore = score;
          best = subjectId;
          bestFits = fits;
        }
      }
      if (!best) break;

      const queue = queues.get(best)!;
      const block = queue[0];
      // The day's budget is a hard ceiling, never a suggestion. The previous
      // `left + 10` tolerance plus sliver-absorption meant a student who chose
      // 60 min/day got up to 78 — measured on 101 of 224 days. Content is never
      // dropped: whatever doesn't fit stays at the head of the queue for tomorrow.
      let minutes: number;
      if (block.minutes <= left) {
        minutes = block.minutes;
        queue.shift();
      } else {
        minutes = left;
        const rest = block.minutes - minutes;
        if (rest >= SESSION_MIN) {
          queue[0] = { ...block, minutes: rest };
        } else {
          // Too small to stand alone as tomorrow's session. Roll it into the next
          // block rather than either emitting a 5-minute stub or dropping content.
          queue.shift();
          if (queue.length > 0) {
            queue[0] = { ...queue[0], minutes: queue[0].minutes + rest };
          } else {
            queue.push({ ...block, minutes: rest });
          }
        }
      }
      sessions.push({ id: nextId(), date, subjectId: best, chapterId: block.chapterId, kind, minutes, done: false });
      usedCount.set(best, (usedCount.get(best) ?? 0) + 1);
      left -= minutes;
    }
    day += 1;
  }
  return day;
}

/**
 * Per-chapter study minutes after the confidence adjustment.
 * Module-level so the revision top-up can rebuild it identically without
 * re-running the whole generator — it is a pure function of profile + syllabus.
 */
function computeChapterMinutes(profile: StudentProfile): Map<string, number> {
  const chapterMinutes = new Map<string, number>();
  for (const subject of subjectsForProfile(profile.classLevel, profile.group)) {
    const confidence = profile.confidence[subject.id] ?? 3;
    const confFactor = 1 + (3 - confidence) * 0.18; // weak subject => up to +36% time
    for (const chapter of subject.chapters[profile.classLevel]) {
      if (chapter.weight <= 1) continue;
      chapterMinutes.set(chapter.id, Math.round(chapter.estMinutes * confFactor));
    }
  }
  return chapterMinutes;
}

/**
 * One revision cycle over every examined chapter, heaviest first.
 *
 * Lifted out of `generatePlan`'s closure so `extendRevision()` can append further
 * cycles to an existing plan using the exact same shape — a student who studies
 * ahead must not get differently-built revision from one who doesn't.
 */
function buildReviseQueues(
  profile: StudentProfile,
  chapterMinutes: Map<string, number>,
): Map<string, Block[]> {
  const queues = new Map<string, Block[]>();
  for (const subject of subjectsForProfile(profile.classLevel, profile.group)) {
    const confidence = profile.confidence[subject.id] ?? 3;
    const chapters = [...subject.chapters[profile.classLevel]]
      .filter((c) => c.weight >= 2)
      .sort((a, b) => b.weight - a.weight);
    // Continuous in confidence, so every rating step actually changes the plan.
    // Was a binary `confidence <= 2 ? 0.45 : 0.3`, which made ratings 3, 4 and 5
    // produce identical revision depth for the same chapter.
    const reviseFactor = 0.25 + (5 - confidence) * 0.05; // 5→0.25 … 1→0.45
    const queue: Block[] = chapters.map((c) => ({
      subjectId: subject.id,
      chapterId: c.id,
      minutes: Math.max(
        SESSION_MIN,
        Math.min(45, Math.round((chapterMinutes.get(c.id) ?? c.estMinutes) * reviseFactor)),
      ),
    }));
    if (queue.length > 0) queues.set(subject.id, queue);
  }
  return queues;
}

export function generatePlan(profile: StudentProfile): StudyPlan {
  const subjects = subjectsForProfile(profile.classLevel, profile.group);
  const totalDays = Math.max(daysUntil(profile.examDate) - 1, 3);
  const capacity = Math.max(profile.dailyMinutes, 45);

  // ---- Build the study queues (first pass over every examined chapter).
  const studyQueues = new Map<string, Block[]>();
  const chapterMinutes = computeChapterMinutes(profile);
  let neededStudy = 0;
  for (const minutes of chapterMinutes.values()) neededStudy += minutes;

  // Phase boundaries.
  const studyDaysTarget = Math.max(Math.round(totalDays * 0.62), 1);
  const practiceDays = Math.min(Math.max(Math.round(totalDays * 0.12), 2), 14);
  const practiceStart = totalDays - practiceDays;

  // Compress content only when even a full-capacity first pass wouldn't fit in the
  // study window; otherwise keep every chapter's full estimate.
  const studyCapacity = studyDaysTarget * capacity;
  const scale = Math.min(1, studyCapacity / Math.max(neededStudy, 1));

  /**
   * The student's stated daily time IS the daily target — it is not throttled.
   *
   * This used to be `min(capacity, neededStudy*scale / studyDaysTarget)`, which on
   * a roomy runway collapsed to neededStudy/studyDaysTarget (~90 min for class 10)
   * *independently of capacity*. High-capacity students got a byte-identical
   * 90-minute study phase for the first ~138 days. Daily time now
   * decides how fast the first pass completes, and therefore how many revision
   * cycles fit afterwards — which is what the onboarding copy promises.
   */
  const studyDailyLoad = capacity;

  /**
   * Two blocks per day minimum so subjects still interleave, but capped at
   * SESSION_MAX so session COUNT grows with available time rather than session
   * length. The old `floor(load/2)` with no upper clamp pinned every student at
   * exactly 2 sessions/day no matter how much time they had.
   */
  const blockMax = Math.min(SESSION_MAX, Math.max(SESSION_MIN, Math.floor(studyDailyLoad / 2)));

  for (const subject of subjects) {
    const queue: Block[] = [];
    for (const chapter of subject.chapters[profile.classLevel]) {
      const base = chapterMinutes.get(chapter.id);
      if (!base) continue;
      const minutes = Math.round(base * scale);
      for (const m of splitBlocks(minutes, blockMax)) {
        queue.push({ subjectId: subject.id, chapterId: chapter.id, minutes: m });
      }
    }
    if (queue.length > 0) studyQueues.set(subject.id, queue);
  }

  const sessions: PlanSession[] = [];
  const afterStudy = fillDays(sessions, studyQueues, 'study', 0, practiceStart, studyDailyLoad);

  // Revision repeats until the practice phase starts. The old hard `cycles < 6`
  // cap was safe only because the study pass was throttled to ~90 min/day and so
  // consumed most of the runway; now that a high-capacity student finishes the
  // first pass early, capping cycles would leave a long stretch of empty days.
  // The no-progress guard (not a fixed count) is what makes this terminate.
  let cursor = afterStudy;
  while (cursor < practiceStart) {
    const before = sessions.length;
    cursor = fillDays(
      sessions,
      buildReviseQueues(profile, chapterMinutes),
      'revise',
      cursor,
      practiceStart,
      capacity,
    );
    if (sessions.length === before) break; // nothing schedulable — avoid spinning
  }

  // ---- Practice phase: board-style drilling, rotating subjects daily.
  //
  // Unlike the first pass, practice does not have a content queue to exhaust.
  // Tile the student's whole capacity with real focused blocks. A previous
  // fixed eight-block guard silently capped this phase at 360 minutes, so a
  // 7-hour plan promised 420 minutes but scheduled only 360.
  const practiceBlocks = splitBlocks(capacity, 45);
  const practiceSubjects = subjects.filter((subject) =>
    subject.chapters[profile.classLevel].some((chapter) => chapter.weight >= 3),
  );
  for (let day = Math.max(practiceStart, afterStudy); day < totalDays; day++) {
    const date = addDays(todayISO(), day);
    let i = day;
    for (let blockIndex = 0; blockIndex < practiceBlocks.length; blockIndex++) {
      const subject = practiceSubjects[i % practiceSubjects.length];
      i += 1;
      const chapters = subject.chapters[profile.classLevel].filter((c) => c.weight >= 3);
      const chapter = chapters[(day + blockIndex + 1) % chapters.length];
      sessions.push({
        id: nextId(),
        date,
        subjectId: subject.id,
        chapterId: chapter.id,
        kind: 'practice',
        minutes: practiceBlocks[blockIndex],
        done: false,
      });
    }
  }

  return { generatedAt: new Date().toISOString(), examDate: profile.examDate, sessions };
}

// ---------------------------------------------------------------------------
// Plan maintenance: catching up when behind, and continuing when ahead.
// ---------------------------------------------------------------------------

/** Whole days between two ISO dates (negative if `to` is earlier). */
const dayDiff = (fromISO: string, toISO: string): number =>
  Math.round(
    (new Date(`${toISO}T00:00:00`).getTime() - new Date(`${fromISO}T00:00:00`).getTime()) /
      86_400_000,
  );

/**
 * The date a session was actually completed on, or null if it isn't done.
 *
 * Exported and shared with the store so streak credit and plan maintenance can
 * never disagree about what "studied today" means. Keying off `date` instead
 * would deny a student any credit for lessons they pulled forward, and would
 * strip today back out of `activeDays` on a day whose own sessions were
 * completed earlier. `?? s.date` keeps older/restored sessions (done, but with
 * no `doneAt` recorded) behaving exactly as they did before.
 */
export const completedOn = (s: PlanSession): string | null =>
  s.done ? (s.doneAt?.slice(0, 10) ?? s.date) : null;

/** Most days a student may pull forward in a single day. */
export const MAX_DAYS_AHEAD = 3;

/**
 * How many future days the student has already pulled forward *today*.
 *
 * Derived from `doneAt` rather than stored, so it needs no new persisted state
 * and survives an app restart for free. A future-dated session that was
 * completed on an earlier day is not counted — that day is a hole for
 * `reflowPlan` to close, not evidence of working ahead right now.
 */
export function daysAheadUsedToday(plan: StudyPlan | null, today: string = todayISO()): number {
  if (!plan) return 0;
  const dates = new Set<string>();
  for (const s of plan.sessions) {
    if (s.date > today && completedOn(s) === today) dates.add(s.date);
  }
  return dates.size;
}

/**
 * The upcoming days a student may reveal, earliest first.
 *
 * A date qualifies while it still has unfinished work, or if it was worked on
 * today (so re-opening the app still shows what was already done ahead).
 */
export function upcomingAheadDates(
  plan: StudyPlan | null,
  today: string = todayISO(),
  limit: number = MAX_DAYS_AHEAD,
): string[] {
  if (!plan) return [];
  const dates = new Set<string>();
  for (const s of plan.sessions) {
    if (s.date <= today) continue;
    if (!s.done || completedOn(s) === today) dates.add(s.date);
  }
  return [...dates].sort().slice(0, limit);
}

/**
 * Whether the calendar should be reflowed before being shown.
 *
 *  - undone work in the past      -> yes, catch up (the original repair case)
 *  - work still pending today     -> no, an ordinary day
 *  - nothing today but something  -> no, they finished today's plan; let them
 *    was completed today             rest instead of force-feeding tomorrow
 *  - nothing today, nothing done  -> yes, this day is a hole left by working
 *    today, future work exists       ahead: continue with the next real work
 */
export function planNeedsReflow(plan: StudyPlan, today: string = todayISO()): boolean {
  const pending = plan.sessions.filter((s) => !s.done);
  if (pending.length === 0) return false;
  if (pending.some((s) => s.date < today)) return true;
  if (pending.some((s) => s.date === today)) return false;
  if (plan.sessions.some((s) => completedOn(s) === today)) return false;
  return pending.some((s) => s.date > today);
}

/**
 * Re-lay all outstanding work from `today` at the student's daily capacity.
 *
 * Completed sessions are never moved or dropped — they are history. Session
 * identity (id, subject, chapter, kind, minutes) is preserved; only `date`
 * changes. Existing order is kept, which matters: `generatePlan` already
 * interleaved subjects, so order-preserving re-packing inherits that variety.
 *
 * Future past-paper drills stay anchored where they were generated — they
 * belong in the final stretch before the exam, not pulled forward with
 * everything else. They still consume their day's budget so compacted study
 * work cannot be stacked on top and blow the daily ceiling. Overdue drills are
 * not anchored: those genuinely need catching up.
 */
export function reflowPlan(
  plan: StudyPlan,
  profile: StudentProfile,
  today: string = todayISO(),
): StudyPlan {
  const pending = plan.sessions.filter((s) => !s.done);
  if (pending.length === 0) return plan;

  const capacity = Math.max(profile.dailyMinutes, 45);
  const history = plan.sessions.filter((s) => s.done);
  const anchored = pending.filter((s) => s.kind === 'practice' && s.date >= today);
  const movable = pending.filter((s) => !(s.kind === 'practice' && s.date >= today));

  const anchoredByDate = new Map<string, number>();
  for (const s of anchored) {
    anchoredByDate.set(s.date, (anchoredByDate.get(s.date) ?? 0) + s.minutes);
  }
  const budgetFor = (date: string) => capacity - (anchoredByDate.get(date) ?? 0);

  const examDay = Math.max(dayDiff(today, profile.examDate), 0);
  const ordered = [...movable].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const reflowed: PlanSession[] = [];
  let day = 0;
  let left = budgetFor(today);
  for (const session of ordered) {
    // Skip past days already spoken for by anchored drills. Bounded by the exam
    // date so this always terminates even if a day has no room at all.
    while (session.minutes > left && day < examDay) {
      day += 1;
      left = budgetFor(addDays(today, day));
    }
    const date = addDays(today, day);
    reflowed.push({ ...session, date: date > profile.examDate ? profile.examDate : date });
    left -= session.minutes;
  }

  return { ...plan, sessions: [...history, ...reflowed, ...anchored] };
}

/**
 * Append revision cycles to fill any gap between the last outstanding piece of
 * work and the start of the past-paper phase.
 *
 * Without this, a student who consistently works ahead simply runs out: they
 * would finish the whole plan weeks early and meet the same "nothing to do"
 * dead end this feature exists to remove. Cycles are built by the same
 * `buildReviseQueues` the generator uses, and placed by the same `fillDays`, so
 * topped-up days obey the identical budget, session-floor and variety rules.
 */
export function extendRevision(
  plan: StudyPlan,
  profile: StudentProfile,
  today: string = todayISO(),
): StudyPlan {
  const capacity = Math.max(profile.dailyMinutes, 45);
  const pending = plan.sessions.filter((s) => !s.done);
  const examDay = Math.max(dayDiff(today, profile.examDate), 0);

  const practiceDays = pending
    .filter((s) => s.kind === 'practice')
    .map((s) => dayDiff(today, s.date))
    .filter((d) => d >= 0);
  const practiceStartDay = practiceDays.length > 0 ? Math.min(...practiceDays) : examDay;

  const workDays = pending
    .filter((s) => s.kind !== 'practice')
    .map((s) => dayDiff(today, s.date));
  const lastWorkDay = workDays.length > 0 ? Math.max(...workDays) : -1;

  const from = Math.max(0, lastWorkDay + 1);
  if (from >= practiceStartDay) return plan; // no gap to fill

  const chapterMinutes = computeChapterMinutes(profile);
  const sessions = [...plan.sessions];
  let cursor = from;
  while (cursor < practiceStartDay) {
    const before = sessions.length;
    cursor = fillDays(
      sessions,
      buildReviseQueues(profile, chapterMinutes),
      'revise',
      cursor,
      practiceStartDay,
      capacity,
      today,
    );
    if (sessions.length === before) break; // nothing schedulable — avoid spinning
  }
  return { ...plan, sessions };
}

/**
 * The single entry point screens should call before rendering a plan: catch up
 * if behind, continue if ahead, and never leave an idle day before the exam.
 */
export function maintainPlan(
  plan: StudyPlan,
  profile: StudentProfile,
  today: string = todayISO(),
): StudyPlan {
  const reflowed = planNeedsReflow(plan, today) ? reflowPlan(plan, profile, today) : plan;
  return extendRevision(reflowed, profile, today);
}

/**
 * Auto-repair: pull unfinished past sessions forward without guilt.
 * Kept as the narrow "only act when overdue" contract; `maintainPlan` is the
 * general entry point.
 */
export function repairPlan(plan: StudyPlan, profile: StudentProfile): StudyPlan {
  const today = todayISO();
  if (!plan.sessions.some((s) => !s.done && s.date < today)) return plan;
  return reflowPlan(plan, profile, today);
}
