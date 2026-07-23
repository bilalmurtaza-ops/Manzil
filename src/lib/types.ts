/** Core domain types shared across the app. */

export type ClassLevel = '9' | '10';
export type StudyGroup = 'science-bio' | 'science-cs' | 'arts';

export interface StudentProfile {
  name: string;
  classLevel: ClassLevel;
  group: StudyGroup;
  boardId: string;
  /** ISO date (yyyy-mm-dd) of first board paper. */
  examDate: string;
  /** Minutes the student can study per day. */
  dailyMinutes: number;
  /** subjectId -> self-rated confidence 1..5 */
  confidence: Record<string, number>;
  /** ISO datetime the profile was created. */
  createdAt: string;
}

/** One scheduled study session inside the generated plan. */
export interface PlanSession {
  id: string;
  /** ISO date (yyyy-mm-dd) this session is scheduled on. */
  date: string;
  subjectId: string;
  chapterId: string;
  /** 'study' = first pass, 'revise' = second pass, 'practice' = past-paper style drilling */
  kind: 'study' | 'revise' | 'practice';
  minutes: number;
  done: boolean;
  /** ISO datetime when marked done. */
  doneAt?: string;
}

export interface StudyPlan {
  generatedAt: string;
  examDate: string;
  sessions: PlanSession[];
}

/** Result of one MCQ quiz attempt. */
export interface QuizAttempt {
  id: string;
  subjectId: string;
  chapterId: string;
  date: string;
  total: number;
  correct: number;
}

export interface Flashcard {
  id: string;
  subjectId: string;
  chapterId?: string;
  front: string;
  back: string;
  /** FSRS-lite scheduling state */
  due: string; // ISO date
  stability: number;
  reps: number;
  lapses: number;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  /** Optional image attached by the user (base64 data URI is not stored; only a flag). */
  hadImage?: boolean;
  createdAt: string;
}
