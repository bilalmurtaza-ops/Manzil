import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CALIBRATION_MS, calibrate, CALIBRATION_HELP, type CalibrationFailure } from './calibration';
import { buildReport, pushState } from './scoring';
import { initMachine, stepFocus } from './stateMachine';
import { initCueMemory, nextCue, type CueMemory } from './voice/cues';
import { DEFAULT_FOCUS_CONFIG } from './types';
import type { FocusBaseline, FocusConfig, FocusSample, FocusSegment, FocusState } from './types';
import type { FocusGuardStatus, FocusPhase } from './cameraTypes';

/**
 * Focus Guard, native binding.
 *
 * PRIVACY, non-negotiable: frames are consumed inside the camera pipeline and
 * never surface here. This module only ever sees the numbers ML Kit derives —
 * three angles, two eye probabilities, a bounding box and a tracking id. No
 * image is stored, written to disk, or transmitted. There is no code path in
 * this file capable of doing any of those things.
 *
 * EVERY native import below is lazy and wrapped. A development build made
 * before these packages were added must degrade to "unavailable", never crash —
 * that APK is what the app currently runs on, and a white screen mid-demo is
 * the worst outcome this feature could produce.
 */

// ---------------------------------------------------------------------------
// Lazy, failure-tolerant native module resolution.
// ---------------------------------------------------------------------------

interface NativeBits {
  Camera: React.ComponentType<Record<string, unknown>>;
  useCameraDevice: (pos: string) => unknown;
  useCameraPermission: () => {
    hasPermission: boolean;
    requestPermission: () => Promise<boolean>;
  };
  useFaceDetectorOutput: (opts: Record<string, unknown>) => unknown;
}

let nativeBits: NativeBits | null | undefined;

function loadNative(): NativeBits | null {
  if (nativeBits !== undefined) return nativeBits;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const vc = require('react-native-vision-camera');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fd = require('react-native-vision-camera-face-detector');
    if (!vc?.Camera || !fd?.useFaceDetectorOutput) {
      nativeBits = null;
    } else {
      nativeBits = {
        Camera: vc.Camera,
        useCameraDevice: vc.useCameraDevice,
        useCameraPermission: vc.useCameraPermission,
        useFaceDetectorOutput: fd.useFaceDetectorOutput,
      };
    }
  } catch {
    // Older dev client without the native modules compiled in.
    nativeBits = null;
  }
  return nativeBits;
}

export const isSupported = (): boolean => loadNative() !== null;

// ---------------------------------------------------------------------------
// Ambient light: the load-shedding detector.
// ---------------------------------------------------------------------------

/**
 * The face detector hands us faces, never pixels, so brightness has to come
 * from somewhere else. Android's ambient light sensor is exactly the right
 * instrument and costs almost nothing — far cheaper than reading frame buffers
 * in a worklet just to average them.
 *
 * Mapping: a pitch-black room during load-shedding reads under 1 lux; reading
 * by candle or an emergency LED is roughly 10-200 lux. Normalising against 100
 * lux puts the config's 0.12 threshold at ~12 lux, which separates "the power
 * is out and the camera is blind" from "dim but workable" without catching the
 * latter.
 *
 * If the device has no light sensor, luma stays undefined and the state machine
 * simply skips the darkness check — a documented degradation, not a failure.
 */
function useAmbientLuma(active: boolean): React.RefObject<number | undefined> {
  const luma = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!active) return;
    let sub: { remove: () => void } | undefined;
    let cancelled = false;
    (async () => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { LightSensor } = require('expo-sensors');
        if (!(await LightSensor.isAvailableAsync())) return;
        if (cancelled) return;
        LightSensor.setUpdateInterval(1000);
        sub = LightSensor.addListener(({ illuminance }: { illuminance: number }) => {
          luma.current = Math.max(0, Math.min(1, illuminance / 100));
        });
      } catch {
        // No sensor, or the module is missing — darkness detection stays off.
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
      luma.current = undefined;
    };
  }, [active]);
  return luma;
}

