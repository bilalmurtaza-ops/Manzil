/**
 * Focus Guard trace suite.
 *
 * The whole point of keeping the state machine pure is this file: every
 * scenario the feature claims to handle is replayed here as a synthetic sample
 * trace, with no camera, no device and no human. "No false positives" stops
 * being a promise and becomes an assertion.
 *
 * The scenarios are drawn from how students in Pakistan actually study —
 * reading head-down from a book, reciting with eyes shut, a room going dark
 * mid-session during load-shedding, a dupatta across the face, a sibling
 * crossing the room.
 *
 * Run: npx tsx scripts/test-focus-guard.ts
 */
import {
  CALIBRATION_HELP,
  DEFAULT_FOCUS_CONFIG,
  attentionSpanMinutes,
  buildReport,
  calibrate,
  recommendedSessionMinutes,
  runTrace,
} from 'C:/Users/bilal/Desktop/app/src/lib/focusGuard';
import type {
  FocusBaseline,
  FocusConfig,
  FocusSample,
  FocusState,
} from 'C:/Users/bilal/Desktop/app/src/lib/focusGuard';
import {
  VOICE_COOLDOWN_MS,
  initCueMemory,
  nextCue,
  selectCue,
} from 'C:/Users/bilal/Desktop/app/src/lib/focusGuard/voice/cues';
import {
  ALL_VOICE_FILES,
  BASE_LINE_FILES,
  DEFAULT_VOICE_ID,
  FOCUS_VOICES,
  PREVIEW_BASE_FILE,
  VOICE_LINES,
  isKnownVoice,
} from 'C:/Users/bilal/Desktop/app/src/lib/focusGuard/voice/lines';
import type { CalibrationFailure } from 'C:/Users/bilal/Desktop/app/src/lib/focusGuard';

let pass = 0;
let fail = 0;
const failures: string[] = [];
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) pass += 1;
  else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};
const section = (t: string) => console.log(`\n=== ${t} ===`);

/**
 * Checked against DISK, not against the generated asset table: that table uses
 * Metro `require()` for .mp3, which Node cannot load. Disk is also the more
 * meaningful check — it catches a half-generated pack, where one voice would go
 * silent with no other symptom.
 */
declare function require(id: string): any;
const nodeFs: { existsSync(p: string): boolean } = require('fs');
const VOICE_DIR = 'C:/Users/bilal/Desktop/app/assets/voice';

const CFG = DEFAULT_FOCUS_CONFIG;
/** ~3 samples/sec, the rate the camera layer targets. */
const DT = 333;

/**
 * A student bent over a book on a desk: head pitched down 35 degrees, square to
 * the phone. This is the posture the naive "eyes on screen" design would have
 * called distraction for the entire session.
 */
const BOOK_BASELINE: FocusBaseline = { pitch: -35, yaw: 0, roll: 0, faceArea: 0.06 };

interface Chunk {
  seconds: number;
  sample: Omit<FocusSample, 't'> | ((i: number) => Omit<FocusSample, 't'>);
}

/** Build a trace from a list of {duration, sample} chunks. */
function trace(chunks: Chunk[], startT = 0): FocusSample[] {
  const out: FocusSample[] = [];
  let t = startT;
  for (const c of chunks) {
    const n = Math.round((c.seconds * 1000) / DT);
    for (let i = 0; i < n; i += 1) {
      const base = typeof c.sample === 'function' ? c.sample(i) : c.sample;
      out.push({ ...base, t });
      t += DT;
    }
  }
  return out;
}

/** Reading normally: aligned with the baseline, eyes open, room lit. */
const READING: Omit<FocusSample, 't'> = {
  face: true,
  pitch: -35,
  yaw: 0,
  roll: 0,
  eyeOpen: 0.9,
  faceArea: 0.06,
  luma: 0.5,
  trackingId: 1,
};

const withJitter = (base: Omit<FocusSample, 't'>, deg = 3) => (i: number) => ({
  ...base,
  pitch: (base.pitch ?? 0) + Math.sin(i * 0.7) * deg,
  yaw: (base.yaw ?? 0) + Math.cos(i * 0.5) * deg,
});

const stateAt = (states: FocusState[], samples: FocusSample[], seconds: number): FocusState => {
  const idx = Math.min(states.length - 1, Math.round((seconds * 1000) / DT));
  void samples;
  return states[idx];
};
const has = (states: FocusState[], s: FocusState) => states.includes(s);
const pct = (n: number) => `${Math.round(n * 100)}%`;

