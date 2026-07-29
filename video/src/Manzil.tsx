import React from 'react';
import { AbsoluteFill, Sequence, interpolate, useCurrentFrame } from 'remotion';
import { FONTS, SCENES, color } from './theme';
import { AI, Close, Data, Engine, Logo, Problem, Proof } from './scenes';

/**
 * The 60-second film.
 *
 * Scenes are sequenced from one table in `theme.ts`, so retiming the whole
 * piece means editing seconds in a single place rather than hunting frame
 * numbers through seven components.
 */

/** Short cross-dissolve so scenes flow instead of cutting hard. */
const Fade: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const IN = 10;
  const OUT = 12;
  const opacity = interpolate(
    frame,
    [0, IN, dur - OUT, dur],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const Manzil: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: color.inkWash }}>
    <style>{FONTS}</style>

    <Sequence from={SCENES.problem.from} durationInFrames={SCENES.problem.dur}>
      <Fade dur={SCENES.problem.dur}><Problem /></Fade>
    </Sequence>

    <Sequence from={SCENES.logo.from} durationInFrames={SCENES.logo.dur}>
      <Fade dur={SCENES.logo.dur}><Logo /></Fade>
    </Sequence>

    <Sequence from={SCENES.data.from} durationInFrames={SCENES.data.dur}>
      <Fade dur={SCENES.data.dur}><Data /></Fade>
    </Sequence>

    <Sequence from={SCENES.engine.from} durationInFrames={SCENES.engine.dur}>
      <Fade dur={SCENES.engine.dur}><Engine /></Fade>
    </Sequence>

    <Sequence from={SCENES.ai.from} durationInFrames={SCENES.ai.dur}>
      <Fade dur={SCENES.ai.dur}><AI /></Fade>
    </Sequence>

    <Sequence from={SCENES.proof.from} durationInFrames={SCENES.proof.dur}>
      <Fade dur={SCENES.proof.dur}><Proof /></Fade>
    </Sequence>

    <Sequence from={SCENES.close.from} durationInFrames={SCENES.close.dur}>
      <Fade dur={SCENES.close.dur}><Close /></Fade>
    </Sequence>
  </AbsoluteFill>
);
