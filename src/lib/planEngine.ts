import { subjectsForProfile, type Subject } from '../data/syllabus';
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
/** Revision blocks are built shorter than a first-pass block — see buildReviseQueues. */
const REVISE_BLOCK_MAX = 45;
/** Past-paper drills use the same shorter block, so a day tiles the full target. */
const PRACTICE_BLOCK_MAX = 45;

interface Block {
  subjectId: string;
  chapterId: string;
  minutes: number;
}

/**
 * Format a Date as yyyy-mm-dd in the device's OWN timezone.
 *
 * Deliberately hand-rolled instead of `toLocaleDateString('en-CA')`: Hermes
 * ships only partial Intl support, and a locale it doesn't honour would return
 * something like `27/07/2026`. Every date in this app is compared as a string,
 * so that failure mode would silently break the plan, the streak and the review
 * queue at once — on device only, where it is hardest to spot. Explicit getters
 * have no Intl dependency and cannot drift.
 */
export const localISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const addDays = (iso: string, n: number): string => {
  // Anchored at local noon so a DST shift can never move the result to an
  // adjacent day, and read back as a LOCAL date — reading it as UTC made
  // addDays(todayISO(), 0) return a different day from todayISO() itself in any
  // timezone at or beyond UTC+12.
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return localISO(d);
};

/**
 * Today's date in the DEVICE'S OWN timezone.
 *
 * `toISOString()` reports UTC, and Pakistan is UTC+5 — so between midnight and
 * 05:00 local it returns *yesterday*. A student revising at 1 AM had the work
 * credited to the previous day, the exam countdown read a day long, and a card
 * scheduled "tomorrow" came due the same night. Formatting the local date
 * directly removes the skew for every timezone, not just PKT.
 *
 * See localISO for why this is hand-rolled rather than locale-formatted.
 */