// ===========================================================================
section('1. Calibration');
// ===========================================================================
{
  const good = trace([{ seconds: 5, sample: withJitter(READING) }]);
  const r = calibrate(good, CFG);
  check('a steady reader calibrates', r.ok);
  if (r.ok) {
    check('baseline captures head-down posture', Math.abs(r.baseline.pitch - -35) < 4, `${r.baseline.pitch}`);
    check('baseline yaw is centred', Math.abs(r.baseline.yaw) < 4, `${r.baseline.yaw}`);
  }

  /**
   * A blackout is a dark room WITH NOBODY VISIBLE IN IT. That is the only shape
   * of darkness we can honestly diagnose, and the only one worth refusing on.
   */
  const dark = trace([{ seconds: 5, sample: { face: false, luma: 0.01 } }]);
  const rd = calibrate(dark, CFG);
  check('a dark room with no face refuses to calibrate', !rd.ok && rd.reason === 'too-dark', !rd.ok ? rd.reason : 'ok');

  /**
   * REGRESSION — the Samsung A55 false positive, reported from a real room.
   *
   * This assertion previously ran the other way: it fed a perfectly visible
   * reader with a low `luma` and demanded "too-dark". That encoded the bug
   * rather than guarding against it, because `luma` comes from the ambient
   * sensor on the FRONT of the phone, not from the frame — a student leaning
   * over the handset, or a lamp behind them, collapses it while the camera
   * still sees them fine. Focus Guard then refused to run in a lit room.
   *
   * A detected face is direct evidence the camera can see. It must win.
   */
  const dimButVisible = trace([{ seconds: 5, sample: withJitter({ ...READING, luma: 0.01 }) }]);
  const rdim = calibrate(dimButVisible, CFG);
  check('a VISIBLE face in low sensor light still calibrates', rdim.ok, rdim.ok ? 'ok' : rdim.reason);

  const noFace = trace([{ seconds: 5, sample: { face: false, luma: 0.5 } }]);
  const rn = calibrate(noFace, CFG);
  check('no face refuses to calibrate', !rn.ok && rn.reason === 'no-face', !rn.ok ? rn.reason : 'ok');

  /**
   * This test operates on FocusSample data — downstream of ML Kit's own native
   * pre-filter, which this suite has NO visibility into (it never loads a
   * native module). It proved nothing about real devices until 2026, when
   * `camera.native.tsx`'s native `minFaceSize` (0.15, ~2.25% area) was found
   * stricter than the `too-far` threshold this test exercises (1% area): ML
   * Kit was silently discarding exactly the faces this test simulates before
   * `calibrate()` ever ran, so 'too-far' was reachable here and UNREACHABLE on
   * a phone — reported as a real device bug ("clear, lit face -> no-face
   * error") this suite was structurally blind to. Fixed by lowering the native
   * threshold below the provable `sqrt(minFaceArea)` bound — see the
   * cross-file invariant comment on `minFaceArea` in `types.ts`. Kept in mind:
   * a green run here is necessary, never sufficient, for anything gated by a
   * native SDK parameter.
   */
  const far = trace([{ seconds: 5, sample: { ...READING, faceArea: 0.002 } }]);
  const rf = calibrate(far, CFG);
  check('a face too far away refuses', !rf.ok && rf.reason === 'too-far', !rf.ok ? rf.reason : 'ok');

  const restless = trace([{ seconds: 5, sample: (i) => ({ ...READING, yaw: i % 2 ? -40 : 40 }) }]);
  const rr = calibrate(restless, CFG);
  check('a restless student is asked to settle', !rr.ok && rr.reason === 'too-restless', !rr.ok ? rr.reason : 'ok');

  check('every failure has student-facing copy',
    (['too-dark', 'no-face', 'too-far', 'too-restless'] as const).every((k) => CALIBRATION_HELP[k].length > 10));
  check('calibration never throws on an empty trace', calibrate([], CFG).ok === false);
}

// ===========================================================================
section('2. THE headline case — reading a physical book is FOCUS, not distraction');
// ===========================================================================
{
  const samples = trace([{ seconds: 300, sample: withJitter(READING) }]);
  const { report, states } = runTrace(samples, BOOK_BASELINE, CFG);
  check('5 minutes head-down over a book scores as focus',
    report.focusedMs > 290_000, `${Math.round(report.focusedMs / 1000)}s`);
  check('no distraction is ever reported', report.distractedMs === 0, `${report.distractedMs}ms`);
  check('no false "walked away"', report.awayMs === 0);
  check('no false drowsiness at a steep reading angle', report.drowsyMs === 0);
  check('score is essentially perfect', (report.score ?? 0) > 0.97, pct(report.score ?? 0));
  check('final state is focused', states[states.length - 1] === 'focused');
}

// ===========================================================================
section('3. Glancing up to think is NOT distraction');
// ===========================================================================
{
  // Ten separate 2-second glances — well under the 4s distraction threshold.
  const chunks: Chunk[] = [{ seconds: 20, sample: READING }];
  for (let i = 0; i < 10; i += 1) {
    chunks.push({ seconds: 2, sample: { ...READING, pitch: 5, yaw: 30 } });
    chunks.push({ seconds: 20, sample: READING });
  }
  const samples = trace(chunks);
  const { report, states } = runTrace(samples, BOOK_BASELINE, CFG);
  check('ten 2-second glances produce zero distraction', report.distractedMs === 0, `${report.distractedMs}ms`);
  check('glances are still recorded on the timeline', has(states, 'glance'));
  check('glance time counts toward focus', (report.score ?? 0) > 0.97, pct(report.score ?? 0));
  check('a glance does not break the concentration streak',
    report.longestFocusMs > 200_000, `${Math.round(report.longestFocusMs / 1000)}s`);
}

// ===========================================================================
section('4. Sustained looking around IS distraction');
// ===========================================================================
{
  const samples = trace([
    { seconds: 60, sample: READING },
    { seconds: 30, sample: { ...READING, yaw: 45 } }, // talking to someone
    { seconds: 60, sample: READING },
  ]);
  const { report, states } = runTrace(samples, BOOK_BASELINE, CFG);
  check('a 30-second turn is caught', report.distractedMs > 20_000, `${Math.round(report.distractedMs / 1000)}s`);
  check('exactly one distraction episode', report.distractionCount === 1, `${report.distractionCount}`);
  check('it takes ~4s to escalate, not instantly', stateAt(states, samples, 61) === 'glance');
  check('escalated by 5s', stateAt(states, samples, 65) === 'distracted');
  check('recovers to focus afterwards', states[states.length - 1] === 'focused');
}

