/**
 * The only daily study-time commitments offered by Manzil.
 *
 * Keep this in one place so onboarding, rebalancing, and the engine regression
 * suite cannot drift into advertising different plans.
 */
export const STUDY_TIME_OPTIONS = [
  { minutes: 120, label: '2 hours', sub: 'Solid preparation' },
  { minutes: 180, label: '3 hours', sub: 'Serious push' },
  { minutes: 240, label: '4+ hours', sub: 'Exam-season mode' },
  { minutes: 360, label: '6 hours', sub: 'Full-day focused preparation' },
  { minutes: 420, label: '7 hours', sub: 'Intensive exam sprint' },
] as const;

export const STUDY_TIME_MINUTES = STUDY_TIME_OPTIONS.map((option) => option.minutes);
