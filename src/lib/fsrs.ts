import { localISO, todayISO } from './planEngine';
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
// A lapse resets stability to this fixed relearning value (≈ due tomorrow) rather
// than scaling the prior stability. Scaling was wrong: a mature card (stability >150
// after a handful of good/easy reps) times 0.4 still exceeds MAX_INTERVAL_DAYS, so a
// just-failed card would be rescheduled a full 60 days out instead of resurfacing soon.
const LAPSE_STABILITY = 0.5;

// Local date, not UTC: at UTC+5 a `toISOString()` slice returns yesterday for
// any review done between midnight and 05:00, so a card scheduled "tomorrow"
// would fall due the same night. Shares todayISO()'s definition of a day so the
// review queue and the study plan can never disagree about what "today" is.
const addDaysISO = (days: number): string => {
  const d = new Date(`${todayISO()}T12:00:00`);
  d.setDate(d.getDate() + days);
  return localISO(d);
};

export function reviewCard(card: Flashcard, rating: Rating): Flashcard {
  // Cap growth at the max interval so stored stability stays bounded and a lapse
  // always collapses to a short relearning step regardless of how mature the card was.
  const stability =
    rating === 'again'
      ? LAPSE_STABILITY
      : Math.min(Math.max(1, card.stability * MULTIPLIER[rating]), MAX_INTERVAL_DAYS);

  const interval = Math.min(Math.max(Math.round(stability), 1), MAX_INTERVAL_DAYS);

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