// ===========================================================================
section('5. Walking away');
// ===========================================================================
{
  const samples = trace([
    { seconds: 60, sample: READING },
    { seconds: 120, sample: { face: false, luma: 0.5 } },
    { seconds: 60, sample: READING },
  ]);
  const { report, states } = runTrace(samples, BOOK_BASELINE, CFG);
  check('absence is detected', report.awayMs > 100_000, `${Math.round(report.awayMs / 1000)}s`);
  check('exactly one away episode', report.awayCount === 1, `${report.awayCount}`);
  check('not flagged instantly — 6s of grace', stateAt(states, samples, 62) === 'focused');
  check('flagged by 8s', stateAt(states, samples, 68) === 'away');
  check('returning restores focus', states[states.length - 1] === 'focused');
  check('absence is never miscounted as distraction', report.distractedMs === 0);
}

// ===========================================================================
section('6. Leaning out of frame to write is NOT walking away');
// ===========================================================================
{
  // Repeated 4-second dips below the 6s away threshold — writing in a notebook.
  const chunks: Chunk[] = [];
  for (let i = 0; i < 12; i += 1) {
    chunks.push({ seconds: 15, sample: READING });
    chunks.push({ seconds: 4, sample: { face: false, luma: 0.5 } });
  }
  const { report } = runTrace(trace(chunks), BOOK_BASELINE, CFG);
  check('twelve short dips out of frame produce no "away"', report.awayMs === 0, `${report.awayMs}ms`);
  check('and no distraction', report.distractedMs === 0);
  check('the session still scores as focused', (report.score ?? 0) > 0.97, pct(report.score ?? 0));
}

// ===========================================================================
section('7. LOAD-SHEDDING — the room goes dark mid-session');
// The single most likely false positive this app could produce in Pakistan.
// ===========================================================================
{
  const samples = trace([
    { seconds: 120, sample: READING },
    { seconds: 300, sample: { face: false, luma: 0.02 } }, // power cut; camera blind
    { seconds: 120, sample: READING },
  ]);
  const { report, states } = runTrace(samples, BOOK_BASELINE, CFG);
  check('darkness is NEVER reported as walking away', report.awayMs === 0, `${Math.round(report.awayMs / 1000)}s`);
  check('darkness is NEVER reported as distraction', report.distractedMs === 0);
  check('darkness is recorded as unmonitored', report.uncertainMs > 290_000, `${Math.round(report.uncertainMs / 1000)}s`);
  check('unmonitored time is excluded from the denominator',
    Math.abs(report.monitoredMs - (report.totalMs - report.uncertainMs)) < 1);
  check('the score reflects only what was seen', (report.score ?? 0) > 0.97, pct(report.score ?? 0));
  check('state during the outage is uncertain', stateAt(states, samples, 200) === 'uncertain');
  check('recovers when power returns', states[states.length - 1] === 'focused');

  /**
   * REGRESSION — the Samsung A55 "room is too dark" false positive.
   *
   * `luma` is the phone's FRONT ambient-light sensor, not the camera frame, so
   * it reads low whenever the student leans over the handset or the light is
   * behind them. It used to be checked before face presence and could therefore
   * veto a face the camera could see perfectly, refusing to run in a lit room.
   *
   * A detected face is direct evidence the camera can see. Darkness may only
   * ever explain a MISSING face. Both halves are asserted here, because getting
   * one right by breaking the other is the obvious wrong fix.
   */
  {
    /**
     * Differential: the SAME reader, once in a brightly-sensed room and once
     * with the light sensor pinned near zero. While a face is visible the two
     * must be indistinguishable — that is precisely what "a face outranks the
     * light sensor" means, and it asserts it without hard-coding any of the
     * machine's start-up settling behaviour.
     */
    const bright = runTrace(
      trace([{ seconds: 60, sample: { ...READING, luma: 0.9 } }]),
      BOOK_BASELINE,
      CFG,
    ).report;
    const dim = runTrace(
      trace([{ seconds: 60, sample: { ...READING, luma: 0.001 } }]),
      BOOK_BASELINE,
      CFG,
    ).report;
    check(
      'a visible reader scores identically however low the light sensor reads',
      dim.focusedMs === bright.focusedMs && dim.uncertainMs === bright.uncertainMs,
      `dim focused=${dim.focusedMs} uncertain=${dim.uncertainMs} | bright focused=${bright.focusedMs} uncertain=${bright.uncertainMs}`,
    );
    check(
      '...and that reader is credited as focused, not abstained on',
      (dim.score ?? 0) > 0.97 && dim.focusedMs > 55_000,
      `${pct(dim.score ?? 0)} focused=${Math.round(dim.focusedMs / 1000)}s`,
    );

    // The other half: no face in a LIT room is still someone who left.
    const litEmpty = trace([
      { seconds: 30, sample: READING },
      { seconds: 60, sample: { face: false, luma: 0.9 } },
    ]);
    const e = runTrace(litEmpty, BOOK_BASELINE, CFG);
    check(
      'an empty LIT room is still reported as away',
      e.report.awayMs > 45_000,
      `${Math.round(e.report.awayMs / 1000)}s`,
    );
  }
}

