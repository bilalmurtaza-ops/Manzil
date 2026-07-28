/**
 * Focus Guard — public surface.
 *
 * Everything exported here is pure and runs anywhere, including web and Node.
 * The camera binding lives behind a platform split (`camera.native.ts` /
 * `camera.web.ts`) so importing this module can never pull a native dependency
 * into the web bundle.
 */
export { CALIBRATION_HELP, CALIBRATION_MS, calibrate } from './calibration';
export type { CalibrationFailure, CalibrationResult } from './calibration';
export { classifyInstant, initMachine, stepFocus } from './stateMachine';
export {
  MIN_SPANS_FOR_ADVICE,
  attentionSpanMinutes,
  buildReport,
  pushState,
  recommendedSessionMinutes,
  runTrace,
} from './scoring';
export { DEFAULT_FOCUS_CONFIG } from './types';
export type {
  FocusBaseline,
  FocusConfig,
  FocusInstant,
  FocusMachine,
  FocusReport,
  FocusSample,
  FocusSegment,
  FocusState,
} from './types';
