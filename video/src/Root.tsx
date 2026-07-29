import React from 'react';
import { Composition } from 'remotion';
import { Manzil } from './Manzil';
import { FPS, TOTAL } from './theme';

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Manzil"
      component={Manzil}
      durationInFrames={TOTAL}
      fps={FPS}
      width={1920}
      height={1080}
    />
  </>
);