// ===========================================================================
section('8. Reciting from memory with eyes closed is NOT drowsiness');
// ===========================================================================
{
  // Eyes shut, head near-frontal, but rocking — the classic memorisation posture.
  const reciting = (i: number): Omit<FocusSample, 't'> => ({
    face: true,
    pitch: -8 + Math.sin(i * 0.9) * 10,
    yaw: Math.cos(i * 0.9) * 12,
    roll: Math.sin(i * 0.6) * 8,
    eyeOpen: 0.05,
    faceArea: 0.06,
    luma: 0.5,
    trackingId: 1,
  });
  const frontalBaseline: FocusBaseline = { pitch: -8, yaw: 0, roll: 0, faceArea: 0.06 };
  const { report } = runTrace(trace([{ seconds: 180, sample: reciting }]), frontalBaseline, CFG);
  check('rocking while reciting is never called drowsy', report.drowsyMs === 0, `${report.drowsyMs}ms`);
  check('and it still counts as focus', (report.score ?? 0) > 0.9, pct(report.score ?? 0));

  // Memorisation mode disables the check outright, even for a still student.
  const stillReciting: Omit<FocusSample, 't'> = {
    face: true, pitch: -8, yaw: 0, roll: 0, eyeOpen: 0.05, faceArea: 0.06, luma: 0.5, trackingId: 1,
  };
  const memoCfg: FocusConfig = { ...CFG, memorisationMode: true };
  const memo = runTrace(trace([{ seconds: 180, sample: stillReciting }]), frontalBaseline, memoCfg);
  check('memorisation mode suppresses drowsiness entirely', memo.report.drowsyMs === 0);
  check('memorisation mode still credits focus', (memo.report.score ?? 0) > 0.97, pct(memo.report.score ?? 0));
}

// ===========================================================================
section('9. Actually falling asleep IS caught');
// ===========================================================================
{
  const asleep: Omit<FocusSample, 't'> = {
    face: true, pitch: -10, yaw: 2, roll: 3, eyeOpen: 0.02, faceArea: 0.06, luma: 0.5, trackingId: 1,
  };
  const frontalBaseline: FocusBaseline = { pitch: -10, yaw: 0, roll: 0, faceArea: 0.06 };
  const samples = trace([
    { seconds: 60, sample: { ...asleep, eyeOpen: 0.9 } },
    { seconds: 120, sample: asleep }, // motionless, eyes shut
  ]);
  const { report, states } = runTrace(samples, frontalBaseline, CFG);
  check('motionless eyes-shut is caught as drowsy', report.drowsyMs > 90_000, `${Math.round(report.drowsyMs / 1000)}s`);
  check('not called instantly — 15s threshold', stateAt(states, samples, 70) === 'focused');
  check('called by 80s', stateAt(states, samples, 80) === 'drowsy');
}

// ===========================================================================
section('10. Drowsiness detection abstains at a book-reading angle');
// The eye classifier is unreliable off-frontal, so it must say nothing there.
// ===========================================================================
{
  const bentOver: Omit<FocusSample, 't'> = {
    face: true, pitch: -45, yaw: 0, roll: 0, eyeOpen: 0.02, faceArea: 0.06, luma: 0.5, trackingId: 1,
  };
  const bentBaseline: FocusBaseline = { pitch: -45, yaw: 0, roll: 0, faceArea: 0.06 };
  const { report } = runTrace(trace([{ seconds: 300, sample: bentOver }]), bentBaseline, CFG);
  check('a low eye-open reading at 45° down is ignored, not trusted', report.drowsyMs === 0, `${report.drowsyMs}ms`);
  check('the student is credited with focus instead', (report.score ?? 0) > 0.97, pct(report.score ?? 0));
}

// ===========================================================================
section('11. Occlusion — a dupatta, a hand, a steep angle');
// ===========================================================================
{
  // Face detected but pose unavailable: abstain, never accuse.
  const samples = trace([
    { seconds: 60, sample: READING },
    { seconds: 90, sample: { face: true, faceArea: 0.05, luma: 0.5, trackingId: 1 } },
    { seconds: 60, sample: READING },
  ]);
  const { report } = runTrace(samples, BOOK_BASELINE, CFG);
  check('a face with no readable pose is unmonitored, not distracted', report.distractedMs === 0);
  check('and not counted as away', report.awayMs === 0);
  check('it is disclosed as unmonitored', report.uncertainMs > 80_000, `${Math.round(report.uncertainMs / 1000)}s`);
}

// ===========================================================================
section('12. Another person in the room');
// ===========================================================================
{
  // The camera layer tracks one primary face; a different trackingId must not
  // let dwell time accumulate across two people.
  const sibling: Omit<FocusSample, 't'> = { ...READING, yaw: 50, trackingId: 2 };
  const samples = trace([
    { seconds: 60, sample: READING },
    { seconds: 3, sample: sibling },
    { seconds: 60, sample: READING },
  ]);
  const { report } = runTrace(samples, BOOK_BASELINE, CFG);
  check('a brief different face does not trigger distraction', report.distractedMs === 0, `${report.distractedMs}ms`);
  check('the session still scores clean', (report.score ?? 0) > 0.97, pct(report.score ?? 0));
}

