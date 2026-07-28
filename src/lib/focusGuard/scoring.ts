import { initMachine, stepFocus } from './stateMachine';
import type {
  FocusBaseline,
  FocusConfig,
  FocusReport,
  FocusSample,
  FocusSegment,
  FocusState,
} from './types';

/**
 * Turning a state timeline into a report the student can trust.
 *
 * The one rule that matters: `uncertain` time is removed from the DENOMINATOR,
 * never added to distraction. If the camera couldn't see, the student is not
 * accused — the time simply isn't scored, and the report says so out loud.
 *
 * A useful consequence: covering the camera to cheat the score earns nothing.
 * Unmonitored time is excluded rather than credited, so gaming it produces a
 * shorter monitored window, not a better number.
 */

/** `glance` is focus. Looking up to think is thinking, not distraction. */
const isFocus = (s: FocusState) => s === 'focused' || s === 'glance';

/** Below this there simply isn't enough observation to report a score. */
const MIN_MONITORED_MS = 30_000;

/**
 * Extend the timeline. Mutates `segments` because a live session appends on
 * every sample and reallocating the array a few thousand times would be waste.
 */
export function pushState(segments: FocusSegment[], state: FocusState, t: number): void {
  const last = segments[segments.length - 1];
  if (!last) {
    segments.push({ state, start: t, end: t });
    return;
  }
  last.end = t;
  if (last.state !== state) segments.push({ state, start: t, end: t });
}

export function buildReport(segments: FocusSegment[], endT?: number): FocusReport {
  const segs = segments.map((s) => ({ ...s }));
  if (segs.length > 0 && endT !== undefined && endT > segs[segs.length - 1].end) {
    segs[segs.length - 1].end = endT;
  }

  const by: Record<FocusState, number> = {
    focused: 0,
    glance: 0,
    distracted: 0,
    away: 0,
    drowsy: 0,
    uncertain: 0,
  };
  let distractionCount = 0;
  let awayCount = 0;
  let longestFocusMs = 0;
  let runningFocus = 0;

  for (const s of segs) {
    const d = Math.max(0, s.end - s.start);
    by[s.state] += d;
    if (s.state === 'distracted') distractionCount += 1;
    if (s.state === 'away') awayCount += 1;

    // A focus run survives across focused/glance boundaries — a glance does not
    // reset the student's concentration streak.
    if (isFocus(s.state)) {
      runningFocus += d;
      longestFocusMs = Math.max(longestFocusMs, runningFocus);
    } else {
      runningFocus = 0;
    }
  }

  const totalMs = segs.length ? segs[segs.length - 1].end - segs[0].start : 0;
  const focusedMs = by.focused + by.glance;
  const uncertainMs = by.uncertain;
  const monitoredMs = Math.max(0, totalMs - uncertainMs);

  return {
    totalMs,
    focusedMs,
    distractedMs: by.distracted,
    awayMs: by.away,
    drowsyMs: by.drowsy,
    uncertainMs,
    monitoredMs,
    score: monitoredMs >= MIN_MONITORED_MS ? focusedMs / monitoredMs : null,
    longestFocusMs,
    distractionCount,
    awayCount,
    segments: segs,
  };
}

/**
 * Replay a whole sample trace in one call.
 *
 * This is what makes the feature testable without a camera, a device or a
 * human: synthetic traces go in, an exact state timeline comes out. Live
 * sessions drive the same `stepFocus` incrementally.
 */
export function runTrace(
  samples: FocusSample[],
  baseline: FocusBaseline,
  config: FocusConfig,
): { report: FocusReport; states: FocusState[] } {
  if (samples.length === 0) {
    return { report: buildReport([]), states: [] };
  }
  let m = initMachine(samples[0].t);
  const segments: FocusSegment[] = [];
  const states: FocusState[] = [];
  for (const s of samples) {
    m = stepFocus(m, s, baseline, config);
    pushState(segments, m.state, s.t);
    states.push(m.state);
  }
  return { report: buildReport(segments, samples[samples.length - 1].t), states };
}

/**
 * The student's observed attention span, in minutes, or null when the evidence
 * is too thin to say. Feeds the plan engine's session-length recommendation.
 */
export function attentionSpanMinutes(report: FocusReport): number | null {
  if (report.monitoredMs < MIN_MONITORED_MS) return null;
  return Math.round(report.longestFocusMs / 60_000);
}

/**
 * A session length this student can actually sustain, from measured spans.
 *
 * This is the loop that stops Focus Guard being a gimmick: it observes real
 * attention and hands the number back to the plan engine, so a student whose
 * concentration reliably breaks at 15 minutes stops being prescribed 45-minute
 * blocks.
 *
 * Deliberately conservative:
 *  - needs several sessions before it will say anything, because one bad night
 *    is not an attention span;
 *  - uses the MEDIAN, so a single heroic or disastrous session can't move it;
 *  - returns null rather than a guess when the evidence is thin.
 */
export const MIN_SPANS_FOR_ADVICE = 3;

export function recommendedSessionMinutes(spans: number[]): number | null {
  if (spans.length < MIN_SPANS_FOR_ADVICE) return null;
  // Only the recent window matters — attention drifts with sleep and exam
  // proximity, and a span from six weeks ago should not shape today's plan.
  const recent = spans.slice(-8).sort((a, b) => a - b);
  const mid = recent.length >> 1;
  const median = recent.length % 2 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2;
  // Clamp into the engine's real block range: below SESSION_MIN a session isn't
  // schedulable, above SESSION_MAX it isn't a focused block any more.
  return Math.max(20, Math.min(60, Math.round(median)));
}
