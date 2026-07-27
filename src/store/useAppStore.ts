import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { completedOn, localISO, todayISO } from '../lib/planEngine';
import type {
  ChatMessage,
  Flashcard,
  QuizAttempt,
  StudentProfile,
  StudyPlan,
} from '../lib/types';

interface AppState {
  hydrated: boolean;
  profile: StudentProfile | null;
  plan: StudyPlan | null;
  quizAttempts: QuizAttempt[];
  flashcards: Flashcard[];
  chatHistory: ChatMessage[];
  /** ISO dates (yyyy-mm-dd) on which at least one session was completed. */
  activeDays: string[];
  /** App-wide haptic feedback / vibration preference. Default: true. */
  vibrationEnabled: boolean;

  setProfile: (profile: StudentProfile) => void;
  setPlan: (plan: StudyPlan) => void;
  toggleSessionDone: (sessionId: string) => void;
  addQuizAttempt: (attempt: QuizAttempt) => void;
  addFlashcards: (cards: Flashcard[]) => void;
  updateFlashcard: (card: Flashcard) => void;
  deleteFlashcard: (cardId: string) => void;
  appendChat: (message: ChatMessage) => void;
  clearChat: () => void;
  toggleVibration: () => void;
  resetAll: () => void;
}

/**
 * The fields a cloud/file backup carries — everything persisted EXCEPT the
 * transient `hydrated` flag, which is per-launch state and must never travel
 * between devices.
 *
 * This is a compile-time tripwire, not documentation: `src/lib/backupSchema.ts`
 * builds its envelope against `BackedUpState`, so adding a field to `AppState`
 * without deciding whether it belongs in a backup makes `tsc` fail there.
 */
export type BackedUpState = Omit<
  AppState,
  | 'hydrated'
  | 'setProfile'
  | 'setPlan'
  | 'toggleSessionDone'
  | 'addQuizAttempt'
  | 'addFlashcards'
  | 'updateFlashcard'
  | 'deleteFlashcard'
  | 'appendChat'
  | 'clearChat'
  | 'toggleVibration'
  | 'resetAll'
>;

export const BACKED_UP_KEYS = [
  'profile',
  'plan',
  'quizAttempts',
  'flashcards',
  'chatHistory',
  'activeDays',
  'vibrationEnabled',
] as const satisfies readonly (keyof BackedUpState)[];

// NOTE: todayISO is imported from planEngine rather than redefined here. It used
// to be a local `toISOString().slice(0,10)`, which reports UTC and so disagreed
// with the plan engine about which day it was between midnight and 05:00 in
// Pakistan.

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hydrated: false,
      profile: null,
      plan: null,
      quizAttempts: [],
      flashcards: [],
      chatHistory: [],
      activeDays: [],
      vibrationEnabled: true,

      setProfile: (profile) => set({ profile }),
      setPlan: (plan) => set({ plan }),

      toggleSessionDone: (sessionId) =>
        set((s) => {
          if (!s.plan) return s;
          const sessions = s.plan.sessions.map((sess) =>
            sess.id === sessionId
              ? {
                  ...sess,
                  done: !sess.done,
                  doneAt: !sess.done ? new Date().toISOString() : undefined,
                }
              : sess,
          );
          // Streak credit follows when the work actually happened, not when it
          // was scheduled — see completedOn() for why. Shared with the engine so
          // the two can never drift apart.
          const today = todayISO();
          const anyDoneToday = sessions.some((x) => completedOn(x) === today);
          // A quiz also earns the day (see addQuizAttempt). Un-checking a session
          // must not revoke credit this action never granted — without this
          // check, finishing a quiz and then mis-tapping a session checkbox
          // silently erased today from the streak.
          const quizToday = s.quizAttempts.some((a) => a.date.slice(0, 10) === today);
          const activeDays =
            anyDoneToday || quizToday
              ? Array.from(new Set([...s.activeDays, today]))
              : s.activeDays.filter((d) => d !== today);
          return { plan: { ...s.plan, sessions }, activeDays };
        }),

      addQuizAttempt: (attempt) =>
        set((s) => ({
          quizAttempts: [...s.quizAttempts, attempt],
          activeDays: Array.from(new Set([...s.activeDays, todayISO()])),
        })),

      addFlashcards: (cards) => set((s) => ({ flashcards: [...s.flashcards, ...cards] })),
      updateFlashcard: (card) =>
        set((s) => ({
          flashcards: s.flashcards.map((c) => (c.id === card.id ? card : c)),
        })),
      deleteFlashcard: (cardId) =>
        set((s) => ({ flashcards: s.flashcards.filter((c) => c.id !== cardId) })),

      appendChat: (message) =>
        set((s) => ({
          // Cap history so storage stays lean on low-end phones.
          chatHistory: [...s.chatHistory, message].slice(-80),
        })),
      clearChat: () => set({ chatHistory: [] }),

      toggleVibration: () =>
        set((s) => ({
          vibrationEnabled: s.vibrationEnabled === false ? true : false,
        })),

      resetAll: () =>
        set({
          profile: null,
          plan: null,
          quizAttempts: [],
          flashcards: [],
          chatHistory: [],
          activeDays: [],
          vibrationEnabled: true,
        }),
    }),
    {
      name: 'manzil-store',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        // Mark hydration complete so the router can decide onboarding vs tabs.
        useAppStore.setState({ hydrated: true });
        void state;
      },
    },
  ),
);

/** Current streak: consecutive active days ending today or yesterday. */
export function computeStreak(activeDays: string[]): number {
  const days = new Set(activeDays);
  // Anchored at local noon so stepping back a day can never land on a DST seam,
  // and read as a local date so it agrees with the dates stored in activeDays.
  const d = new Date(`${todayISO()}T12:00:00`);
  const iso = () => localISO(d);
  // Streak survives if yesterday was active even when today isn't yet.
  if (!days.has(iso())) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(iso())) {
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
