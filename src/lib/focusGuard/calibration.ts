import type { FocusBaseline, FocusConfig, FocusSample } from './types';

/**
 * Baseline capture: "prop your phone where it can see you, and read normally
 * for five seconds."
 *
 * Everything downstream is measured as a deviation from what this returns,
 * which is why it exists. Absolute thresholds would have to assume a phone
 * angle, a desk height and a sitting position; students here study at desks, on
 * beds, on charpais and on the floor, with the phone leaned against whatever is
 * to hand. Calibration makes all of that irrelevant.
 *
 * It can also FAIL, and failing is a feature: if we cannot get a clean read of
 * this particular student in this particular room — a dark room, a dupatta
 * across the face, a phone pointed at the ceiling — Focus Guard declines to run
 * rather than spending the session guessing. The timer is never blocked.
 */

export const CALIBRATION_MS = 5000;
/** Roughly half of a 5s window at ~3 samples/sec. */
const MIN_VALID_SAMPLES = 8;
/** If their head moved more than this while "reading normally", it isn't a baseline. */
const MAX_SPREAD_DEG = 20;

export type CalibrationResult =
  | { ok: true; baseline: FocusBaseline; samplesUsed: number }
  | { ok: false; reason: CalibrationFailure };

export type CalibrationFailure = 'too-dark' | 'no-face' | 'too-far' | 'too-restless';

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Spread that ignores the tails, so one head-turn doesn't fail an otherwise still student. */
const robustSpread = (xs: number[]): number => {
  if (xs.length < 4) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const q1 = s[Math.floor(s.length * 0.25)];
  const q3 = s[Math.floor(s.length * 0.75)];
  return q3 - q1;
};

export function calibrate(samples: FocusSample[], config: FocusConfig): CalibrationResult {
  if (samples.length === 0) return { ok: false, reason: 'no-face' };

  // Diagnose the DOMINANT reason for failure, so the student gets an
  // instruction they can act on instead of a generic shrug.
  const lit = samples.filter((s) => s.luma === undefined || s.luma >= config.minLuma);
  if (lit.length < MIN_VALID_SAMPLES) return { ok: false, reason: 'too-dark' };

  const withFace = lit.filter(
    (s) => s.face && s.pitch !== undefined && s.yaw !== undefined && s.roll !== undefined,
  );
  if (withFace.length < MIN_VALID_SAMPLES) return { ok: false, reason: 'no-face' };

  const nearEnough = withFace.filter(
    (s) => s.faceArea === undefined || s.faceArea >= config.minFaceArea,
  );
  if (nearEnough.length < MIN_VALID_SAMPLES) return { ok: false, reason: 'too-far' };

  const pitches = nearEnough.map((s) => s.pitch as number);
  const yaws = nearEnough.map((s) => s.yaw as number);
  const rolls = nearEnough.map((s) => s.roll as number);

  if (
    robustSpread(pitches) > MAX_SPREAD_DEG ||
    robustSpread(yaws) > MAX_SPREAD_DEG ||
    robustSpread(rolls) > MAX_SPREAD_DEG
  ) {
    return { ok: false, reason: 'too-restless' };
  }

  const areas = nearEnough
    .map((s) => s.faceArea)
    .filter((a): a is number => a !== undefined);

  return {
    ok: true,
    samplesUsed: nearEnough.length,
    baseline: {
      pitch: median(pitches),
      yaw: median(yaws),
      roll: median(rolls),
      faceArea: areas.length ? median(areas) : 0,
    },
  };
}

/** Copy shown to the student when calibration fails. Instructive, never blaming. */
export const CALIBRATION_HELP: Record<CalibrationFailure, string> = {
  'too-dark': "It's too dark for the camera to see you. Focus Guard is off for this session.",
  'no-face': "I couldn't find your face — try propping the phone so it faces you.",
  'too-far': 'The phone is a bit far away. Move it closer, or carry on without Focus Guard.',
  'too-restless': 'Settle into your reading position first, then start the session.',
};
