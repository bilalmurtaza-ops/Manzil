/**
 * LIVE suite — the answer grader's mark bands, checked against the real API.
 *
 * Why this exists: `gradeAnswer` bands a question by size and briefs the model
 * differently for each band. `tsc` proves the string is built; only a real call
 * proves the model HONOURS it. The specific failure this guards against is a
 * complete two-line answer being marked down for being short, plus the padding
 * that follows from demanding four "improvements" on a two-mark question.
 *
 * The answer sheet is rendered at runtime with `sharp` (already a devDependency)
 * rather than committed as a fixture, so the suite stays self-contained and
 * there is no binary blob in the repo to keep in sync with the text.
 *
 * Run:  npx tsx scripts/test-grader-bands.ts
 * Needs EXPO_PUBLIC_GEMINI_API_KEY — read from .env below, same as the app.
 */

import { readFileSync } from 'node:fs';
import sharp from 'sharp';

// .env is loaded by hand: this runs under plain tsx, not Expo, so the usual
// EXPO_PUBLIC_ inlining never happens.
for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

let passed = 0;
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) {
    passed++;
    console.log(`  ok    ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

const profile = {
  name: 'Test',
  classLevel: 10,
  group: 'science',
  boardId: 'lahore',
  examDate: '2027-03-01',
  dailyMinutes: 180,
  confidence: {},
} as never;

/** A short, CORRECT, complete answer — the exact shape that used to be penalised. */
const SHORT_ANSWER = [
  'Q: Define atomic number.',
  '',
  'Ans: The atomic number of an element is the',
  'number of protons present in the nucleus of',
  'its atom. It is denoted by Z.',
];

const pctOf = (g: { marksAwarded: number; marksTotal: number }): string =>
  `${Math.round((g.marksAwarded / g.marksTotal) * 100)}%`;

async function sheet(lines: string[]): Promise<string> {
  const body = lines
    .map(
      (l, i) =>
        `<text x="60" y="${110 + i * 52}" font-size="30" font-family="Georgia, serif" fill="#1a2b4a">${l}</text>`,
    )
    .join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${140 + lines.length * 52}"><rect width="100%" height="100%" fill="#fdfcf7"/>${body}</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  return png.toString('base64');
}

async function main() {
  // gemini.ts resolves its key pool at module load, so it must be imported AFTER
  // the .env values above reach process.env. A static import would hoist above
  // them and find no keys at all.
  const { gradeAnswer, questionBandLabel, GeminiError } = await import('../src/lib/gemini');

  console.log('\nAnswer-grader mark bands — LIVE\n');

  console.log('Band labels (pure)');
  check('2 marks is a short question', questionBandLabel(2) === 'Short question', questionBandLabel(2));
  check('5 marks is medium', questionBandLabel(5) === 'Medium question', questionBandLabel(5));
  check('8 marks is long', questionBandLabel(8) === 'Long question', questionBandLabel(8));
  check('10 marks is extended', questionBandLabel(10) === 'Extended question', questionBandLabel(10));
  check('1 mark falls in the short band', questionBandLabel(1) === 'Short question');
  check('an unlisted large value still bands', questionBandLabel(15) === 'Extended question');
  check('a nonsense value never throws', typeof questionBandLabel(0) === 'string');

  console.log('\nLive grading (same answer sheet, graded at two sizes)');
  const img = await sheet(SHORT_ANSWER);

  try {
    const two = await gradeAnswer(profile, img, 'chem10', 2, 'image/png');
    check('2-mark: marksTotal is exactly 2', two.marksTotal === 2, `${two.marksTotal}`);
    check(
      '2-mark: award is inside [0,2]',
      two.marksAwarded >= 0 && two.marksAwarded <= 2,
      `${two.marksAwarded}`,
    );
    check(
      '2-mark: a complete short answer is NOT punished for brevity',
      two.marksAwarded >= 1.5,
      `awarded ${two.marksAwarded}/2`,
    );
    check(
      '2-mark: improvements are not padded',
      two.improvements.length <= 2,
      `${two.improvements.length} listed`,
    );
    check('2-mark: examiner note present', two.examinerNote.trim().length > 0);

    const ten = await gradeAnswer(profile, img, 'chem10', 10, 'image/png');
    check('10-mark: marksTotal is exactly 10', ten.marksTotal === 10, `${ten.marksTotal}`);
    check(
      '10-mark: award is inside [0,10]',
      ten.marksAwarded >= 0 && ten.marksAwarded <= 10,
      `${ten.marksAwarded}`,
    );
    check(
      '10-mark: the SAME two-line answer scores proportionally lower',
      ten.marksAwarded / 10 < two.marksAwarded / 2,
      `${pctOf(ten)} vs ${pctOf(two)}`,
    );
    check(
      '10-mark: at least as many improvements as at 2 marks',
      ten.improvements.length >= two.improvements.length,
      `${ten.improvements.length} vs ${two.improvements.length}`,
    );
  } catch (e) {
    const msg = e instanceof GeminiError ? `${e.kind}: ${e.message}` : String(e);
    check('live grading completed', false, msg);
  }

  console.log(`\n${'='.repeat(60)}\n${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

void main();
