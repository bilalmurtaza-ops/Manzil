/**
 * The Focus Guard voice pack — every line the app can speak, as data.
 *
 * WHY A MANIFEST RATHER THAN RUNTIME TTS: these lines never change, so calling
 * a TTS API at runtime would buy nothing and cost everything — model latency
 * plus a network round trip on mobile data, an API key shipped in the client,
 * a per-use quota, and silence during load-shedding, which is precisely the
 * condition Focus Guard exists to survive. Pre-rendered clips play in ~0 ms,
 * offline, forever, with no key.
 *
 * WHY THE TEXT LIVES HERE: `scripts/generate-voice.ts` reads this file to
 * produce the audio, so the text and the clips can never drift apart, and
 * swapping voice vendors is re-running one script — no code change anywhere.
 *
 * WHEN THE VOICE SPEAKS: only at moments the student is NOT looking at the
 * screen — aiming the phone during calibration, having walked away, or with
 * their eyes closed. Ambient states (`focused`, `glance`, `uncertain`) and
 * sustained distraction are deliberately silent: narrating them would be
 * maddening, and the distraction line is the one most likely to embarrass a
 * student sharing a room. The existing haptic still covers that case.
 */

/**
 * The five voices offered in Settings.
 *
 * Chosen from what this account can actually reach (`--list-voices`), not from
 * a docs page, and filtered hard for the job: a companion that speaks rarely
 * and gently. Every `sassy`, `hyped` and `characters_animation` voice in the
 * library was rejected — a study nudge at 1 a.m. must never sound theatrical.
 * What is left is the calm, `informative_educational` end of the catalogue,
 * spread across gender and accent so a student can pick one they will tolerate
 * hearing for months.
 */
export interface FocusVoice {
  /** Stable local id — used in filenames and stored in the profile. */
  id: string;
  /** ElevenLabs voice id, used only by the generation script. */
  elevenId: string;
  name: string;
  /** One line of character, shown under the name in Settings. */
  tagline: string;
}

export const FOCUS_VOICES: FocusVoice[] = [
  {
    id: 'alice',
    elevenId: 'Xb7hH8MSUJpSbSDYk0k2',
    name: 'Alice',
    tagline: 'Clear and encouraging · British',
  },
  {
    id: 'george',
    elevenId: 'JBFqnCBsd6RMkjVDRZzb',
    name: 'George',
    tagline: 'Warm and unhurried · British',
  },
  {
    id: 'sarah',
    elevenId: 'EXAVITQu4vr4xnSDxMaL',
    name: 'Sarah',
    tagline: 'Steady and reassuring · American',
  },
  {
    id: 'brian',
    elevenId: 'nPczCjzI2devNBz1zQrb',
    name: 'Brian',
    tagline: 'Deep and comforting · American',
  },
  {
    id: 'river',
    elevenId: 'SAz9YHcvj6GT2YYXdXww',
    name: 'River',
    tagline: 'Calm and even · Neutral',
  },
];

/** Alice leads: "clear educator" is the closest match to Ustaad's own persona. */
export const DEFAULT_VOICE_ID = 'alice';

export const isKnownVoice = (id: string): boolean => FOCUS_VOICES.some((v) => v.id === id);

/**
 * Per-voice filename. Flat rather than nested so the generated asset table
 * stays one literal require per line — see `assets.ts`.
 */
export const clipFile = (voiceId: string, baseFile: string): string => `${voiceId}-${baseFile}`;

export type VoiceCueId =
  | 'calibration-start'
  | 'calibration-ok'
  | 'calibration-too-dark'
  | 'calibration-no-face'
  | 'calibration-too-far'
  | 'calibration-too-restless'
  | 'away'
  | 'return'
  | 'drowsy';

export interface VoiceVariant {
  /** Filename inside assets/voice/. Also the key into the generated asset map. */
  file: string;
  /** Exact text handed to the TTS vendor. Editing this means regenerating. */
  text: string;
}

/**
 * Repeating cues carry several variants, picked at random and never twice in a
 * row. Hearing one identical line for the fifth time is what makes a voice feel
 * cheap — and pre-rendering makes variety *easier* than runtime TTS, not harder.
 *
 * The calibration-failure copy is deliberately identical to `CALIBRATION_HELP`
 * in `../calibration.ts`, so the student hears exactly what they read.
 */
export const VOICE_LINES: Record<VoiceCueId, VoiceVariant[]> = {
  'calibration-start': [
    {
      file: 'calibration-start-1.mp3',
      text: "Settle into your reading position. I'll take a look for five seconds.",
    },
  ],
  'calibration-ok': [
    {
      file: 'calibration-ok-1.mp3',
      text: "Got it. I'll keep an eye out — study well.",
    },
  ],

  'calibration-too-dark': [
    {
      file: 'calibration-too-dark-1.mp3',
      text: "It's too dark for the camera to see you. Focus Guard is off for this session.",
    },
  ],
  'calibration-no-face': [
    {
      file: 'calibration-no-face-1.mp3',
      text: "I couldn't find your face. Try propping the phone so it faces you.",
    },
  ],
  'calibration-too-far': [
    {
      file: 'calibration-too-far-1.mp3',
      text: 'The phone is a bit far away. Move it closer, or carry on without Focus Guard.',
    },
  ],
  'calibration-too-restless': [
    {
      file: 'calibration-too-restless-1.mp3',
      text: 'Settle into your reading position first, then start the session.',
    },
  ],

  // Spoken as the student leaves — they are walking away from the screen, which
  // is exactly why text would not reach them.
  away: [
    { file: 'away-1.mp3', text: "Timer paused. Come back whenever you're ready." },
    { file: 'away-2.mp3', text: "I've paused the clock for you." },
    { file: 'away-3.mp3', text: "Taking a break? The timer is waiting." },
    { file: 'away-4.mp3', text: 'Paused. No rush — come back when you can.' },
  ],

  return: [
    { file: 'return-1.mp3', text: 'Welcome back. Picking up where you left off.' },
    { file: 'return-2.mp3', text: 'Good — the clock is running again.' },
    { file: 'return-3.mp3', text: "Back to it. You've got this." },
    { file: 'return-4.mp3', text: 'Timer is going again. Keep it steady.' },
  ],

  // Never scolding: a tired student needs a break, not a telling-off.
  drowsy: [
    { file: 'drowsy-1.mp3', text: 'Eyes getting heavy? Stand up and stretch for a minute.' },
    {
      file: 'drowsy-2.mp3',
      text: 'You look tired. A short break will do more good than pushing on.',
    },
    { file: 'drowsy-3.mp3', text: 'Take a minute — stretch, get some water, then come back.' },
  ],
};

/**
 * A short two-tone earcon played before every line so a voice never starts
 * abruptly. Synthesised as a plain WAV by the generation script — no vendor, no
 * licence, no download.
 */
export const CHIME_FILE = 'chime.wav';

/** Base filenames, before the voice prefix. */
export const BASE_LINE_FILES: string[] = Object.values(VOICE_LINES).flatMap((vs) =>
  vs.map((v) => v.file),
);

/**
 * Every audio file a complete pack contains: the chime once, plus every line in
 * every voice. Used by the generator and asserted against disk by the test
 * suite, so a half-generated pack fails loudly instead of going quiet in one
 * voice only.
 */
export const ALL_VOICE_FILES: string[] = [
  CHIME_FILE,
  ...FOCUS_VOICES.flatMap((v) => BASE_LINE_FILES.map((f) => clipFile(v.id, f))),
];

/** Line previewed when a student taps a voice in Settings — short and typical. */
export const PREVIEW_BASE_FILE = 'return-1.mp3';
