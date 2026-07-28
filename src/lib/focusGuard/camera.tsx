import type { FocusGuardStatus } from './cameraTypes';
import type { UseFocusGuardOptions } from './camera.native';

/**
 * The file TypeScript resolves for `./camera`, and the fallback for any
 * platform Metro has no extension for.
 *
 * At bundle time Metro picks `camera.native.tsx` on Android/iOS and
 * `camera.web.tsx` on web, so this body should never run. It reports itself
 * unsupported rather than throwing — Focus Guard is an enhancement, and no
 * failure of it may ever interrupt a study session.
 */

export const isSupported = (): boolean => false;

export function useFocusGuard(_opts: UseFocusGuardOptions): FocusGuardStatus {
  return {
    phase: 'unavailable',
    state: 'uncertain',
    message: 'Focus Guard is not supported on this platform.',
    segments: [],
    report: null,
    away: false,
    nudge: 0,
    voiceCue: null,
    calibrationFailure: null,
    retryCalibration: () => {},
  };
}

export function FocusCameraView(_: { status: FocusGuardStatus }): null {
  return null;
}

export type { UseFocusGuardOptions } from './camera.native';
