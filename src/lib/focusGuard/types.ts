/**
 * Focus Guard — on-device attention tracking during a study session.
 *
 * THE DESIGN PIVOT, read this before changing anything:
 * a student revising from a physical book is looking DOWN AT THE BOOK, not at
 * the phone. The phone is a sensor propped nearby, not the study surface. So
 * "eyes on screen" is the wrong signal — it usually means scrolling. What we
 * actually measure is PRESENCE, ORIENTATION RELATIVE TO THE STUDENT'S OWN
 * BASELINE, and STABILITY.
 *
 * What this can honestly claim: "were you at your desk, facing your work, and
 * steady?" What it must never claim: that it knows whether the student was
 * comprehending. Attention is not observable through a camera; presence and
 * orientation are. Every threshold below is tuned so the system UNDER-reports
 * distraction rather than falsely accusing — see UNCERTAIN.
 *
 * Nothing here touches the camera. This module is pure so the whole state
 * machine can be replayed from synthetic traces with no device at all
 * (scripts/test-focus-guard.ts).
 */

/**
 * One observation, already reduced to numbers by the camera layer. No image
 * data ever reaches this module — by the time a sample exists, the frame has
 * been discarded.
 *
 * Angle conventions follow ML Kit exactly:
 *   pitch = headEulerAngleX, POSITIVE MEANS LOOKING UP (so a student reading a
 *           book on the desk sits at a negative pitch)
 *   yaw   = headEulerAngleY, positive means turned toward the image's right
 *   roll  = headEulerAngleZ, head tilted toward a shoulder
 */
export interface FocusSample {
  /** Milliseconds, monotonic within a session. */
  t: number;
  /** Whether a usable primary face was found this frame. */
  face: boolean;
  pitch?: number;
  yaw?: number;
  roll?: number;
  /** Minimum of the two eye-open probabilities (0..1). Only meaningful near-frontal. */
  eyeOpen?: number;
  /** Face bounding-box area as a fraction of the frame — a proxy for distance. */
  faceArea?: number;
  /** Mean frame luminance (0..1). The load-shedding detector. */
  luma?: number;
  /** ML Kit tracking id of the primary face; a change means a different person. */
  trackingId?: number;
}

/**
 * The student's own reading posture, captured at session start.
 *
 * This is the single most important anti-false-positive device in the feature.
 * Judging orientation against absolute thresholds would break for every phone
 * angle, every desk height, and every student who studies lying on a charpai or
 * sitting on the floor. Judging against THEIR baseline works for all of them.
 */
export interface FocusBaseline {
  pitch: number;
  yaw: number;
  roll: number;
  faceArea: number;
}

export type FocusState =
  /** Face present and oriented like the baseline. */
  | 'focused'
  /** Briefly looked away. Deliberately COUNTS AS FOCUS — thinking is not distraction. */
  | 'glance'
  /** Sustained deviation from the reading posture. */
  | 'distracted'
  /** No face for long enough that they have probably left. */
  | 'away'
  /** Eyes closed, still, and near-frontal enough to trust the classifier. */
  | 'drowsy'
  /**
   * The model cannot see well enough to judge — darkness, occlusion, an
   * extreme angle, a face too far away. Time in this state is EXCLUDED from
   * scoring entirely; it is never counted as distraction. When unsure, the
   * system says nothing rather than accusing the student.
   */
  | 'uncertain';

/** Instantaneous read of a single sample, before any dwell-time smoothing. */
export type FocusInstant =
  | 'aligned'
  | 'deviated'
  | 'eyes-closed'
  | 'no-face'
  | 'unreliable';

export interface FocusConfig {
  /** How long a deviation must persist before it stops being a harmless glance. */
  glanceToDistractedMs: number;
  /** How long a face may be missing before we assume the student left. */
  awayMs: number;
  /** How long a good reading posture must hold before we credit focus again. */
  returnMs: number;
  /** How long eyes must stay shut (while still and frontal) to call it drowsiness. */
  drowsyMs: number;
  /** How long an unreadable frame must persist before abstaining. */
  uncertainMs: number;