export const todayISO = (): string => localISO(new Date());

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
  /**
   * Longest block this queue's content may be emitted as. Must match the cap the
   * queue was built with, because the remainder-merge below can otherwise grow a
   * block past it — measured at 78 minutes for a 60-minute cap before this
   * existed.
   */
  blockCap: number = SESSION_MAX,
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
            const merged = queue[0].minutes + rest;
            if (merged > blockCap && merged >= 2 * SESSION_MIN) {
              // Merging wholesale would produce a block longer than a focused
              // session — 60 + 19 = 79 minutes in the worst measured case, which
              // contradicts SESSION_MAX and the focus timer's design. Re-split
              // into two real blocks so content is still never dropped and no
              // stub is created.
              const first = Math.ceil(merged / 2);
              queue.splice(
                0,
                1,
                { ...queue[0], minutes: first },
                { ...queue[0], minutes: merged - first },
              );
            } else {
              queue[0] = { ...queue[0], minutes: merged };
            }
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
  // Never plan past the exam. The old `max(..., 3)` floor guaranteed three days
  // of sessions even when only one remained, so a student who onboarded the day
  // before their first paper got work scheduled *after* it had already started.
  const totalDays = Math.max(daysUntil(profile.examDate) - 1, 1);
  const capacity = Math.max(profile.dailyMinutes, 45);

  // ---- Build the study queues (first pass over every examined chapter).
  const studyQueues = new Map<string, Block[]>();
  const chapterMinutes = computeChapterMinutes(profile);
  let neededStudy = 0;
  for (const minutes of chapterMinutes.values()) neededStudy += minutes;

  // Phase boundaries.
  const studyDaysTarget = Math.max(Math.round(totalDays * 0.62), 1);
  const practiceDays = Math.min(Math.max(Math.round(totalDays * 0.12), 2), 14);
  // At least one day of first-pass study always survives: on a 1-2 day runway the
  // practice window would otherwise swallow the whole plan (a negative
  // practiceStart), leaving a student with drills for chapters they never read
  // and a readiness score permanently stuck at zero.
  const practiceStart = Math.max(totalDays - practiceDays, 1);

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

  /**
   * Will the compressed first pass actually fit in the study window?
   *
   * `scale` alone can't answer this: splitBlocks floors every chapter at
   * SESSION_MIN, so on a very short runway 95 chapters cost 95 * 20 minutes no
   * matter how small `scale` gets. When the real total overruns the window,
   * fillDays simply stops at practiceStart and the leftover chapters are never
   * studied at all.
   *
   * That truncation is unavoidable for a student who onboards days before the
   * exam — but WHICH chapters get dropped is a choice. In syllabus order it
   * silently favours chapter 1 of the first subjects; measured at a 3-day
   * runway, only 3 of 32 heavy chapters survived while low-weight early
   * chapters did. Under triage the order flips to heaviest-first so the
   * chapters carrying the most board marks are the ones that make the cut.
   * Full-runway plans keep textbook order, which matters for subjects that
   * genuinely build on earlier chapters.
   */
  let queuedTotal = 0;
  for (const base of chapterMinutes.values()) {
    queuedTotal += Math.max(Math.round(base * scale), SESSION_MIN);
  }
  const mustTriage = queuedTotal > practiceStart * capacity;

  for (const subject of subjects) {
    const queue: Block[] = [];
    const chapters = mustTriage
      ? [...subject.chapters[profile.classLevel]].sort(
          (a, b) => b.weight - a.weight || a.no - b.no,
        )
      : subject.chapters[profile.classLevel];
    for (const chapter of chapters) {
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
  const afterStudy = fillDays(
    sessions,
    studyQueues,
    'study',
    0,
    practiceStart,
    studyDailyLoad,
    todayISO(),
    blockMax,
  );

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
      todayISO(),
      REVISE_BLOCK_MAX,
    );
    if (sessions.length === before) break; // nothing schedulable — avoid spinning
  }

  // ---- Practice phase: board-style drilling, rotating subjects daily.
  //
  // Unlike the first pass, practice does not have a content queue to exhaust.
  // Tile the student's whole capacity with real focused blocks. A previous
  // fixed eight-block guard silently capped this phase at 360 minutes, so a
  // 7-hour plan promised 420 minutes but scheduled only 360.
  const practiceBlocks = splitBlocks(capacity, PRACTICE_BLOCK_MAX);
  // Fall back to weight>=2 and then to every chapter, so a syllabus edit that
  // leaves a group without any heavy chapter degrades to a thinner practice
  // phase instead of dividing by a zero-length array and crashing the screen.
  const drillable = (subject: Subject, min: number) =>
    subject.chapters[profile.classLevel].filter((c) => c.weight >= min);
  const practiceSubjects =
    subjects.filter((s) => drillable(s, 3).length > 0).length > 0
      ? subjects.filter((s) => drillable(s, 3).length > 0)
      : subjects.filter((s) => s.chapters[profile.classLevel].length > 0);

  for (let day = Math.max(practiceStart, afterStudy); day < totalDays && practiceSubjects.length > 0; day++) {
    const date = addDays(todayISO(), day);
    let i = day;
    for (let blockIndex = 0; blockIndex < practiceBlocks.length; blockIndex++) {
      const subject = practiceSubjects[i % practiceSubjects.length];
      i += 1;
      const heavy = drillable(subject, 3);
      const chapters = heavy.length > 0 ? heavy : subject.chapters[profile.classLevel];
      if (chapters.length === 0) continue;
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
export const completedOn = (s: PlanSession): string | null => {
  if (!s.done) return null;
  const at = s.doneAt;
  if (!at) return s.date;
  // `doneAt` is a UTC instant (`new Date().toISOString()`). Slicing its first 10
  // characters yields the UTC date, which is NOT the day the student experienced
  // — at UTC+5 anything done before 05:00 local reports as yesterday, so a 1 AM
  // session would not count as completed today. Parse the instant and render it
  // in local time instead.
  if (/^\d{4}-\d{2}-\d{2}$/.test(at)) return at; // already a plain local date
  const d = new Date(at);
  // A restored backup may carry anything here — backupSchema only checks that
  // doneAt is a string — so an unparseable value must fall back, not propagate.
  return Number.isNaN(d.getTime()) ? s.date : localISO(d);
};

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
  /**
   * Once the exam date is behind us the plan's premise is gone, and the two
   * exam-anchored rules invert from helpful to harmful: `examDay` collapses to 0
   * so no day is ever skipped, and the clamp pins every outstanding session onto
   * a date in the *past*. Measured result: 35 sessions permanently overdue,
   * unreachable, with Today showing "Nothing scheduled" forever.
   *
   * So when the exam has passed, drop both rules — lay the remaining work out
   * from today at normal capacity. The horizon keeps termination guaranteed
   * without pretending a past date is a deadline.
   */
  const examPassed = dayDiff(today, profile.examDate) < 0;
  const horizon = examPassed ? movable.length + 1 : examDay;
  const ordered = [...movable].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  const reflowed: PlanSession[] = [];
  let day = 0;
  let left = budgetFor(today);
  for (const session of ordered) {
    // Skip past days already spoken for by anchored drills. Bounded so this
    // always terminates even if a day has no room at all.
    while (session.minutes > left && day < horizon) {
      day += 1;
      left = budgetFor(addDays(today, day));
    }
    const date = addDays(today, day);
    reflowed.push({
      ...session,
      date: !examPassed && date > profile.examDate ? profile.examDate : date,
    });
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
      REVISE_BLOCK_MAX,
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
 * Re-spread all outstanding work at the profile's *current* daily capacity,
 * unconditionally.
 *
 * `maintainPlan` deliberately leaves an ordinary day alone — pending work today
 * means nothing is wrong. But that is exactly the state a student is in when
 * they change their study time, so maintenance would silently ignore the change
 * and leave tomorrow still holding yesterday's 420-minute days.
 *
 * The alternative the app used to take — regenerate from scratch — applies the
 * new pace correctly but throws away every completed session, resetting the
 * student's first pass and their readiness score to zero. Reflowing keeps
 * history untouched and re-lays only what is still pending, which is what
 * "I want to study more/less per day from now on" actually means.
 */
export function rebalancePlan(
  plan: StudyPlan,
  profile: StudentProfile,
  today: string = todayISO(),
): StudyPlan {
  const capacity = Math.max(profile.dailyMinutes, 45);
  const retiled = { ...plan, sessions: retilePractice(plan.sessions, capacity, today) };
  return extendRevision(reflowPlan(retiled, profile, today), profile, today);
}

/**
 * Re-tile upcoming past-paper days to a new daily capacity.
 *
 * The practice phase is the one part of the plan with no content queue behind
 * it — its block count is purely a function of capacity (`splitBlocks(capacity,
 * …)` in the generator). Because `reflowPlan` anchors future drills to their
 * generated dates and never re-budgets them, a student who dropped from 7 hours
 * to 2 was left with 420-minute drill days sitting near the exam, breaking the
 * one promise the engine makes about never exceeding the daily limit.
 *
 * Only *pending, future* drills are touched: completed ones are history, and
 * overdue ones are handled by the normal catch-up path.
 */
function retilePractice(sessions: PlanSession[], capacity: number, today: string): PlanSession[] {
  const targets = splitBlocks(capacity, PRACTICE_BLOCK_MAX);
  const byDate = new Map<string, PlanSession[]>();
  for (const s of sessions) {
    if (s.kind !== 'practice' || s.done || s.date < today) continue;
    const list = byDate.get(s.date) ?? [];
    list.push(s);
    byDate.set(s.date, list);
  }
  if (byDate.size === 0) return sessions;

  const replaced = new Set<string>();
  const added: PlanSession[] = [];
  for (const [, list] of byDate) {
    for (const s of list) replaced.add(s.id);
    // Reuse the day's existing subject/chapter rotation so variety survives;
    // cycle it when the new capacity needs more blocks than the old one had.
    targets.forEach((minutes, i) => {
      const src = list[i % list.length];
      added.push({
        ...src,
        id: i < list.length ? list[i].id : `${src.id}-r${i}`,
        minutes,
      });
    });
  }
  return [...sessions.filter((s) => !replaced.has(s.id)), ...added];
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
