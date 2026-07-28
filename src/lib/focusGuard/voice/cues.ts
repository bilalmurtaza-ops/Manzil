import type { CalibrationFailure } from '../calibration';
import type { FocusState } from '../types';
import type { FocusPhase } from '../cameraTypes';
import { VOICE_LINES, type VoiceCueId } from './lines';

/**
 * Deciding *whether* to speak, and *what*. Pure, like `stateMachine.ts`, so the
 * whole thing is testable from synthetic transitions with no audio and no
 * device.
 *
 * Two rules carry the design:
 *
 * 1. SPEAK ONLY WHERE THE SCREEN CANNOT BE READ. Calibration (they are aiming
 *    the phone), walking away, and eyes closed. Ambient states and sustained
 *    distraction stay silent — narrating them would be maddening, and a spoken
 *    "you're distracted" is the line most likely to embarrass a student sharing
 *    a room with family.
 *
 * 2. SPEAK ON TRANSITIONS, NEVER ON STATE. `away` persists for minutes; the cue
 *    fires once, on entry.
 */

export interface VoiceCue {
  id: VoiceCueId;
  /** Index into that cue's variants. */
  variant: number;
}

export interface CueMemory {
  /** Last variant played per cue, so the same one never repeats back to back. */
  lastVariant: Partial<Record<VoiceCueId, number>>;
  /**
   * When the last cue was spoken, or null if none has been.
   *
   * Explicitly nullable rather than seeded with 0: a 0 sentinel makes the
   * cooldown depend on `now` being a large absolute timestamp, so the first cue
   * of a session would be silently swallowed under any session-relative clock —
   * which is exactly the clock the rest of Focus Guard uses.
   */
  lastSpokeAt: number | null;
}

export const initCueMemory = (): CueMemory => ({ lastVariant: {}, lastSpokeAt: null });

/**
 * Matches the haptic nudge cooldown in `camera.native.tsx`. A voice must never
 * be able to interrupt more often than the silent nudge already does.
 */
export const VOICE_COOLDOWN_MS = 120_000;

/**
 * Cues that must always be heard, cooldown or not. These are instructions the
 * student is actively waiting on — suppressing them would leave someone
 * standing over their phone wondering why nothing happened.
 */
const BYPASSES_COOLDOWN = new Set<VoiceCueId>([
  'calibration-start',
  'calibration-ok',
  'calibration-too-dark',
  'calibration-no-face',
  'calibration-too-far',
  'calibration-too-restless',
]);

const FAILURE_CUE: Record<CalibrationFailure, VoiceCueId> = {
  'too-dark': 'calibration-too-dark',
  'no-face': 'calibration-no-face',
  'too-far': 'calibration-too-far',
  'too-restless': 'calibration-too-restless',
};

export interface CueInput {
  prevPhase: FocusPhase;
  phase: FocusPhase;
  prevState: FocusState;
  state: FocusState;
  /** Set when the phase just became 'unavailable' because calibration failed. */
  failure?: CalibrationFailure | null;
  now: number;
}

/**
 * The cue for this transition, or null for silence.
 *
 * Returns null far more often than not — silence is the default and speaking is
 * the exception.
 */
export function selectCue(input: CueInput): VoiceCueId | null {
  const { prevPhase, phase, prevState, state, failure } = input;

  // ---- calibration: spoken because the student is aiming the phone and
  // physically cannot read the screen while doing it.
  if (phase === 'calibrating' && prevPhase !== 'calibrating') return 'calibration-start';
  if (phase === 'running' && prevPhase === 'calibrating') return 'calibration-ok';
  if (phase === 'unavailable' && prevPhase === 'calibrating' && failure) {
    return FAILURE_CUE[failure];
  }

  // Everything below is live tracking only.
  if (phase !== 'running') return null;

  // ---- away / return, on the transition edge only
  if (state === 'away' && prevState !== 'away') return 'away';
  if (prevState === 'away' && state !== 'away') return 'return';

  // ---- drowsy
  if (state === 'drowsy' && prevState !== 'drowsy') return 'drowsy';

  // focused / glance / uncertain / distracted -> deliberately silent
  return null;
}

/**
 * Apply rate limiting and pick a variant.
 *
 * Returns the cue to play plus the updated memory, or null when suppressed.
 * Variant choice avoids the previous one for that cue, which is what stops a
 * four-line pack sounding like a one-line pack.
 */
export function nextCue(
  input: CueInput,
  memory: CueMemory,
): { cue: VoiceCue; memory: CueMemory } | null {
  const id = selectCue(input);
  if (!id) return null;

  if (
    !BYPASSES_COOLDOWN.has(id) &&
    memory.lastSpokeAt !== null &&
    input.now - memory.lastSpokeAt < VOICE_COOLDOWN_MS
  ) {
    return null;
  }

  const variants = VOICE_LINES[id];
  if (!variants || variants.length === 0) return null;

  const previous = memory.lastVariant[id];
  let variant = 0;
  if (variants.length > 1) {
    // Choose among everything except the previous pick, so a repeat is
    // impossible rather than merely unlikely.
    const choices = variants.map((_, i) => i).filter((i) => i !== previous);
    variant = choices[Math.floor(Math.random() * choices.length)];
  }

  return {
    cue: { id, variant },
    memory: {
      lastVariant: { ...memory.lastVariant, [id]: variant },
      lastSpokeAt: input.now,
    },
  };
}
