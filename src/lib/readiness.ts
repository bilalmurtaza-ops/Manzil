import { subjectsForProfile, type Chapter, type Subject } from '../data/syllabus';
import type { QuizAttempt, StudentProfile, StudyPlan } from './types';

/**
 * Readiness model: blends plan completion (coverage) with quiz performance
 * (mastery), both weighted by each chapter's board-exam weight from the
 * pairing scheme. Everything is computed locally and updates live.
 */

export interface ChapterReadiness {
  chapter: Chapter;
  subject: Subject;
  /** 0..1 — study sessions completed for this chapter */
  coverage: number;
  /** 0..1 or null when never quizzed */
  mastery: number | null;
  /** 0..1 combined */
  score: number;
  /** exam weight 1..5 */
  weight: number;
}

export interface SubjectReadiness {
  subject: Subject;
  score: number;
  chapters: ChapterReadiness[];
}

export interface Readiness {
  overall: number;
  gradeBand: string;
  gradeNote: string;
  subjects: SubjectReadiness[];
  /** Highest-risk chapters: heavy weight, low score. */
  riskChapters: ChapterReadiness[];
}

export function computeReadiness(
  profile: StudentProfile,
  plan: StudyPlan | null,
  attempts: QuizAttempt[],
): Readiness {
  const subjects = subjectsForProfile(profile.classLevel, profile.group);
  const subjectResults: SubjectReadiness[] = [];

  for (const subject of subjects) {
    const chapters = subject.chapters[profile.classLevel].filter((c) => c.weight >= 2);
    const chapterResults: ChapterReadiness[] = [];

    for (const chapter of chapters) {
      const sessions =
        plan?.sessions.filter(
          (s) => s.subjectId === subject.id && s.chapterId === chapter.id && s.kind !== 'practice',
        ) ?? [];
      const doneMinutes = sessions.filter((s) => s.done).reduce((a, s) => a + s.minutes, 0);
      const totalMinutes = sessions.reduce((a, s) => a + s.minutes, 0);
      const coverage = totalMinutes > 0 ? doneMinutes / totalMinutes : 0;

      const chapterAttempts = attempts.filter((a) => a.chapterId === chapter.id);
      const mastery =
        chapterAttempts.length > 0
          ? Math.max(...chapterAttempts.map((a) => a.correct / Math.max(a.total, 1)))
          : null;

      // Blend: quizzes count once they exist; otherwise coverage carries,
      // discounted so untested chapters never look fully ready.
      const score = mastery !== null ? 0.45 * coverage + 0.55 * mastery : coverage * 0.75;

      chapterResults.push({ chapter, subject, coverage, mastery, score, weight: chapter.weight });
    }

    const weightSum = chapterResults.reduce((a, c) => a + c.weight, 0) || 1;
    const score = chapterResults.reduce((a, c) => a + c.score * c.weight, 0) / weightSum;
    subjectResults.push({ subject, score, chapters: chapterResults });
  }

  const overall =
    subjectResults.length > 0
      ? subjectResults.reduce((a, s) => a + s.score, 0) / subjectResults.length
      : 0;

  const [gradeBand, gradeNote] = gradeFor(overall);

  // Global weight>=4 candidates, with a per-subject fallback to that subject's
  // own heaviest chapters — mirrors planEngine's `drillable()` cascade. Urdu and
  // Tarjuma-tul-Quran (compulsory for every student, both class levels) never
  // have a single chapter at weight>=4: their pairing schemes spread marks over
  // more chapters instead of concentrating them, so a flat global cutoff meant
  // those two subjects could never appear here at all, no matter how neglected.
  const RISK_WEIGHT_FLOOR = 4;
  const riskChapters = subjectResults
    .flatMap((s) => {
      const heavy = s.chapters.filter((c) => c.weight >= RISK_WEIGHT_FLOOR);
      if (heavy.length > 0) return heavy;
      const maxWeight = Math.max(0, ...s.chapters.map((c) => c.weight));
      return maxWeight > 0 ? s.chapters.filter((c) => c.weight === maxWeight) : [];
    })
    // Rank by MARKS AT RISK — (1 - score) x weight, descending — not by marks
    // already secured. The old key (`score * weight` ascending) was masked by
    // the `weight >= 4` filter above: once the per-subject fallback let weight-3
    // subjects into the pool, that key handed them the whole list, because a
    // low-weight chapter can never accumulate much *secured* value and so always
    // sorted first. Measured on an evenly-progressing 10/arts student: the top 6
    // became 0/6 heavy chapters, hiding General Maths, English, General Science
    // and Pak Studies behind six Tarjuma entries. Ranking by exposure instead
    // restores 5-6/6 heavy chapters while still letting Urdu or Tarjuma surface
    // when they genuinely are the most exposed.
    .sort((a, b) => (1 - b.score) * b.weight - (1 - a.score) * a.weight || b.weight - a.weight)
    .slice(0, 6);

  return { overall, gradeBand, gradeNote, subjects: subjectResults, riskChapters };
}

function gradeFor(overall: number): [string, string] {
  if (overall >= 0.85) return ['A+', 'On track for a top result — keep the edge sharp.'];
  if (overall >= 0.7) return ['A', 'Strong trajectory. Push the risk chapters to reach A+.'];
  if (overall >= 0.55) return ['B', 'Solid base. Consistency now decides your grade.'];
  if (overall >= 0.4) return ['C', 'The plan works if you work it — focus on heavy chapters.'];
  if (overall >= 0.2) return ['D', 'Early days. Every session from today moves this needle.'];
  return ['—', 'Complete sessions and quizzes to unlock your prediction.'];
}
