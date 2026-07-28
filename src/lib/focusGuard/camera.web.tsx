import type { FocusGuardStatus } from './cameraTypes';
import type { UseFocusGuardOptions } from './camera.native';

/**
 * Focus Guard, web stub.
 *
 * Metro resolves this file for `./camera` on web, which is what keeps
 * react-native-vision-camera out of the web bundle entirely — the same pattern
 * `backupFile.web.ts` uses to keep expo-file-system out of it.
 *
 * Everything is inert and the shapes match exactly, so `focus.tsx` needs no
 * platform checks: on web the feature simply reports itself unsupported and the
 * study timer behaves as it always has.
 */

export const isSupported = (): boolean => false;

export function useFocusGuard(opts: UseFocusGuardOptions): FocusGuardStatus {
  return {
    phase: opts.enabled ? 'unavailable' : 'idle',
    state: 'uncertain',
    message: opts.enabled ? 'Focus Guard needs the phone app.' : null,
    segments: [],
    report: null,
    away: false,
    nudge: 0,
    voiceCue: null,
    calibrationFailure: null,
  };
}

export function FocusCameraView(_: { status: FocusGuardStatus }): null {
  return null;
}

export type { UseFocusGuardOptions } from './camera.native';