  /** Deviation from baseline, in degrees, that counts as looking away. */
  yawToleranceDeg: number;
  pitchToleranceDeg: number;
  /** Generous: resting your head on your hand is studying, not distraction. */
  rollToleranceDeg: number;

  /** Below this eye-open probability the eyes are considered shut. */
  eyeClosedThreshold: number;
  /**
   * ML Kit's eye classifier is only dependable near-frontal, and these bounds
   * are ABSOLUTE (not baseline-relative) because the classifier works in
   * absolute head pose. A student bent over a book sits outside them, which
   * means drowsiness detection simply switches itself off for that posture —
   * the correct outcome, and better than inventing a reading.
   */
  frontalYawForEyesDeg: number;
  frontalPitchForEyesDeg: number;
  /**
   * Movement (deg/sec, smoothed) above which the student is plainly awake.
   * Rocking while reciting from memory — extremely common in this syllabus —
   * lands here, which is what stops it being reported as drowsiness.
   */
  drowsyMotionCeiling: number;

  /**
   * Ambient light below which a frame with NO FACE IN IT is treated as "we
   * cannot see" rather than "they left". It never overrides a detected face —
   * see `classifyInstant`.
   *
   * Units: the camera layer normalises the ambient sensor as lux/100, so 0.04
   * is ~4 lux. Reference points: load-shedding blackout 0-1 lux, moonlight ~1,
   * a dim bulb 20-50, a normally lit room 100-300.
   *
   * This was 0.12 (~12 lux) and reported "too dark" in rooms that were plainly
   * lit — the sensor sits on the FRONT of the phone and reads the light falling
   * on it, not what the camera sees, so a student leaning over the phone or a
   * lamp behind them collapses the reading. Verified on a Samsung A55. The real
   * fix is face-wins-over-lux; this lower bound is the belt to that's braces,
   * and now only has to separate a true blackout from an empty lit room.
   */
  minLuma: number;
  /** Faces smaller than this fraction of frame are too far away to judge. */
  minFaceArea: number;

  /** Disables drowsiness detection entirely, for memorisation-heavy revision. */
  memorisationMode: boolean;
}

export const DEFAULT_FOCUS_CONFIG: FocusConfig = {
  glanceToDistractedMs: 4000,
  awayMs: 6000,
  returnMs: 1500,
  drowsyMs: 15000,
  uncertainMs: 1500,

  yawToleranceDeg: 25,
  pitchToleranceDeg: 30,
  rollToleranceDeg: 35,

  eyeClosedThreshold: 0.35,
  frontalYawForEyesDeg: 20,
  frontalPitchForEyesDeg: 25,
  drowsyMotionCeiling: 6,

  minLuma: 0.04,
  minFaceArea: 0.01,

  memorisationMode: false,
};

/** Rolling machine state. Carried between samples; never persisted. */
export interface FocusMachine {
  state: FocusState;
  /** When the current state was entered. */
  since: number;
  /** The instantaneous read we are currently accumulating dwell time for. */
  candidate: FocusInstant;
  candidateSince: number;
  /** Last sample, for motion estimation. */
  last?: FocusSample;
  /** Smoothed angular velocity, deg/sec. */
  motion: number;
  /** Timestamp of the most recent sample, so scoring knows the session length. */
  now: number;
}

/** One contiguous run of a single state — what the timeline strip renders. */
export interface FocusSegment {
  state: FocusState;
  start: number;
  end: number;
}

export interface FocusReport {
  totalMs: number;
  focusedMs: number;
  distractedMs: number;
  awayMs: number;
  drowsyMs: number;
  /** Time the system refused to judge. Always disclosed, never hidden. */
  uncertainMs: number;
  /** totalMs minus uncertainMs — the denominator the score is honest about. */
  monitoredMs: number;
  /**
   * focusedMs / monitoredMs, or null when too little was observed to say
   * anything. A null score is a legitimate outcome, not a failure.
   */
  score: number | null;
  /** Longest unbroken focused run — the attention-span estimate. */
  longestFocusMs: number;
  distractionCount: number;
  awayCount: number;
  segments: FocusSegment[];
}
