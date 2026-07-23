import type { Flashcard } from './types';

/**
 * FSRS-lite: a compact spaced-repetition scheduler inspired by FSRS.
 * Stability (in days) grows multiplicatively with successful recalls and
 * collapses on lapses; the next due date is `today + stability`.
 * Runs fully offline — no server, no account.
 */

export type Rating = 'again' | 'hard' | 'good' | 'easy';

const MULTIPLIER: Record<Rating, number> = {
  again: 0.4,
  hard: 1.2,
  good: 2.3,
  easy: 3.6,
};

const MAX_INTERVAL_DAYS = 60;

const addDaysISO = (days: number): string => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

export function reviewCard(card: Flashcard, rating: Rating): Flashcard {
  const stability =
    rating === 'again'
      ? Math.max(0.5, card.stability * MULTIPLIER.again)
      : Math.max(1, card.stability * MULTIPLIER[rating]);

  const interval = Math.min(Math.max(Math.round(stability), rating === 'again' ? 0 : 1), MAX_INTERVAL_DAYS);

  return {
    ...card,
    stability,
    reps: card.reps + 1,
    lapses: rating === 'again' ? card.lapses + 1 : card.lapses,
    due: addDaysISO(interval),
  };
}

export function newCard(
  partial: Pick<Flashcard, 'id' | 'subjectId' | 'front' | 'back'> & Partial<Flashcard>,
): Flashcard {
  return {
    chapterId: undefined,
    due: addDaysISO(0),
    stability: 1,
    reps: 0,
    lapses: 0,
    createdAt: new Date().toISOString(),
    ...partial,
  };
}
