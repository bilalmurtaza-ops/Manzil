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

/** filename -> resolved local file URI. Warmed by preload, filled lazily by resolveClip. */
const resolved = new Map<string, string>();
let preloaded = false;
let audioModeSet = false;

export const isVoiceSupported = (): boolean => loadModules() !== null && VOICE_PACK_INSTALLED;

/**
 * Resolve ONE clip, caching the result.
 *
 * THE BUG THIS EXISTS TO KILL: every play path used to read straight out of
 * `resolved`, a module-level Map filled only by `preloadVoicePack()` — and the
 * only caller of that was `app/focus.tsx`. Settings never called it, so tapping
 * a voice in the picker looked up an empty Map, got `undefined`, and returned
 * SILENTLY. The picker animated as if it were playing and nothing came out.
 *
 * It appeared to fix itself at random because the Map is module state: once a
 * focus session had run with the voice enabled, previews worked for the rest of
 * that JS context, and went quiet again after a reload. Nothing is allowed to
 * depend on another screen having warmed a cache first — resolution is now
 * lazy and self-sufficient, and preload is purely an optimisation.
 */
async function resolveClip(file: string): Promise<string | null> {
  const cached = resolved.get(file);
  if (cached) return cached;

  const m = loadModules();
  if (!m || !VOICE_PACK_INSTALLED) return null;
  const moduleId = (VOICE_ASSETS as Record<string, number>)[file];
  if (moduleId === undefined) return null;

  try {
    const [asset] = await m.Asset.loadAsync(moduleId);
    const uri = asset?.localUri ?? asset?.uri;
    if (!uri) return null;
    resolved.set(file, uri);
    return uri;
  } catch {
    return null;
  }
}

/**
 * Configure the audio session once. Idempotent, and called from every entry
 * point — it used to live inside `preloadVoicePack`, so a screen that never
 * preloaded also never set the mode.
 */
async function ensureAudioMode(): Promise<void> {
  if (audioModeSet) return;
  const m = loadModules();
  if (!m) return;
  try {
    // Duck other audio rather than stopping it: students commonly study to
    // recitation or music, and killing it to say six words would be rude.
    // Respect the silent switch — a phone set to silent means silent.
    await m.setAudioModeAsync({
      playsInSilentMode: false,
      interruptionMode: 'duckOthers',
      shouldPlayInBackground: false,
    });
    audioModeSet = true;
  } catch {
    // Non-fatal: audio still plays, it just may not duck politely.
  }
}

/**
 * Resolve every clip up front so the first cue is instant — a nudge that
 * arrives two seconds late is worse than no nudge.
 *
 * Purely an optimisation now: `resolveClip` will fetch anything this missed.
 * Returns the filenames that failed, which the caller logs.
 */
export async function preloadVoicePack(): Promise<string[]> {
  const m = loadModules();
  if (!m || !VOICE_PACK_INSTALLED) return Object.keys(VOICE_ASSETS);
  await ensureAudioMode();
  if (preloaded) return [];

  const failures: string[] = [];
  await Promise.all(
    Object.keys(VOICE_ASSETS).map(async (file) => {
      if (!(await resolveClip(file))) failures.push(file);
    }),
  );

  preloaded = true;
  return failures;
}

/**
 * Everything currently making noise, so it can be silenced before anything new
 * starts.
 *
 * THE BUG THIS EXISTS TO KILL: `playFile` used to create a player, call
 * `play()`, and forget about it for six seconds. Nothing tracked the previous
 * one, so two cues arriving close together simply played on top of each other.
 * Combined with the calibration retry loop (see `camera.native.tsx`) that meant
 * three overlapping voices a second — the reported "clash of voices, absolute
 * chaos" in a dark room. One utterance at a time is now structurally enforced
 * here, INDEPENDENTLY of the cue layer, so no future caller can reintroduce it.
 */
const live = new Set<{ player: any; timer: ReturnType<typeof setTimeout> }>();

/** Stop and dispose everything currently playing. Safe to call at any time. */
export function stopSpeaking(): void {
  for (const entry of live) {
    clearTimeout(entry.timer);
    try {
      entry.player.pause?.();
    } catch {
      /* already stopped */
    }
    try {
      entry.player.remove();
    } catch {
      /* already gone */
    }
  }
  live.clear();
}

/** Players are disposed after use; holding them open keeps audio focus. */
function playFile(uri: string, holdMs = 6000): void {
  const m = loadModules();
  if (!m) return;
  try {
    const player = m.createAudioPlayer(uri);
    const entry = {
      player,
      // Plain JS clock, per the project convention for time-based logic.
      timer: setTimeout(() => {
        live.delete(entry);
        try {
          player.remove();
        } catch {
          /* already gone */
        }
      }, holdMs),
    };
    live.add(entry);
    player.play();
  } catch {
    /* a clip that will not play must never take the session down */
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
  void playCueAsync(cue, voiceId);
}

async function playCueAsync(cue: VoiceCue, voiceId: string): Promise<void> {
  if (!isVoiceSupported()) return;

  const variants = VOICE_LINES[cue.id];
  const variant = variants?.[cue.variant];
  if (!variant) return;

  // An unknown id (a restored backup from a build with a different voice list)
  // falls back rather than going silent.
  const voice = isKnownVoice(voiceId) ? voiceId : DEFAULT_VOICE_ID;
  await ensureAudioMode();
  // Resolved on demand rather than read out of the preload cache, so a cue can
  // never be silently dropped because one clip missed the preload.
  const lineUri = await resolveClip(clipFile(voice, variant.file));
  if (!lineUri) return; // missing clip -> silence, never a crash

  // Anything still speaking is cut off first. Interrupting beats overlapping:
  // the newest cue is always the most relevant, and two voices at once is
  // unintelligible rather than merely untidy.
  stopSpeaking();

  const chimeUri = await resolveClip(CHIME_FILE);
  if (chimeUri) {
    // The chime is held only until the line starts, so it cannot bleed under it.
    playFile(chimeUri, CHIME_LEAD_MS + 200);
    // The not-yet-started line is registered as live too, so a `stopSpeaking()`
    // landing during the gap cancels it. Without this the line would surface
    // after the stop — a voice that speaks after being silenced.
    const pending: { player: any; timer: ReturnType<typeof setTimeout> } = {
      player: { remove() {}, pause() {} },
      timer: setTimeout(() => {}, 0),
    };
    clearTimeout(pending.timer);
    pending.timer = setTimeout(() => {
      live.delete(pending);
      playFile(lineUri);
    }, CHIME_LEAD_MS);
    live.add(pending);
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
export async function previewVoice(voiceId: string): Promise<boolean> {
  if (!isVoiceSupported()) return false;
  const voice = isKnownVoice(voiceId) ? voiceId : DEFAULT_VOICE_ID;

  await ensureAudioMode();
  const uri = await resolveClip(clipFile(voice, PREVIEW_BASE_FILE));
  if (!uri) return false;

  // Same one-at-a-time rule as `playCue`. Tapping down the list used to stack
  // every voice on top of the last; now each tap replaces the one before it,
  // which is also what makes comparing voices actually possible.
  stopSpeaking();
  playFile(uri);
  return true;
}
