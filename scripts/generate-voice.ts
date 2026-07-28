/**
 * Build the Focus Guard voice pack.
 *
 * Reads the manifest in `src/lib/focusGuard/voice/lines.ts`, renders every line
 * to `assets/voice/`, synthesises the chime, then rewrites
 * `src/lib/focusGuard/voice/assets.ts` with the static requires Metro needs.
 *
 * Run once; the clips then ship in the APK and play offline forever. There is
 * no runtime TTS anywhere in this app.
 *
 * Usage (PowerShell) — the key comes from the shell env, never the repo, the
 * same convention as scripts/test-gemini-keypool.ts:
 *
 *   $env:ELEVENLABS_API_KEY="<key>"; npx tsx scripts/generate-voice.ts
 *
 * Options:
 *   --list-voices  ask the account what it can actually reach, and the budget
 *   --voice <id>   render only one voice from FOCUS_VOICES (default: all five)
 *   --model <id>   default eleven_multilingual_v2
 *   --force        re-render clips that already exist
 *   --dry-run      write nothing; just report what would be produced
 *
 * SWAPPING VENDORS: replace `synthesize()` and nothing else. The manifest, the
 * asset table, the player and every test stay exactly as they are — which is
 * the whole reason the text lives in a manifest instead of inline in the UI.
 */

const ROOT = 'C:/Users/bilal/Desktop/app';
const OUT_DIR = `${ROOT}/assets/voice`;
const ASSET_TABLE = `${ROOT}/src/lib/focusGuard/voice/assets.ts`;

/**
 * Minimal local declarations instead of @types/node. The app's tsconfig does
 * not pull in node types, and adding them globally would retype timers and
 * break React Native code — the same reason scripts/test-gemini-keypool.ts
 * avoids node builtins.
 */
declare function require(id: string): any;
declare const Buffer: {
  alloc(size: number): BufferLike;
  concat(list: BufferLike[]): BufferLike;
  from(input: ArrayBuffer): BufferLike;
};
interface BufferLike {
  length: number;
  write(s: string, offset?: number): void;
  writeUInt32LE(v: number, offset: number): void;
  writeUInt16LE(v: number, offset: number): void;
  writeInt16LE(v: number, offset: number): void;
}
interface FsLike {
  existsSync(p: string): boolean;
  mkdirSync(p: string, o?: { recursive: boolean }): void;
  writeFileSync(p: string, data: BufferLike | string, enc?: string): void;
  readFileSync(p: string, enc: string): string;
  statSync(p: string): { size: number };
}
const fs: FsLike = require('fs');

/**
 * The key may live in the shell env or in .env — .env is gitignored, and this
 * script never runs in the app, so reading it is safe and saves a step.
 *
 * NOTE the variable is deliberately NOT prefixed `EXPO_PUBLIC_`: that prefix is
 * what makes Expo inline a value into the client bundle. A TTS key has no
 * business shipping to a student's phone, and with pre-rendered clips it never
 * needs to.
 */
