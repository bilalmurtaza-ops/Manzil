import type { FocusReport, FocusSegment, FocusState } from './types';
import type { CalibrationFailure } from './calibration';
import type { VoiceCueId } from './voice/lines';

/**
 * The contract every platform implementation of the Focus Guard camera must
 * satisfy. Kept separate from the implementations so `focus.tsx` can import
 * types without Metro resolving a native module on web.
 */

export type FocusPhase =
  /** Not running — off in settings, unsupported, or denied. */
  | 'idle'
  /** Asking for the camera. */
  | 'permission'
  /** Capturing the student's reading posture. */
  | 'calibrating'
  /** Live. */
  | 'running'
  /** Ran, then gave up for a stated reason. Never fatal — the timer carries on. */
  | 'unavailable';

export interface FocusGuardStatus {
  phase: FocusPhase;
  /** Live state, for the on-screen dot. */
  state: FocusState;
  /** Why we're not running, in words a student can act on. */
  message: string | null;
  /** Live timeline, appended as the session runs. */
  segments: FocusSegment[];
  /** Present once the session ends. */
  report: FocusReport | null;
  /** True while the student is away — the timer should pause. */
  away: boolean;
  /** Increments each time a gentle nudge is warranted. */
  nudge: number;
  /**
   * The line to speak, or null for silence.
   *
   * `token` changes only when a new cue should fire, so the screen can play on
   * a token change rather than the hook firing audio from inside the sample
   * pump. Keeps the trigger declarative and testable.
   */
  voiceCue: { id: VoiceCueId; variant: number; token: number } | null;
  /** Why calibration gave up, when it did. Drives the spoken failure line. */
  calibrationFailure: CalibrationFailure | null;
  /**
   * Start calibration over after a failure.
   *
   * Exists because calibration failure is now TERMINAL rather than
   * self-retrying. It used to re-run on every frame while the baseline stayed
   * null, which re-fired the spoken failure line ~3x a second — the overlapping
   * "chaos" reported from a dark room. Recovery is now an explicit, student-
   * initiated act: turn a light on, move the phone, then tap once.
   */
  retryCalibration: () => void;
}

export interface FocusGuardApi {
  /**
   * Whether this build can run Focus Guard at all. False on web, and false on a
   * native build whose dev client predates the camera modules — checked at
   * runtime so an older APK degrades instead of white-screening.
   */
  isSupported: () => boolean;
  /** Reason a calibration attempt failed, for the settings screen preview. */
  lastCalibrationFailure?: CalibrationFailure | null;
}