// ---------------------------------------------------------------------------
// The hook.
// ---------------------------------------------------------------------------

interface Face {
  bounds: { width: number; height: number; x: number; y: number };
  leftEyeOpenProbability?: number;
  rightEyeOpenProbability?: number;
  trackingId?: number;
  pitchAngle: number;
  rollAngle: number;
  yawAngle: number;
  frameWidth: number;
  frameHeight: number;
}

export interface UseFocusGuardOptions {
  /** Master switch — the settings toggle. */
  enabled: boolean;
  /** Pause tracking (e.g. the student paused the timer). */
  paused?: boolean;
  config?: Partial<FocusConfig>;
  /** Session finished; freeze and produce the report. */
  finished?: boolean;
  /**
   * Settings opt-in for the spoken distraction nudge. Passed down to `cues.ts`,
   * which owns the decision — this only carries the preference.
   */
  speakOnDistracted?: boolean;
}

const NUDGE_COOLDOWN_MS = 120_000;
const DISTRACTED_NUDGE_AFTER_MS = 20_000;
/** ~3 samples/sec is plenty for second-scale states and is kind to the battery. */
const SAMPLE_INTERVAL_MS = 300;

export function useFocusGuard(opts: UseFocusGuardOptions): FocusGuardStatus {
  const native = loadNative();
  const supported = native !== null;
  const active = opts.enabled && supported && !opts.finished;

  const config = useMemo<FocusConfig>(
    () => ({ ...DEFAULT_FOCUS_CONFIG, ...opts.config }),
    [opts.config],
  );

  const [phase, setPhase] = useState<FocusPhase>('idle');
  const [state, setState] = useState<FocusState>('uncertain');
  const [message, setMessage] = useState<string | null>(null);
  const [nudge, setNudge] = useState(0);
  const [report, setReport] = useState<FocusReportOrNull>(null);
  const [voiceCue, setVoiceCue] = useState<FocusGuardStatus['voiceCue']>(null);
  const [calibrationFailure, setCalibrationFailure] = useState<CalibrationFailure | null>(null);

  const cueMemory = useRef<CueMemory>(initCueMemory());
  const cueToken = useRef(0);

  /**
   * Voice fires on TRANSITIONS, never on state — `away` persists for minutes
   * and must speak once, on entry. `cues.ts` owns the decision and the rate
   * limiting; this only reports what changed.
   */
  const emitCue = useCallback(
    (
      prevPhase: FocusPhase,
      nextPhase: FocusPhase,
      prevState: FocusState,
      nextState: FocusState,
      failure: CalibrationFailure | null = null,
    ) => {
      const picked = nextCue(
        {
          prevPhase,
          phase: nextPhase,
          prevState,
          state: nextState,
          failure,
          speakOnDistracted: opts.speakOnDistracted,
          now: Date.now(),
        },
        cueMemory.current,
      );
      if (!picked) return;
      cueMemory.current = picked.memory;
      cueToken.current += 1;
      setVoiceCue({ ...picked.cue, token: cueToken.current });
    },
    [opts.speakOnDistracted],
  );

  const baseline = useRef<FocusBaseline | null>(null);
  /**
   * Calibration is a one-shot with a TERMINAL failure, tracked in a ref because
   * the sample pump is a stable callback and would read stale React state.
   *
   * The bug this fixes: on failure the baseline stayed null, so every later
   * sample re-entered the calibration branch, re-ran `calibrate()` on an
   * ever-growing buffer, and re-emitted the failure cue — which BYPASSES the
   * voice cooldown by design, being an instruction the student is waiting on.
   * At ~3 samples/sec that is three spoken lines a second, all overlapping.
   * That is the entire "clash of voices" in a dark room.
   */
  const calibration = useRef<'pending' | 'ok' | 'failed'>('pending');
  const machine = useRef(initMachine(0));
  const segments = useRef<FocusSegment[]>([]);
  const calibrationBuf = useRef<FocusSample[]>([]);
  const startedAt = useRef(0);
  const lastSampleAt = useRef(0);
  const lastNudgeAt = useRef(0);
  const distractedSince = useRef<number | null>(null);

  const luma = useAmbientLuma(active);

  /**
   * Put the machine back to a clean pre-calibration state and announce it.
   *
   * One function for both the initial start and an explicit retry, so the two
   * paths can never drift — a retry that forgot to reset `startedAt` would
   * re-fail instantly, since the 5-second window is measured from it.
   */
  const beginCalibration = useCallback(
    (from: FocusPhase) => {
      calibration.current = 'pending';
      baseline.current = null;
      calibrationBuf.current = [];
      segments.current = [];
      startedAt.current = Date.now();
      lastSampleAt.current = 0;
      distractedSince.current = null;
      machine.current = initMachine(0);
      setState('uncertain');
      setPhase('calibrating');
      setMessage(null);
      setCalibrationFailure(null);
      emitCue(from, 'calibrating', 'uncertain', 'uncertain');
    },
    [emitCue],
  );

  /**
   * Student-initiated recovery after a failed calibration. Only meaningful from
   * `unavailable`; guarded so a stray tap mid-session cannot wipe a good
   * baseline and lose the timeline collected so far.
   */
  const retryCalibration = useCallback(() => {
    if (!active || calibration.current !== 'failed') return;
    beginCalibration('unavailable');
  }, [active, beginCalibration]);

  // ---- permission -------------------------------------------------------
  const permission = native?.useCameraPermission?.() ?? {
    hasPermission: false,
    requestPermission: async () => false,
  };
  const hasPermission = permission.hasPermission;

  useEffect(() => {
    if (!opts.enabled) {
      setPhase('idle');
      setMessage(null);
      return;
    }
    if (!supported) {
      setPhase('unavailable');
      setMessage('Focus Guard needs a newer build of the app.');
      return;
    }
    if (!hasPermission) {
      setPhase('permission');
      void permission.requestPermission().then((granted) => {
        if (!granted) {
          setPhase('unavailable');
          setMessage('Focus Guard is off — camera access was declined.');
        }
      });
      return;
    }
    beginCalibration('idle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, supported, hasPermission]);

  // ---- the sample pump --------------------------------------------------
  const onFacesDetected = useCallback(
    (faces: Face[]) => {
      if (!active || opts.paused) return;
      const now = Date.now();
      // Throttle: ML Kit will happily call us at camera frame rate, which is
      // far more than second-scale states need and is what would cook a
      // low-end phone.
      if (now - lastSampleAt.current < SAMPLE_INTERVAL_MS) return;
      lastSampleAt.current = now;

      const t = now - startedAt.current;

      // Track ONE primary face — the largest, which is the student rather than
      // a sibling crossing the room behind them. Other faces are ignored
      // entirely; this feature never reports on anyone but its own user.
      let primary: Face | undefined;
      let bestArea = 0;
      for (const f of faces) {
        const area = (f.bounds.width * f.bounds.height) / Math.max(1, f.frameWidth * f.frameHeight);
        if (area > bestArea) {
          bestArea = area;
          primary = f;
        }
      }

      const eyes =
        primary &&
        primary.leftEyeOpenProbability !== undefined &&
        primary.rightEyeOpenProbability !== undefined
          ? Math.min(primary.leftEyeOpenProbability, primary.rightEyeOpenProbability)
          : undefined;

      const sample: FocusSample = primary
        ? {
            t,
            face: true,
            pitch: primary.pitchAngle,
            yaw: primary.yawAngle,
            roll: primary.rollAngle,
            eyeOpen: eyes,
            faceArea: bestArea,
            luma: luma.current,
            trackingId: primary.trackingId,
          }
        : { t, face: false, luma: luma.current };

      // ---- calibration window
      // Terminal once it has failed: no re-running, no second spoken line.
      // Recovery is `retryCalibration()`, which the student triggers.
      if (calibration.current === 'failed') return;

      if (!baseline.current) {
        calibrationBuf.current.push(sample);
        if (t >= CALIBRATION_MS) {
          const result = calibrate(calibrationBuf.current, config);
          if (result.ok) {
            calibration.current = 'ok';
            baseline.current = result.baseline;
            machine.current = initMachine(t);
            calibrationBuf.current = [];
            setPhase('running');
            setMessage(null);
            emitCue('calibrating', 'running', 'uncertain', 'uncertain');
          } else {
            // Refuse to run rather than guess. The timer is untouched.
            calibration.current = 'failed';
            // Release the buffer: it grew unbounded across the old retry loop.
            calibrationBuf.current = [];
            setPhase('unavailable');
            setMessage(CALIBRATION_HELP[result.reason]);
            setCalibrationFailure(result.reason);
            emitCue('calibrating', 'unavailable', 'uncertain', 'uncertain', result.reason);
          }
        }
        return;
      }

      // ---- live
      const prev = machine.current.state;
      machine.current = stepFocus(machine.current, sample, baseline.current, config);
      const next = machine.current.state;
      pushState(segments.current, next, t);
      setState(next);
      if (next !== prev) emitCue('running', 'running', prev, next);

      // Gentle, rate-limited nudge. Never an alarm, never more than once every
      // two minutes, and only for sustained distraction — not for glances and
      // not for being away, which the timer already handles by pausing.
      if (next === 'distracted') {
        if (distractedSince.current === null) distractedSince.current = t;
        const sustained = t - distractedSince.current;
        if (sustained >= DISTRACTED_NUDGE_AFTER_MS && now - lastNudgeAt.current >= NUDGE_COOLDOWN_MS) {
          lastNudgeAt.current = now;
          setNudge((n) => n + 1);
        }
      } else {
        distractedSince.current = null;
      }
    },
    [active, opts.paused, config, luma, emitCue],
  );

  const onError = useCallback((e: Error) => {
    // A detector failure must never take the session down.
    setPhase('unavailable');
    setMessage(`Focus Guard stopped (${e.message}).`);
  }, []);

  // ---- freeze and report on finish --------------------------------------
  useEffect(() => {
    if (!opts.finished) return;
    if (segments.current.length === 0) {
      setReport(null);
      return;
    }
    setReport(buildReport(segments.current, Date.now() - startedAt.current));
  }, [opts.finished]);

  // ---- stable callback refs for the camera view -------------------------
  // The native face detector must be created ONCE and never torn down. The
  // library's `useFaceDetectorOutput` has a `useMemo([options])` where
  // `options` is a rest-spread that creates a new object every render,
  // making the memo effectively broken. If the callbacks we pass change
  // identity, the outer `useMemo` in FocusCameraView recomputes, feeding a
  // new options object to the library, which recreates the native ML Kit
  // detector from scratch. On a low-end phone ML Kit needs time to load its
  // model; a detector that's perpetually restarting returns empty arrays and
  // the student sees "I couldn't find your face" in a well-lit room.
  //
  // Fix: route through refs so the view always passes the SAME function
  // identity. The refs themselves update in place, so the latest callback
  // logic is always used without changing any object identity.
  const onFacesRef = useRef(onFacesDetected);
  onFacesRef.current = onFacesDetected;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const stableOnFaces = useCallback((faces: Face[]) => {
    onFacesRef.current(faces);
  }, []);
  const stableOnError = useCallback((e: Error) => {
    onErrorRef.current(e);
  }, []);

  return {
    phase,
    state,
    message,
    segments: segments.current,
    report,
    away: phase === 'running' && state === 'away',
    nudge,
    voiceCue,
    calibrationFailure,
    retryCalibration,
    // Internal wiring the view component needs; not part of the public shape.
    // Stable callbacks prevent the native detector from being recreated.
    ...({ __onFacesDetected: stableOnFaces, __onError: stableOnError, __active: active } as object),
  } as FocusGuardStatus;
}

type FocusReportOrNull = ReturnType<typeof buildReport> | null;

// ---------------------------------------------------------------------------
// The camera view.
// ---------------------------------------------------------------------------

/**
 * Mounted so the camera pipeline runs, deliberately tiny and visible.
 *
 * Showing a small live preview is a privacy decision, not a design one: the
 * student can see at a glance that the camera is on and what it can see. A
 * hidden camera would work identically and feel like surveillance.
 */
export function FocusCameraView({ status }: { status: FocusGuardStatus }) {
  const native = loadNative();
  const s = status as unknown as {
    __onFacesDetected: (f: Face[]) => void;
    __onError: (e: Error) => void;
    __active: boolean;
  };

  const device = native?.useCameraDevice?.('front');

  /**
   * STABLE detector options — created ONCE, never recreated.
   *
   * THE BUG THIS FIXES: the library's `useFaceDetectorOutput` has a
   * `useMemo([options])` where `options` is the rest-spread of everything
   * except `onFacesDetected`, `onError`, and `outputResolution`. That
   * rest-spread creates a new object every call, so the `useMemo` comparison
   * always fails and `createFaceDetectorOutput` is called every render —
   * destroying the previous native ML Kit detector and creating a new one.
   *
   * On a low-end Android phone (the target for this app), ML Kit needs
   * time to load its face detection model after creation. A detector that
   * keeps getting torn down and rebuilt may never finish initializing,
   * returning empty face arrays indefinitely. The student sees "I couldn't
   * find your face" in a perfectly lit room.
   *
   * Fix: `s.__onFacesDetected` and `s.__onError` are now STABLE refs from
   * `useFocusGuard` (they never change identity), so this `useMemo` fires
   * exactly once — the dependency array is empty. The native detector is
   * created once and lives for the entire session.
   */
  const detectorOptions = useMemo(
    () => ({
      performanceMode: 'accurate' as const,
      runClassifications: true,
      runLandmarks: false,
      runContours: false,
      trackingEnabled: true,
      /**
       * Smallest face width ML Kit will look for, as a fraction of frame
       * width. 0.08 sits below sqrt(minFaceArea) = 0.1 with margin, keeping
       * the native hint looser than the JS threshold so the JS "too-far"
       * branch can always fire its more informative message. See types.ts
       * for the cross-file invariant.
       */
      minFaceSize: 0.08,
      cameraFacing: 'front' as const,
      /**
       * Use highest available camera buffer resolution instead of the
       * default 'preview'. More pixels → more reliable face detection,
       * especially at desk distance (~60cm). The sample pump already
       * throttles to 300ms, so the extra cost is fully absorbed.
       */
      outputResolution: 'full' as const,
      onFacesDetected: s.__onFacesDetected,
      onError: s.__onError,
    }),
    // Empty: all values are static literals or stable refs. The native
    // detector is created ONCE and never torn down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const output = native?.useFaceDetectorOutput?.(detectorOptions);

  if (!native || !device || !s.__active) return null;
  const Camera = native.Camera;

  return (
    <View style={styles.preview} pointerEvents="none">
      <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive
        outputs={output ? [output] : []}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  preview: {
    position: 'absolute',
    top: 8,
    right: 8,
    /**
     * Large enough for the camera hardware to select a usable resolution.
     * The old 64×84 size caused some Android devices to choose an extremely
     * low resolution, giving ML Kit too few pixels to detect faces reliably.
     * 120×160 is still small and unobtrusive, but gives the hardware a
     * strong hint to provide at least a moderate resolution.
     */
    width: 120,
    height: 160,
    borderRadius: 14,
    overflow: 'hidden',
    opacity: 0.5,
  },
});