function keyFromEnvFile(): string {
  try {
    const raw = fs.readFileSync(`${ROOT}/.env`, 'utf8');
    const line = raw.split(/\r?\n/).find((l: string) => l.startsWith('ELEVENLABS_API_KEY='));
    return line ? line.slice('ELEVENLABS_API_KEY='.length).trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

import {
  ALL_VOICE_FILES,
  CHIME_FILE,
  FOCUS_VOICES,
  VOICE_LINES,
  clipFile,
} from '../src/lib/focusGuard/voice/lines';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DRY = flag('dry-run');
const FORCE = flag('force');
const MODEL_ID = opt('model', 'eleven_multilingual_v2');

const KEY = process.env.ELEVENLABS_API_KEY || keyFromEnvFile();

/**
 * Ask the account what it can actually use, rather than trusting a docs page.
 * Voice availability varies by tier, and a hardcoded id that 404s at generation
 * time is exactly the kind of thing only the live API can tell us.
 */
async function listVoices(): Promise<void> {
  const sub = await fetch('https://api.elevenlabs.io/v1/user/subscription', {
    headers: { 'xi-api-key': KEY },
  });
  if (!sub.ok) {
    console.error(`Key rejected (${sub.status}): ${(await sub.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const s: any = await sub.json();
  console.log(`Tier: ${s.tier}`);
  console.log(`Characters: ${s.character_count} / ${s.character_limit} used this period`);
  const remaining = (s.character_limit ?? 0) - (s.character_count ?? 0);
  console.log(`Remaining: ${remaining}`);

  const res = await fetch('https://api.elevenlabs.io/v2/voices?page_size=100', {
    headers: { 'xi-api-key': KEY },
  });
  if (!res.ok) {
    console.error(`Voice list failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
    process.exit(1);
  }
  const data: any = await res.json();
  const voices = (data.voices ?? []) as any[];
  console.log(`\n${voices.length} voices available to this account:\n`);
  for (const v of voices) {
    const l = v.labels ?? {};
    const bits = [l.gender, l.age, l.accent, l.descriptive ?? l.description, l.use_case]
      .filter(Boolean)
      .join(', ');
    console.log(`  ${String(v.name).padEnd(14)} ${v.voice_id}  [${v.category}] ${bits}`);
  }
}

/**
 * One line -> one mp3. The only vendor-specific function in the codebase.
 *
 * Settings chosen for a study companion rather than an audiobook narrator:
 * high stability so repeated cues sound identical in tone, and modest style so
 * it never sounds theatrical at 1 a.m.
 */
async function synthesize(text: string, elevenId: string): Promise<BufferLike> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${elevenId}?output_format=mp3_44100_64`,
    {
      method: 'POST',
      headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: MODEL_ID,
        voice_settings: { stability: 0.55, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true },
      }),
    },
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`TTS failed (${res.status}): ${detail.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * A soft two-tone chime, synthesised rather than sourced: no vendor, no licence,
 * no download. Sine pair with an exponential decay so it reads as a gentle
 * notification instead of an alarm.
 */
function makeChime(): BufferLike {
  const rate = 44100;
  const seconds = 0.5;
  const n = Math.floor(rate * seconds);
  const pcm = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) {
    const t = i / rate;
    const decay = Math.exp(-4 * t);
    // A perfect fifth (E6 over A5) — consonant and easy to ignore once learned.
    const a = Math.sin(2 * Math.PI * 880 * t);
    const b = t > 0.12 ? Math.sin(2 * Math.PI * 1318.5 * (t - 0.12)) : 0;
    const v = Math.max(-1, Math.min(1, (a * 0.5 + b * 0.5) * decay * 0.35));
    pcm.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** Rewrite assets.ts with one literal require per file — see that file's header. */
function writeAssetTable(files: string[]): void {
  const entries = files
    .map((f) => `  '${f}': require('../../../../assets/voice/${f}'),`)
    .join('\n');
  const body = `/**
 * GENERATED FILE — do not edit by hand.
 * Rewritten by \`npx tsx scripts/generate-voice.ts\` whenever the pack is built.
 *
 * WHY THIS IS GENERATED RATHER THAN WRITTEN: Metro resolves \`require()\` for
 * assets statically, exactly like Expo's inlining of \`process.env.EXPO_PUBLIC_*\`
 * (see \`src/lib/gemini.ts\`). A computed path such as
 * \`require(\\\`../../assets/voice/\${file}\\\`)\` type-checks and then bundles nothing,
 * so every clip needs a literal require. Having the generator own this table is
 * what guarantees the manifest in \`lines.ts\` and the bundled files can never
 * drift apart — a mismatch is impossible rather than merely tested for.
 *
 * A missing file is a BUILD error, not a runtime one, so the table starts empty
 * and stays empty until the pack is generated. With it empty the app builds and
 * runs normally and the voice simply reports itself unavailable.
 */

/** filename from \`lines.ts\` -> Metro asset module id. */
export const VOICE_ASSETS: Record<string, number> = {
${entries}
};

/** False until the pack has been generated. Voice stays silent when false. */
export const VOICE_PACK_INSTALLED = Object.keys(VOICE_ASSETS).length > 0;
`;
  fs.writeFileSync(ASSET_TABLE, body, 'utf8');
}

async function main() {
  if (flag('list-voices')) {
    if (!KEY) {
      console.error('No ELEVENLABS_API_KEY in the shell env or .env.');
      process.exit(1);
    }
    await listVoices();
    return;
  }

  const lines = Object.entries(VOICE_LINES).flatMap(([cue, variants]) =>
    variants.map((v) => ({ cue, ...v })),
  );
  // --voice narrows to a single voice, for re-rendering just one after a change.
  const only = opt('voice', '');
  const voices = only ? FOCUS_VOICES.filter((v) => v.id === only) : FOCUS_VOICES;
  if (voices.length === 0) {
    console.error(`Unknown voice '${only}'. Known: ${FOCUS_VOICES.map((v) => v.id).join(', ')}`);
    process.exit(1);
  }

  const chars = lines.reduce((a, l) => a + l.text.length, 0);
  console.log(`Voice pack: ${lines.length} lines x ${voices.length} voices + 1 chime`);
  console.log(`  model=${MODEL_ID}`);
  console.log(`  ~${chars} characters per voice, ~${chars * voices.length} total`);
  if (DRY) {
    for (const l of lines) console.log(`  [${l.cue}] ${l.file}  "${l.text}"`);
    console.log(`\nVoices: ${voices.map((v) => `${v.id} (${v.name})`).join(', ')}`);
    console.log('--dry-run: nothing written.');
    return;
  }

  if (!KEY) {
    console.error(
      'ELEVENLABS_API_KEY is not set.\n' +
        '  PowerShell:  $env:ELEVENLABS_API_KEY="<key>"; npx tsx scripts/generate-voice.ts\n' +
        'Use --dry-run to preview the pack without a key.',
    );
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // The chime needs no vendor, so write it first — it works even if TTS fails.
  const chimePath = `${OUT_DIR}/${CHIME_FILE}`;
  if (FORCE || !fs.existsSync(chimePath)) {
    fs.writeFileSync(chimePath, makeChime());
    console.log(`  + ${CHIME_FILE} (synthesised)`);
  }

  let made = 0;
  let skipped = 0;
  for (const voice of voices) {
    console.log(`\n${voice.name} (${voice.id}) — ${voice.tagline}`);
    for (const l of lines) {
      const name = clipFile(voice.id, l.file);
      const path = `${OUT_DIR}/${name}`;
      if (!FORCE && fs.existsSync(path)) {
        skipped += 1;
        continue;
      }
      const audio = await synthesize(l.text, voice.elevenId);
      fs.writeFileSync(path, audio);
      made += 1;
      console.log(`  + ${name} (${(audio.length / 1024).toFixed(0)} KB)`);
    }
  }

  // Only claim a pack when every file the manifest names is actually present.
  const missing = ALL_VOICE_FILES.filter((f) => !fs.existsSync(`${OUT_DIR}/${f}`));
  if (missing.length > 0) {
    console.error(`\nIncomplete pack — missing ${missing.length}: ${missing.join(', ')}`);
    process.exit(1);
  }

  writeAssetTable(ALL_VOICE_FILES);
  const bytes = ALL_VOICE_FILES.reduce((a, f) => a + fs.statSync(`${OUT_DIR}/${f}`).size, 0);
  console.log(
    `\nDone: ${made} rendered, ${skipped} already present. ` +
      `${ALL_VOICE_FILES.length} files, ${(bytes / 1024).toFixed(0)} KB total.`,
  );
  console.log('assets.ts rewritten. Run: npx tsx scripts/test-focus-guard.ts');
}

void main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
