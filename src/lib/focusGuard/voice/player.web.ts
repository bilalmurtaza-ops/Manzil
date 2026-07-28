import type { VoiceCue } from './cues';

/**
 * Voice playback, web stub.
 *
 * Metro resolves this for `./player` on web, keeping expo-audio out of the web
 * bundle entirely — the same pattern as `camera.web.tsx` and `backupFile.web.ts`.
 * Shapes match exactly so callers need no platform branches.
 */

export const isVoiceSupported = (): boolean => false;

export async function preloadVoicePack(): Promise<string[]> {
  return [];
}

export function playCue(_cue: VoiceCue, _voiceId?: string): void {
  /* no audio on web */
}

export function stopSpeaking(): void {
  /* nothing is playing on this platform */
}

export function previewVoice(_voiceId: string): void {
  /* no audio on this platform */
}