// ===========================================================================
section('13. Gaming the system earns nothing');
// ===========================================================================
{
  // Cover the camera for most of the session and walk off.
  const samples = trace([
    { seconds: 30, sample: READING },
    { seconds: 570, sample: { face: false, luma: 0.01 } },
  ]);
  const { report } = runTrace(samples, BOOK_BASELINE, CFG);
  check('covered camera yields no focus credit for that time',
    report.focusedMs < 40_000, `${Math.round(report.focusedMs / 1000)}s`);
  check('the blocked time is disclosed, not credited',
    report.uncertainMs > 550_000, `${Math.round(report.uncertainMs / 1000)}s`);
  check('monitored window shrinks rather than the score inflating',
    report.monitoredMs < 45_000, `${Math.round(report.monitoredMs / 1000)}s`);
}

// ===========================================================================
section('14. Scoring, attention span and edge cases');
// ===========================================================================
{
  const short = trace([{ seconds: 10, sample: READING }]);
  const { report: shortReport } = runTrace(short, BOOK_BASELINE, CFG);
  check('a 10-second session reports no score rather than a fake one', shortReport.score === null);
  check('and no attention span', attentionSpanMinutes(shortReport) === null);

  const mixed = trace([
    { seconds: 600, sample: READING },
    { seconds: 60, sample: { ...READING, yaw: 50 } },
    { seconds: 300, sample: READING },
  ]);
  const { report } = runTrace(mixed, BOOK_BASELINE, CFG);
  check('attention span reflects the longest unbroken run',
    attentionSpanMinutes(report) === 10, `${attentionSpanMinutes(report)} min`);
  check('score is between 0 and 1', (report.score ?? 0) > 0 && (report.score ?? 0) <= 1);
  check('durations sum to the session length',
    Math.abs(
      report.focusedMs + report.distractedMs + report.awayMs + report.drowsyMs + report.uncertainMs - report.totalMs,
    ) < 2,
    `${report.totalMs}`,
  );
  check('timeline segments are contiguous and ordered',
    report.segments.every((s, i) => i === 0 || s.start === report.segments[i - 1].end));
  check('no zero-length segments survive', report.segments.every((s) => s.end >= s.start));

  check('an empty trace produces an empty report', buildReport([]).totalMs === 0);
  check('an empty trace has a null score', buildReport([]).score === null);
  check('runTrace tolerates zero samples', runTrace([], BOOK_BASELINE, CFG).states.length === 0);
}

// ===========================================================================
section('15. No single frame can change state (anti-flicker)');
// ===========================================================================
{
  // Alternate wildly every single sample. Nothing sustained => nothing reported.
  const flicker = trace([
    { seconds: 30, sample: READING },
    { seconds: 120, sample: (i) => (i % 2 ? READING : { ...READING, yaw: 60 }) },
    { seconds: 30, sample: READING },
  ]);
  const { report } = runTrace(flicker, BOOK_BASELINE, CFG);
  check('alternating frames never produce a distraction', report.distractedMs === 0, `${report.distractedMs}ms`);
  check('alternating frames never produce an away', report.awayMs === 0);

  // A single dropped frame in an otherwise clean session.
  const oneDrop = trace([
    { seconds: 60, sample: READING },
    { seconds: 0.4, sample: { face: false, luma: 0.5 } },
    { seconds: 60, sample: READING },
  ]);
  const dropped = runTrace(oneDrop, BOOK_BASELINE, CFG);
  check('one dropped frame changes nothing', dropped.report.awayMs === 0 && dropped.report.distractedMs === 0);
}

// ===========================================================================
section('16. Every posture calibrates — desk, bed, floor, charpai');
// ===========================================================================
{
  const postures: [string, FocusBaseline][] = [
    ['desk, head down', { pitch: -35, yaw: 0, roll: 0, faceArea: 0.06 }],
    ['phone on floor, looking down steeply', { pitch: -55, yaw: 0, roll: 0, faceArea: 0.05 }],
    ['lying on a charpai, head rolled', { pitch: -10, yaw: 15, roll: 40, faceArea: 0.08 }],
    ['phone to one side', { pitch: -20, yaw: -35, roll: 5, faceArea: 0.06 }],
    ['upright, book propped', { pitch: -5, yaw: 0, roll: 0, faceArea: 0.06 }],
  ];
  for (const [label, baseline] of postures) {
    const reading: Omit<FocusSample, 't'> = {
      face: true,
      pitch: baseline.pitch,
      yaw: baseline.yaw,
      roll: baseline.roll,
      eyeOpen: 0.9,
      faceArea: baseline.faceArea,
      luma: 0.5,
      trackingId: 1,
    };
    const { report } = runTrace(trace([{ seconds: 180, sample: withJitter(reading) }]), baseline, CFG);
    check(`${label}: scores as focus`, (report.score ?? 0) > 0.97, pct(report.score ?? 0));
    check(`${label}: no false distraction`, report.distractedMs === 0);
    check(`${label}: no false away`, report.awayMs === 0);
  }
}

