import type {
  FocusBaseline,
  FocusConfig,
  FocusInstant,
  FocusMachine,
  FocusSample,
} from './types';

/**
 * The Focus Guard state machine. Pure, deterministic, device-free.
 *
 * Two rules govern everything here:
 *
 * 1. NOTHING CHANGES STATE ON A SINGLE FRAME. Every transition needs the same
 *    reading to persist for a configured dwell time. Single-frame decisions are
 *    what make attention trackers flicker and accuse people wrongly.
 *
 * 2. HYSTERESIS IS ASYMMETRIC. Leaving focus takes 4-6 seconds of evidence;
 *    returning to it takes 1.5. The system is deliberately biased toward
 *    crediting the student.
 */

/** Angular distance, tolerant of wrap-around at +/-180. */
const angleDelta = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export function initMachine(t: number): FocusMachine {
  return {
    state: 'uncertain',
    since: t,
    candidate: 'unreliable',
    candidateSince: t,
    motion: 0,
    now: t,
  };
}

/**
 * Smoothed angular velocity in degrees/second.
 *
 * Used only to gate drowsiness. A student rocking while reciting from memory —
 * routine for this syllabus — produces high motion and is therefore never
 * reported as asleep, no matter how long their eyes stay shut.
 */
function updateMotion(m: FocusMachine, s: FocusSample): number {
  const prev = m.last;
  if (!prev || !prev.face || !s.face) return m.motion * 0.5; // decay when unmeasurable
  const dt = (s.t - prev.t) / 1000;
  if (dt <= 0) return m.motion;
  const d =
    angleDelta(s.pitch ?? 0, prev.pitch ?? 0) +
    angleDelta(s.yaw ?? 0, prev.yaw ?? 0) +
    angleDelta(s.roll ?? 0, prev.roll ?? 0);
  return m.motion * 0.7 + (d / dt) * 0.3;
}

/**
 * Read a single sample, before any dwell smoothing.
 *
 * ORDER IS LOAD-BEARING. Darkness is checked before face-absence, because
 * during load-shedding the room goes black and the face vanishes — reporting
 * that as "the student walked away" would be the single most common false
 * positive this app could produce in Pakistan. Unreadable is not absent.
 */
export function classifyInstant(
  s: FocusSample,
  baseline: FocusBaseline,
  config: FocusConfig,
  motion: number,
): FocusInstant {
  // 1. Can we see anything at all?
  if (s.luma !== undefined && s.luma < config.minLuma) return 'unreliable';

  // 2. Nobody there (in a room we could otherwise see).
  if (!s.face) return 'no-face';

  // 3. Too far away for the angles to mean much.
  if (s.faceArea !== undefined && s.faceArea < config.minFaceArea) return 'unreliable';

  // 4. Detector gave us a face but no pose — occlusion (a dupatta, a hand, a
  //    steep angle). Abstain rather than guess.
  if (s.pitch === undefined || s.yaw === undefined || s.roll === undefined) return 'unreliable';

  // 5. Deviation is measured against THIS student's reading posture, never an
  //    absolute. Head-down over a book is their normal, not a distraction.
  const dPitch = angleDelta(s.pitch, baseline.pitch);
  const dYaw = angleDelta(s.yaw, baseline.yaw);
  const dRoll = angleDelta(s.roll, baseline.roll);
  if (
    dYaw > config.yawToleranceDeg ||
    dPitch > config.pitchToleranceDeg ||
    dRoll > config.rollToleranceDeg
  ) {
    return 'deviated';
  }

  // 6. Drowsiness, but only where the eye classifier can be trusted. These
  //    bounds are absolute because ML Kit's classifier works in absolute head
  //    pose — which means a student bent over a book falls outside them and
  //    drowsiness detection quietly switches itself off. That is the correct
  //    outcome: no reading is better than a fabricated one.
  if (!config.memorisationMode && s.eyeOpen !== undefined) {
    const eyesTrustworthy =
      Math.abs(s.yaw) <= config.frontalYawForEyesDeg &&
      Math.abs(s.pitch) <= config.frontalPitchForEyesDeg;
    if (
      eyesTrustworthy &&
      s.eyeOpen < config.eyeClosedThreshold &&
      motion < config.drowsyMotionCeiling
    ) {
      return 'eyes-closed';
    }
  }

  return 'aligned';
}

/**
 * Advance the machine by one sample.
 *
 * `state` only ever changes when a candidate reading has held for its dwell
 * time; otherwise the previous state persists. That persistence is deliberate:
 * a face briefly lost while the student leans over to write keeps counting as
 * focus for a full `awayMs` before we conclude they left.
 */
export function stepFocus(
  m: FocusMachine,
  s: FocusSample,
  baseline: FocusBaseline,
  config: FocusConfig,
): FocusMachine {
  const motion = updateMotion(m, s);
  const instant = classifyInstant(s, baseline, config, motion);

  // A different tracking id means a different person walked into frame. Never
  // let dwell time accumulate across two people — restart the clock.
  const personChanged =
    s.trackingId !== undefined &&
    m.last?.trackingId !== undefined &&
    s.trackingId !== m.last.trackingId;

  const candidate = instant;
  const candidateSince =
    instant !== m.candidate || personChanged ? s.t : m.candidateSince;
  const dwell = s.t - candidateSince;

  /**
   * States we must climb out of before focus is credited again. From `focused`
   * or `glance` a good posture counts immediately; from these it must hold for
   * `returnMs`, so one stray frame can't flip a distracted student back.
   */
  const recovering =
    m.state === 'away' ||
    m.state === 'distracted' ||
    m.state === 'uncertain' ||
    m.state === 'drowsy';

  let next = m.state;
  switch (instant) {
    case 'unreliable':
      if (dwell >= config.uncertainMs) next = 'uncertain';
      break;

    case 'no-face':
      // Below awayMs the previous state simply persists — the benefit of the
      // doubt for a student leaning out of frame to write.
      if (dwell >= config.awayMs) next = 'away';
      break;

    case 'deviated':
      if (dwell >= config.glanceToDistractedMs) next = 'distracted';
      else if (!recovering) next = 'glance';
      break;

    case 'eyes-closed':
      if (dwell >= config.drowsyMs) next = 'drowsy';
      else if (!recovering) next = 'focused'; // in position, just resting their eyes
      break;

    case 'aligned':
      if (!recovering || dwell >= config.returnMs) next = 'focused';
      break;
  }

  return {
    state: next,
    since: next === m.state ? m.since : s.t,
    candidate,
    candidateSince,
    last: s,
    motion,
    now: s.t,
  };
}
