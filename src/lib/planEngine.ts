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

/** Split minutes into blocks in [SESSION_MIN, blockMax], no tiny remainders. */
function splitBlocks(total: number, blockMax: number = SESSION_MAX): number[] {
  const t = Math.max(total, SESSION_MIN);
  const count = Math.max(1, Math.round(t / blockMax));
  const each = Math.round(t / count);
  return Array.from({ length: count }, () => Math.max(SESSION_MIN, Math.min(each, 90)));
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
): number {
  let day = startDay;
  while (day < endDay) {
    const remainingTotal = [...queues.values()].reduce(
      (a, q) => a + q.reduce((x, b) => x + b.minutes, 0),
      0,
    );
    if (remainingTotal === 0) return day;

    const date = addDays(todayISO(), day);
    let left = dailyLoad;
    const used = new Set<string>();

    while (left >= SESSION_MIN) {
      // Subject with the most remaining work; prefer subjects not studied today.
      let best: string | null = null;
      let bestScore = -1;
      for (const [subjectId, queue] of queues) {
        if (queue.length === 0) continue;
        if (!used.has(subjectId) && used.size >= MAX_SUBJECTS_PER_DAY) continue;
        const remaining = queue.reduce((a, b) => a + b.minutes, 0);
        const score = remaining * (used.has(subjectId) ? 0.6 : 1);
        if (score > bestScore) {
          bestScore = score;
          best = subjectId;
        }
      }
      if (!best) break;

      const queue = queues.get(best)!;
      const block = queue[0];
      // Take the whole block when it fits (with slight overflow tolerance),
      // otherwise split it — but never leave a sub-SESSION_MIN sliver behind.
      let minutes: number;
      if (block.minutes <= left + 10) {
        minutes = block.minutes;
        queue.shift();
      } else {
        minutes = left;
        const rest = block.minutes - minutes;
        if (rest < SESSION_MIN) {
          minutes = block.minutes; // absorb the sliver into this session
          queue.shift();
        } else {
          queue[0] = { ...block, minutes: rest };
        }
      }
      sessions.push({ id: nextId(), date, subjectId: best, chapterId: block.chapterId, kind, minutes, done: false });
      used.add(best);
      left -= minutes;
    }
    day += 1;
  }
  return day;
}

export function generatePlan(profile: StudentProfile): StudyPlan {
  const subjects = subjectsForProfile(profile.classLevel, profile.group);
  const totalDays = Math.max(daysUntil(profile.examDate) - 1, 3);
  const capacity = Math.max(profile.dailyMinutes, 45);

  // ---- Build the study queues (first pass over every examined chapter).
  const studyQueues = new Map<string, Block[]>();
  const chapterMinutes = new Map<string, number>(); // chapterId -> adjusted study minutes
  let neededStudy = 0;

  for (const subject of subjects) {
    const confidence = profile.confidence[subject.id] ?? 3;
    const confFactor = 1 + (3 - confidence) * 0.18; // weak subject => up to +36% time
    for (const chapter of subject.chapters[profile.classLevel]) {
      if (chapter.weight <= 1) continue;
      const minutes = Math.round(chapter.estMinutes * confFactor);
      chapterMinutes.set(chapter.id, minutes);
      neededStudy += minutes;
    }
  }

  // Phase boundaries.
  const studyDaysTarget = Math.max(Math.round(totalDays * 0.62), 1);
  const practiceDays = Math.min(Math.max(Math.round(totalDays * 0.12), 2), 14);
  const practiceStart = totalDays - practiceDays;

  // Fit the study pass into its window: compress when tight, spread when roomy.
  const studyCapacity = studyDaysTarget * capacity;
  const scale = Math.min(1, studyCapacity / Math.max(neededStudy, 1));
  const studyDailyLoad = Math.max(
    40,
    Math.min(capacity, Math.ceil((neededStudy * scale) / studyDaysTarget)),
  );

  // Light days should still mix subjects: shrink blocks so ≥2 fit per day.
  const blockMax =
    studyDailyLoad < 2 * SESSION_MAX
      ? Math.max(30, Math.floor(studyDailyLoad / 2))
      : SESSION_MAX;

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

  // ---- Revision cycles fill the gap between study pass and practice phase.
  const buildReviseQueues = () => {
    const queues = new Map<string, Block[]>();
    for (const subject of subjects) {
      const confidence = profile.confidence[subject.id] ?? 3;
      const chapters = [...subject.chapters[profile.classLevel]]
        .filter((c) => c.weight >= 2)
        .sort((a, b) => b.weight - a.weight);
      const queue: Block[] = chapters.map((c) => ({
        subjectId: subject.id,
        chapterId: c.id,
        minutes: Math.max(
          SESSION_MIN,
          Math.min(45, Math.round((chapterMinutes.get(c.id) ?? c.estMinutes) * (confidence <= 2 ? 0.45 : 0.3))),
        ),
      }));
      if (queue.length > 0) queues.set(subject.id, queue);
    }
    return queues;
  };

  let cursor = afterStudy;
  let cycles = 0;
  while (cursor < practiceStart && cycles < 6) {
    cursor = fillDays(sessions, buildReviseQueues(), 'revise', cursor, practiceStart, capacity);
    cycles += 1;
  }

  // ---- Practice phase: board-style drilling, rotating subjects daily.
  for (let day = Math.max(practiceStart, afterStudy); day < totalDays; day++) {
    const date = addDays(todayISO(), day);
    let left = capacity;
    let i = day;
    let guard = 0;
    while (left >= SESSION_MIN && guard < 8) {
      guard += 1;
      const subject = subjects[i % subjects.length];
      i += 1;
      const chapters = subject.chapters[profile.classLevel].filter((c) => c.weight >= 3);
      if (chapters.length === 0) continue;
      const chapter = chapters[(day + guard) % chapters.length];
      const minutes = Math.min(45, left);
      sessions.push({
        id: nextId(),
        date,
        subjectId: subject.id,
        chapterId: chapter.id,
        kind: 'practice',
        minutes,
        done: false,
      });
      left -= minutes;
    }
  }

  return { generatedAt: new Date().toISOString(), examDate: profile.examDate, sessions };
}

/**
 * Auto-repair: pull unfinished past sessions forward without guilt.
 * Completed sessions stay as history; undone past sessions merge ahead of
 * future ones and everything reflows from today within daily capacity.
 */
export function repairPlan(plan: StudyPlan, profile: StudentProfile): StudyPlan {
  const today = todayISO();
  const history = plan.sessions.filter((s) => s.done);
  const pending = plan.sessions.filter((s) => !s.done);
  const overdue = pending.some((s) => s.date < today);
  if (!overdue) return plan;

  const ordered = [...pending].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const repaired: PlanSession[] = [];
  let day = 0;
  let left = profile.dailyMinutes;
  for (const session of ordered) {
    if (session.minutes > left) {
      day += 1;
      left = profile.dailyMinutes;
    }
    const date = addDays(today, day);
    const capped = date > profile.examDate ? profile.examDate : date;
    repaired.push({ ...session, date: capped });
    left -= session.minutes;
  }

  return { ...plan, sessions: [...history, ...repaired] };
}