// ===========================================================================
section('16b. Large/close faces impose no implicit ceiling');
// ===========================================================================
{
  /**
   * Every faceArea value used everywhere else in this suite sits in 0.05-0.08
   * — a normal, book-propped reading distance. Nothing here ever exercised a
   * student leaning in close, holding the phone near, or a face that simply
   * fills more of the frame. `calibrate()`'s only faceArea gate is a LOWER
   * bound (calibration.ts) and `classifyInstant()` never re-checks faceArea
   * once past that floor (stateMachine.ts) — so in principle nothing in this
   * app's OWN logic should reject a large face. This section proves that
   * rather than asserting it from reading the source: a big/close face is
   * exactly as valid a "focused" reading as a small/far one, all the way up
   * to filling most of the frame.
   *
   * What this section CANNOT prove: ML Kit's own black-box behavior at these
   * sizes. Google documents no maximum face size and no practitioner report
   * of a large-face failure was found, but that is a real-device question
   * this pure-function suite has no way to answer — see CLAUDE.md's "not yet
   * verified" line.
   */
  const sizes = [0.08, 0.15, 0.3, 0.5, 0.7];

  for (const fa of sizes) {
    const samples = trace([{ seconds: 5, sample: withJitter({ ...READING, faceArea: fa }) }]);
    const r = calibrate(samples, CFG);
    check(`faceArea ${fa}: calibrates successfully`, r.ok, r.ok ? 'ok' : r.reason);
    if (r.ok) {
      check(
        `faceArea ${fa}: recovered baseline tracks the input size`,
        Math.abs(r.baseline.faceArea - fa) < 0.001,
        `${r.baseline.faceArea}`,
      );
    }
  }

  for (const fa of sizes) {
    const baseline: FocusBaseline = { ...BOOK_BASELINE, faceArea: fa };
    const reading: Omit<FocusSample, 't'> = { ...READING, faceArea: fa };
    const { report } = runTrace(
      trace([{ seconds: 120, sample: withJitter(reading) }]),
      baseline,
      CFG,
    );
    check(
      `faceArea ${fa}: scores as focus over a full session`,
      (report.score ?? 0) > 0.97,
      pct(report.score ?? 0),
    );
    check(`faceArea ${fa}: no false distraction`, report.distractedMs === 0);
    check(`faceArea ${fa}: no false away`, report.awayMs === 0);
  }

  // The realistic trigger for a large faceArea: the student leans in close
  // mid-session (checking something, adjusting the phone) while staying
  // aligned with their own baseline posture. Size alone must never look like
  // deviation — classifyInstant does not re-examine faceArea past the initial
  // floor check, so this proves that boundary holds under a real transition,
  // not just a static trace.
  {
    const samples = trace([
      { seconds: 60, sample: withJitter(READING) },
      { seconds: 30, sample: withJitter({ ...READING, faceArea: 0.5 }) },
      { seconds: 60, sample: withJitter(READING) },
    ]);
    const { report } = runTrace(samples, BOOK_BASELINE, CFG);
    check(
      'leaning in close (faceArea jumps to 0.5) is not classified as distraction',
      report.distractedMs === 0,
      `${Math.round(report.distractedMs / 1000)}s`,
    );
    check('leaning in close still counts as focus', (report.score ?? 0) > 0.97, pct(report.score ?? 0));
  }

  /**
   * Face SHAPE (long/narrow vs round/wide) is a different question from size,
   * and this app cannot answer it: `FocusSample.faceArea` is a scalar area
   * ratio with no width/height split, so an elongated face and a round face
   * of equal area are indistinguishable to every check in this codebase. This
   * is a known, accepted limitation, not a gap being silently left untested —
   * real human face aspect-ratio variance is bounded, and adding width/height
   * tracking would be a schema change across the native interface,
   * calibration, the state machine and this whole suite for a marginal
   * benefit. Deliberately not attempted.
   */
}

// ===========================================================================
section('17. Attention-span advice fed back to the plan engine');
// ===========================================================================
{
  check('says nothing after one session', recommendedSessionMinutes([15]) === null);
  check('says nothing after two', recommendedSessionMinutes([15, 17]) === null);
  check('speaks once there are three', recommendedSessionMinutes([25, 27, 26]) === 26);
  // A measured span below the engine's schedulable floor is raised to it — the
  // advice has to be something the plan engine can actually build a block from.
  check('advice below the session floor is raised to it',
    recommendedSessionMinutes([15, 17, 16]) === 20, `${recommendedSessionMinutes([15, 17, 16])}`);

  // A single heroic or catastrophic session must not move the advice. Values
  // sit above the floor so this tests the median rather than the clamp: the
  // mean of [24,25,26,90] is 41, the median is 25.5.
  check('one 90-minute outlier does not skew the median',
    recommendedSessionMinutes([24, 25, 26, 90]) === 26, `${recommendedSessionMinutes([24, 25, 26, 90])}`);
  check('one terrible session does not skew it either',
    recommendedSessionMinutes([28, 30, 32, 2]) === 29, `${recommendedSessionMinutes([28, 30, 32, 2])}`);

  // Clamped into the engine's schedulable block range.
  check('never advises below the engine session floor',
    (recommendedSessionMinutes([2, 3, 4, 5]) ?? 0) >= 20, `${recommendedSessionMinutes([2, 3, 4, 5])}`);
  check('never advises above a focused block',
    (recommendedSessionMinutes([90, 120, 150]) ?? 0) <= 60, `${recommendedSessionMinutes([90, 120, 150])}`);

  // Only the recent window counts — attention drifts over an exam season. Note
  // three recent sessions deliberately do NOT overturn five older ones inside
  // the 8-session window; that stability is wanted, so this uses five.
  const stale = [...Array(20).fill(45), 12, 13, 14, 12, 13];
  check('a run of recent short sessions moves the advice down',
    (recommendedSessionMinutes(stale) ?? 99) < 45, `${recommendedSessionMinutes(stale)}`);
  const barelyRecent = [...Array(20).fill(45), 12, 13, 14];
  check('but three recent sessions do not overturn five older ones',
    recommendedSessionMinutes(barelyRecent) === 45, `${recommendedSessionMinutes(barelyRecent)}`);

  check('empty history is silent', recommendedSessionMinutes([]) === null);
}

