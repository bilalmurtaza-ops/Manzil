import {
  CHIME_FILE,
  DEFAULT_VOICE_ID,
  PREVIEW_BASE_FILE,
  VOICE_LINES,
  clipFile,
  isKnownVoice,
} from './lines';
import { VOICE_ASSETS, VOICE_PACK_INSTALLED } from './assets';
import type { VoiceCue } from './cues';

/**
 * Playback for the Focus Guard voice pack.
 *
 * THE RELEASE-BUILD TRAP THIS EXISTS TO AVOID: handing a bundled `require()`
 * straight to expo-audio plays fine in development and then fails SILENTLY in a
 * release build (expo#33665, expo#40448) — the worst possible shape of bug,
 * since it works on the dev machine and dies in the demo APK. Every clip is
 * therefore resolved through expo-asset to a real local URI first, and
 * `preload()` reports what it could not resolve instead of failing quietly.
 *
 * Native imports are lazily required inside try/catch, matching
 * `camera.native.tsx`: a dev client built before expo-audio was added must
 * degrade to a silent Focus Guard, never a white screen.
 */

let modules: { createAudioPlayer: Function; setAudioModeAsync: Function; Asset: any } | null | undefined;

function loadModules() {
  if (modules !== undefined) return modules;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audio = require('expo-audio');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const asset = require('expo-asset');
    modules =
      audio?.createAudioPlayer && asset?.Asset
        ? {
            createAudioPlayer: audio.createAudioPlayer,
            setAudioModeAsync: audio.setAudioModeAsync,
            Asset: asset.Asset,
          }
        : null;
  } catch {
    modules = null;
  }
  return modules;
}

/** filename -> resolved local file URI, filled by preload(). */
const resolved = new Map<string, string>();
let preloaded = false;

export const isVoiceSupported = (): boolean => loadModules() !== null && VOICE_PACK_INSTALLED;

/**
 * Resolve every clip to a local URI before the session starts.
 *
 * Done up front so the first cue is instant — a nudge that arrives two seconds
 * late is worse than no nudge. Returns the filenames that failed, which the
 * caller logs; a partial pack degrades to silence for the missing lines only.
 */
export async function preloadVoicePack(): Promise<string[]> {
  const m = loadModules();
  if (!m || !VOICE_PACK_INSTALLED) return Object.keys(VOICE_ASSETS);
  if (preloaded) return [];

  const failures: string[] = [];
  await Promise.all(
    Object.entries(VOICE_ASSETS).map(async ([file, moduleId]) => {
      try {
        const [asset] = await m.Asset.loadAsync(moduleId);
        const uri = asset?.localUri ?? asset?.uri;
        if (uri) resolved.set(file, uri);
        else failures.push(file);
      } catch {
        failures.push(file);
      }
    }),
  );

  try {
    // Duck other audio rather than stopping it: students commonly study to
    // recitation or music, and killing it to say six words would be rude.
    // Respect the silent switch — a phone set to silent means silent.
    await m.setAudioModeAsync({
      playsInSilentMode: false,
      interruptionMode: 'duckOthers',
      shouldPlayInBackground: false,
    });
  } catch {
    // Non-fatal: audio still plays, it just may not duck politely.
  }

  preloaded = true;
  return failures;
}

/** Players are disposed after use; holding them open keeps audio focus. */
function playFile(uri: string, onDone?: () => void): void {
  const m = loadModules();
  if (!m) return;
  try {
    const player = m.createAudioPlayer(uri);
    player.play();
    // Plain JS clock, per the project convention for time-based logic.
    setTimeout(() => {
      try {
        player.remove();
      } catch {
        /* already gone */
      }
      onDone?.();
    }, 6000);
  } catch {
    onDone?.();
  }
}

/** Gap after the chime — long enough to register, short enough not to drag. */
const CHIME_LEAD_MS = 420;

/**
 * Play a cue: soft chime, then the line.
 *
 * The chime exists so a voice never begins abruptly in a quiet room; it also
 * gives the student a fraction of a second to orient before words start.
 */
export function playCue(cue: VoiceCue, voiceId: string = DEFAULT_VOICE_ID): void {
  if (!isVoiceSupported()) return;

  const variants = VOICE_LINES[cue.id];
  const variant = variants?.[cue.variant];
  if (!variant) return;

  // An unknown id (a restored backup from a build with a different voice list)
  // falls back rather than going silent.
  const voice = isKnownVoice(voiceId) ? voiceId : DEFAULT_VOICE_ID;
  const lineUri = resolved.get(clipFile(voice, variant.file));
  if (!lineUri) return; // missing clip -> silence, never a crash

  const chimeUri = resolved.get(CHIME_FILE);
  if (chimeUri) {
    playFile(chimeUri);
    setTimeout(() => playFile(lineUri), CHIME_LEAD_MS);
  } else {
    playFile(lineUri);
  }
}

/**
 * Play one representative line in a given voice, for the Settings picker.
 *
 * No chime: the student tapped deliberately and is listening for the voice
 * itself, so an earcon would only get in the way. Because the clips are
 * bundled this is instant and works with no signal — you can audition all five
 * voices during load-shedding.
 */
export function previewVoice(voiceId: string): void {
  if (!isVoiceSupported()) return;
  const voice = isKnownVoice(voiceId) ? voiceId : DEFAULT_VOICE_ID;
  const uri = resolved.get(clipFile(voice, PREVIEW_BASE_FILE));
  if (uri) playFile(uri);
}
