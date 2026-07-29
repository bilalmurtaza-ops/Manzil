import { staticFile } from 'remotion';

/**
 * The video's palette is IMPORTED FROM THE APP, never re-typed.
 *
 * `src/theme/tokens.ts` is pure TypeScript with no React Native imports, so it
 * loads cleanly in Remotion's DOM renderer. That means every green, gold and
 * paper tone on screen is byte-identical to the shipping app — if a token
 * changes, this film changes with it. Re-declaring hex values here would let
 * the two drift silently, which is exactly the failure that makes brand videos
 * look subtly "off" from the product they advertise.
 */
export { color, subjectColor, radius } from '../../src/theme/tokens';

/** Same two families the app loads at runtime, copied into public/fonts. */
export const FONTS = `
  @font-face { font-family: 'SG'; src: url('${staticFile('fonts/SG-400.ttf')}') format('truetype'); font-weight: 400; }
  @font-face { font-family: 'SG'; src: url('${staticFile('fonts/SG-500.ttf')}') format('truetype'); font-weight: 500; }
  @font-face { font-family: 'SG'; src: url('${staticFile('fonts/SG-700.ttf')}') format('truetype'); font-weight: 700; }
  @font-face { font-family: 'NNU'; src: url('${staticFile('fonts/NNU-400.ttf')}') format('truetype'); font-weight: 400; }
`;

export const SG = "'SG', system-ui, sans-serif";
export const NNU = "'NNU', serif";

/** 60s at 30fps. Scene boundaries live in one place so pacing is easy to retune. */
export const FPS = 30;
export const s = (seconds: number) => Math.round(seconds * FPS);

export const SCENES = {
  problem: { from: s(0), dur: s(9) },
  logo: { from: s(9), dur: s(5) },
  data: { from: s(14), dur: s(10) },
  engine: { from: s(24), dur: s(12) },
  ai: { from: s(36), dur: s(12) },
  proof: { from: s(48), dur: s(7) },
  close: { from: s(55), dur: s(5) },
} as const;

export const TOTAL = s(60);