// ===========================================================================
section('18. Voice cues — speak only where the screen cannot be read');
// ===========================================================================
{
  const base = {
    prevPhase: 'running' as const,
    phase: 'running' as const,
    prevState: 'focused' as FocusState,
    state: 'focused' as FocusState,
    now: 0,
  };

  // --- silence is the default
  const silent: [FocusState, FocusState][] = [
    ['focused', 'glance'],
    ['glance', 'focused'],
    ['focused', 'distracted'],
    ['glance', 'distracted'],
    ['focused', 'uncertain'],
    ['uncertain', 'focused'],
    ['distracted', 'focused'],
  ];
  for (const [prevState, state] of silent) {
    check(
      `silent: ${prevState} -> ${state}`,
      selectCue({ ...base, prevState, state }) === null,
      `${selectCue({ ...base, prevState, state })}`,
    );
  }
  check(
    'sustained distraction is silent BY DEFAULT (haptic only)',
    selectCue({ ...base, prevState: 'glance', state: 'distracted' }) === null,
  );

  // --- the three moments that DO speak
  check('away speaks on entry', selectCue({ ...base, prevState: 'focused', state: 'away' }) === 'away');
  check('return speaks on exit', selectCue({ ...base, prevState: 'away', state: 'focused' }) === 'return');
  check('drowsy speaks on entry', selectCue({ ...base, prevState: 'focused', state: 'drowsy' }) === 'drowsy');

  /**
   * --- REGRESSION: the dark-room spam loop.
   *
   * `away -> uncertain` is NOT a return; it means the camera stopped being able
   * to judge. Speaking "Welcome back" there was both untrue and half of a spam
   * loop: in a dark room the state flickers away/uncertain/away, so the student
   * heard "Timer paused" and "Welcome back" alternating at every flip.
   */
  check(
    'away -> uncertain does NOT say welcome back',
    selectCue({ ...base, prevState: 'away', state: 'uncertain' }) === null,
    `${selectCue({ ...base, prevState: 'away', state: 'uncertain' })}`,
  );
  for (const seeing of ['focused', 'glance', 'distracted', 'drowsy'] as FocusState[]) {
    check(
      `away -> ${seeing} is a real return`,
      selectCue({ ...base, prevState: 'away', state: seeing }) === 'return',
    );
  }

  // --- opt-in spoken distraction nudge
  check(
    'distraction speaks when the setting is on',
    selectCue({ ...base, prevState: 'glance', state: 'distracted', speakOnDistracted: true }) ===
      'distracted',
  );
  check(
    'distraction stays silent when the setting is off',
    selectCue({ ...base, prevState: 'glance', state: 'distracted', speakOnDistracted: false }) === null,
  );
  check(
    'staying distracted does not speak again',
    selectCue({
      ...base,
      prevState: 'distracted',
      state: 'distracted',
      speakOnDistracted: true,
    }) === null,
  );
  check(
    'the distraction opt-in cannot make ambient states speak',
    ['focused', 'glance', 'uncertain'].every(
      (s) =>
        selectCue({
          ...base,
          prevState: 'focused',
          state: s as FocusState,
          speakOnDistracted: true,
        }) === null,
    ),
  );

  // --- transitions, not states: away persists for minutes and must speak once
  check(
    'staying away does not speak again',
    selectCue({ ...base, prevState: 'away', state: 'away' }) === null,
  );

  // --- calibration
  check(
    'calibration start speaks',
    selectCue({ ...base, prevPhase: 'idle', phase: 'calibrating' }) === 'calibration-start',
  );
  check(
    'calibration success speaks',
    selectCue({ ...base, prevPhase: 'calibrating', phase: 'running' }) === 'calibration-ok',
  );
  const failures: [CalibrationFailure, string][] = [
    ['too-dark', 'calibration-too-dark'],
    ['no-face', 'calibration-no-face'],
    ['too-far', 'calibration-too-far'],
    ['too-restless', 'calibration-too-restless'],
  ];
  for (const [failure, cue] of failures) {
    check(
      `calibration failure '${failure}' speaks its own line`,
      selectCue({ ...base, prevPhase: 'calibrating', phase: 'unavailable', failure }) === cue,
    );
  }
  check(
    'nothing is spoken while not running',
    selectCue({ ...base, prevPhase: 'idle', phase: 'idle', prevState: 'focused', state: 'away' }) === null,
  );

  // --- rate limiting
  {
    let mem = initCueMemory();
    // Deliberately a small `now`: the cooldown must be clock-agnostic, not
    // rely on Date.now() being a huge absolute number.
    const first = nextCue({ ...base, prevState: 'focused', state: 'away', now: 10_000 }, mem);
    check('the first cue of a session always plays', first !== null);
    if (first) mem = first.memory;
    const soon = nextCue({ ...base, prevState: 'away', state: 'focused', now: 11_000 }, mem);
    check('a second cue 1s later is suppressed', soon === null);
    const later = nextCue(
      { ...base, prevState: 'away', state: 'focused', now: 10_000 + VOICE_COOLDOWN_MS + 1 },
      mem,
    );
    check('a cue after the cooldown plays', later !== null);
  }
  {
    // Calibration must never be muted by a cooldown — the student is standing
    // there waiting for it.
    let mem = initCueMemory();
    const away = nextCue({ ...base, prevState: 'focused', state: 'away', now: 1000 }, mem);
    if (away) mem = away.memory;
    const cal = nextCue({ ...base, prevPhase: 'idle', phase: 'calibrating', now: 2000 }, mem);
    check('calibration bypasses the cooldown', cal?.cue.id === 'calibration-start');
  }
  {
    // THE BUG THIS CATCHES: calibration-ok used to write `lastSpokeAt`, starting
    // the 2-minute cooldown clock. Every live cue that fired within 2 minutes of
    // calibration finishing — i.e. every test and most real sessions — was
    // silently suppressed. The fix: cooldown-bypassing cues no longer write
    // `lastSpokeAt`, so they cannot poison the live-tracking window.
    let mem = initCueMemory();
    // Calibration starts at t=1000.
    const calStart = nextCue(
      { ...base, prevPhase: 'idle', phase: 'calibrating', now: 1000 },
      mem,
    );
    check('cal-start plays', calStart?.cue.id === 'calibration-start');
    if (calStart) mem = calStart.memory;
    check('cal-start does not set lastSpokeAt', mem.lastSpokeAt === null);

    // Calibration succeeds at t=6000 (5s later).
    const calOk = nextCue(
      { ...base, prevPhase: 'calibrating', phase: 'running', now: 6000 },
      mem,
    );
    check('cal-ok plays', calOk?.cue.id === 'calibration-ok');
    if (calOk) mem = calOk.memory;
    check('cal-ok does not set lastSpokeAt', mem.lastSpokeAt === null);

    // Student walks away at t=10000, only 4s after calibration-ok.
    // Before the fix this was SILENTLY SUPPRESSED.
    const away = nextCue(
      { ...base, prevState: 'focused', state: 'away', now: 10_000 },
      mem,
    );
    check('away cue is NOT suppressed by calibration cooldown', away?.cue.id === 'away');
    if (away) mem = away.memory;

    // Now lastSpokeAt IS set, because 'away' is a live cue.
    check('away DOES set lastSpokeAt', mem.lastSpokeAt === 10_000);

    // A second live cue within 3 seconds IS suppressed (existing behaviour).
    const returnSoon = nextCue(
      { ...base, prevState: 'away', state: 'focused', now: 11_000 },
      mem,
    );
    check('return 1s after away is still suppressed by live cooldown', returnSoon === null);
  }

  // --- variants never repeat back to back
  {
    let mem = initCueMemory();
    let prevVariant = -1;
    let repeats = 0;
    for (let i = 0; i < 40; i += 1) {
      const r = nextCue(
        { ...base, prevState: 'focused', state: 'away', now: i * (VOICE_COOLDOWN_MS + 1) },
        mem,
      );
      if (!r) continue;
      if (r.cue.variant === prevVariant) repeats += 1;
      prevVariant = r.cue.variant;
      mem = r.memory;
    }
    check('a variant never plays twice in a row', repeats === 0, `${repeats} repeats`);
  }

  // --- manifest integrity
  check('every cue id has at least one variant',
    Object.values(VOICE_LINES).every((v) => v.length > 0));
  check('every clip filename is unique',
    new Set(ALL_VOICE_FILES).size === ALL_VOICE_FILES.length);
  check('every line has non-empty text',
    Object.values(VOICE_LINES).flat().every((v) => v.text.trim().length > 3));
  check('repeating cues carry several variants so they do not feel canned',
    VOICE_LINES.away.length >= 3 && VOICE_LINES.return.length >= 3 && VOICE_LINES.drowsy.length >= 3);

  // --- voice pack completeness
  check('five voices are offered', FOCUS_VOICES.length === 5, `${FOCUS_VOICES.length}`);
  check('the default voice is one of them', isKnownVoice(DEFAULT_VOICE_ID));
  check('voice ids are unique', new Set(FOCUS_VOICES.map((v) => v.id)).size === FOCUS_VOICES.length);
  check('ElevenLabs voice ids are unique',
    new Set(FOCUS_VOICES.map((v) => v.elevenId)).size === FOCUS_VOICES.length);
  check('every voice has a name and tagline',
    FOCUS_VOICES.every((v) => v.name.length > 0 && v.tagline.length > 5));
  check('an unknown voice id is rejected', !isKnownVoice('nope'));
  check('the pack covers every line in every voice',
    ALL_VOICE_FILES.length === FOCUS_VOICES.length * BASE_LINE_FILES.length + 1,
    `${ALL_VOICE_FILES.length} files`);
  check('the preview line is a real line',
    BASE_LINE_FILES.includes(PREVIEW_BASE_FILE), PREVIEW_BASE_FILE);

  // Every file the manifest names must actually exist, or one voice goes silent
  // with no other symptom.
  const missing = ALL_VOICE_FILES.filter((f) => !nodeFs.existsSync(`${VOICE_DIR}/${f}`));
  check('every manifest file exists on disk', missing.length === 0,
    `${missing.length} missing: ${missing.slice(0, 3).join(', ')}`);
}

// ===========================================================================
console.log(`\n${'='.repeat(70)}`);
console.log(`${pass} passed, ${fail} failed`);
if (failures.length > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(fail === 0 ? 0 : 1);
