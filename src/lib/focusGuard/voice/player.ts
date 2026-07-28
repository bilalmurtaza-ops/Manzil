import type { VoiceCue } from './cues';

/**
 * The file TypeScript resolves for `./player`, and the fallback for any
 * platform Metro has no extension for. Metro picks `player.native.ts` on
 * Android/iOS and `player.web.ts` on web, so this body should never run.
 *
 * Reports unsupported rather than throwing: the voice is an enhancement, and no
 * failure of it may interrupt a study session.
 */

export const isVoiceSupported = (): boolean => false;

export async function preloadVoicePack(): Promise<string[]> {
  return [];
}

export function playCue(_cue: VoiceCue, _voiceId?: string): void {
  /* resolved per-platform at bundle time */
}

export function stopSpeaking(): void {
  /* nothing is playing on this platform */
}

/** Returns whether a clip actually played, so the picker never animates in silence. */
export async function previewVoice(_voiceId: string): Promise<boolean> {
  return false;
}

