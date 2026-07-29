import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { color, SG, NNU } from './theme';

/**
 * Shared motion primitives.
 *
 * Everything animates on a spring or an eased interpolation rather than a
 * linear ramp — linear motion is the single clearest tell of an amateur motion
 * graphic, because nothing in the physical world moves at a constant velocity.
 */

/** Frames since a local start point, floored at 0. */
export const local = (frame: number, from: number) => Math.max(0, frame - from);

/** Fade + rise. The workhorse entrance. */
export const useEnter = (from: number, distance = 40) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = local(frame, from);
  const p = spring({ frame: f, fps, config: { damping: 200, mass: 0.6 } });
  return {
    opacity: interpolate(f, [0, 12], [0, 1], { extrapolateRight: 'clamp' }),
    transform: `translateY(${interpolate(p, [0, 1], [distance, 0])}px)`,
  };
};

/** Fade out over the final `len` frames of a scene. */
export const useExit = (sceneDur: number, len = 14) => {
  const frame = useCurrentFrame();
  return {
    opacity: interpolate(frame, [sceneDur - len, sceneDur], [1, 0], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  };
};

export const Line: React.FC<{
  children: React.ReactNode;
  from: number;
  size?: number;
  weight?: number;
  col?: string;
  mb?: number;
  ls?: number;
}> = ({ children, from, size = 62, weight = 700, col = color.paperOnDark, mb = 0, ls = -1.6 }) => {
  const e = useEnter(from);
  return (
    <div
      style={{
        ...e,
        fontFamily: SG,
        fontSize: size,
        fontWeight: weight,
        color: col,
        letterSpacing: ls,
        lineHeight: 1.15,
        marginBottom: mb,
      }}
    >
      {children}
    </div>
  );
};

export const Urdu: React.FC<{
  children: React.ReactNode;
  from: number;
  size?: number;
  col?: string;
}> = ({ children, from, size = 54, col = color.greenMid }) => {
  const e = useEnter(from, 20);
  return (
    <div
      style={{
        ...e,
        fontFamily: NNU,
        fontSize: size,
        color: col,
        direction: 'rtl',
        lineHeight: 2,
      }}
    >
      {children}
    </div>
  );
};

/** Gold rule that draws itself outward — the app's own accent gesture. */
export const Rule: React.FC<{ from: number; w?: number; col?: string }> = ({
  from,
  w = 180,
  col = color.gold,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame: local(frame, from), fps, config: { damping: 200 } });
  return (
    <div
      style={{
        width: interpolate(p, [0, 1], [0, w]),
        height: 5,
        background: col,
        borderRadius: 999,
      }}
    />
  );
};

/** Counts up to a target. Used for the proof stats. */
export const Count: React.FC<{ to: number; from: number; dur?: number }> = ({
  to,
  from,
  dur = 40,
}) => {
  const frame = useCurrentFrame();
  const t = Math.min(1, local(frame, from) / dur);
  // Cubic ease-out: the number decelerates into its final value instead of
  // snapping. That "settling" is what makes a counter feel solid rather than
  // like a spinning slot machine.
  return <>{Math.round(to * (1 - Math.pow(1 - t, 3)))}</>;
};
