/**
 * Live verification for the multi-key Gemini pool.
 *
 * `tsc` cannot catch any of what this checks: whether header auth is actually
 * accepted, what a rejected key really answers with, or whether a request
 * survives a dead key sitting in front of a good one. All of it is asserted
 * against the real API.
 *
 * Run (PowerShell), same shell-env convention as test-cloud-backup-live.ts —
 * the script deliberately imports no node builtins so it type-checks under the
 * app's tsconfig, which does not pull in @types/node:
 *
 *   $env:EXPO_PUBLIC_GEMINI_API_KEY="<key>"; npx tsx scripts/test-gemini-keypool.ts
 *
 * Costs ~4 real requests.
 *
 * Note on running under tsx: gemini.ts reads process.env at module load, and
 * in Node that is an ordinary runtime read — so each case sets up its env and
 * then imports a *fresh* copy of the module (cache-busted by query string) to
 * get a pool built from those values. In the real app the same lines are
 * inlined at build time by Metro instead; the pool logic under test is
 * identical either way, only where the strings come from differs.
 */

const ROOT = 'C:/Users/bilal/Desktop/app';
/** Windows absolute paths must be file:// URLs to be dynamically importable. */
const GEMINI_URL = `file:///${ROOT}/src/lib/gemini.ts`;

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const REAL_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';
if (!REAL_KEY) {
  console.error(
    'Set EXPO_PUBLIC_GEMINI_API_KEY in the shell env first (see the header) — the live checks need a working key.',
  );
  process.exit(1);
}
// Shaped like a real key so the failure under test is "rejected", not "malformed".
const BAD_KEY = 'AIzaSyB0000000000000000000000000000000000';

const PROFILE = {
  name: 'Test',
  classLevel: '10' as const,
  group: 'science-bio' as const,
  boardId: 'lahore',
  examDate: '2027-03-01',
  dailyMinutes: 180,
  confidence: {},
};

/** Fresh module instance with a pool built from the given key slots. */
async function loadGemini(slots: (string | undefined)[]) {
  delete process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  for (let n = 1; n <= 10; n += 1) delete process.env[`EXPO_PUBLIC_GEMINI_API_KEY_${n}`];
  if (slots[0]) process.env.EXPO_PUBLIC_GEMINI_API_KEY = slots[0];
  slots.slice(1).forEach((k, i) => {
    if (k) process.env[`EXPO_PUBLIC_GEMINI_API_KEY_${i + 1}`] = k;
  });
  return import(`${GEMINI_URL}?v=${Math.random()}`);
}

async function main() {
  // ---- 1. Raw protocol: does x-goog-api-key actually authenticate? ----
  console.log('\n1. Header auth (x-goog-api-key), no key in the URL');
  {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': REAL_KEY },
      // No thinkingConfig: gemini-3.5-flash-lite 400-rejects thinkingBudget:0
      // (that is why NO_ZERO_THINKING_MODELS exists). Sending it here would
      // produce an INVALID_ARGUMENT that has nothing to do with the header.
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }],
        generationConfig: { maxOutputTokens: 10 },
      }),
    });
    const body = await res.text();
    check('authenticates via header', res.ok, `HTTP ${res.status}`);
    check('URL carries no key', !url.includes('key='));
    if (!res.ok) console.log(`        body: ${body.slice(0, 300)}`);
  }

  // ---- 2. What a rejected key actually answers ----
  console.log('\n2. Rejected-key response shape (drives the retire-this-key branch)');
  let badStatus = 0;
  let badBody = '';
  {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': BAD_KEY },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
          generationConfig: { maxOutputTokens: 10 },
        }),
      },
    );
    badStatus = res.status;
    badBody = await res.text();
    console.log(`        HTTP ${badStatus}: ${badBody.replace(/\s+/g, ' ').slice(0, 220)}`);
    check('rejected key returns 400 or 403', badStatus === 400 || badStatus === 403);
    check(
      'body matches the /api[_ ]?key/i classifier',
      /api[_ ]?key/i.test(badBody),
      'this regex is what retires a key rather than failing the request',
    );
  }

  // ---- 3. A dead key in front of a good one must be invisible ----
  console.log('\n3. Rotation: pool = [invalid, valid]');
  {
    const g = await loadGemini([BAD_KEY, REAL_KEY]);
    check('pool resolved 2 keys', g.geminiKeyPool().total === 2, `got ${g.geminiKeyPool().total}`);
    const started = Date.now();
    const tip = await g.sessionTip(PROFILE, 'Biology', 'Cell Structure', 'revise');
    const ms = Date.now() - started;
    check('request still succeeded', typeof tip === 'string' && tip.length > 0, `${ms}ms`);
    check(
      'bad key retired, so 1 of 2 remains available',
      g.geminiKeyPool().available === 1,
      `available=${g.geminiKeyPool().available}`,
    );
    // The retired key must stay retired — no re-probing it on every call.
    const t0 = Date.now();
    await g.sessionTip(PROFILE, 'Physics', 'Kinematics', 'study');
    console.log(`        second call ${Date.now() - t0}ms (no wasted probe on the dead key)`);
  }

  // ---- 4. Duplicates must not inflate the pool ----
  console.log('\n4. Same key in two slots counts once');
  {
    const g = await loadGemini([REAL_KEY, REAL_KEY, '  ']);
    check('deduped to 1', g.geminiKeyPool().total === 1, `got ${g.geminiKeyPool().total}`);
  }

  // ---- 5. Whole pool bad -> one clear, actionable error ----
  console.log('\n5. Every key rejected');
  {
    const g = await loadGemini([BAD_KEY, BAD_KEY + 'x']);
    try {
      await g.sessionTip(PROFILE, 'Chemistry', 'Acids', 'study');
      check('throws', false, 'unexpectedly succeeded');
    } catch (e: any) {
      check("kind is 'key'", e?.kind === 'key', `kind=${e?.kind}`);
      check('message names the fix', /EXPO_PUBLIC_GEMINI_API_KEY/.test(e?.message ?? ''), e?.message);
      check('no key material leaked into the message', !(e?.message ?? '').includes(BAD_KEY));
    }
  }

  // ---- 6. No keys at all ----
  console.log('\n6. Empty pool');
  {
    const g = await loadGemini([]);
    check('total is 0', g.geminiKeyPool().total === 0);
    try {
      await g.sessionTip(PROFILE, 'Urdu', 'Nazm', 'study');
      check('throws', false, 'unexpectedly succeeded');
    } catch (e: any) {
      check("kind is 'key'", e?.kind === 'key', `kind=${e?.kind}`);
    }
  }

  // --------------------------------------------------------------------
  // Fault injection. Quota exhaustion is the case the whole pool exists for,
  // and it cannot be summoned on demand from the live API — burning 500 real
  // requests to observe one 429 is not a test, it's a tantrum. So from here
  // the transport is stubbed and what's under test is the routing decision:
  // which axis advances, and in what order.
  // --------------------------------------------------------------------
  const realFetch = globalThis.fetch;
  /** Records every attempt as `model/keyLabel` so the exact route is assertable. */
  let calls: string[] = [];
  const keyLabel = (k: string) => (k === 'KEY_A' ? 'A' : k === 'KEY_B' ? 'B' : '?');

  function stub(reply: (model: string, key: string) => Response) {
    calls = [];
    globalThis.fetch = (async (url: any, init: any) => {
      const model = /models\/([^:]+):/.exec(String(url))?.[1] ?? '?';
      const key = String(init?.headers?.['x-goog-api-key'] ?? '');
      calls.push(`${model}/${keyLabel(key)}`);
      return reply(model, key);
    }) as typeof fetch;
  }

  const ok = () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }), {
      status: 200,
    });
  const quota = () =>
    new Response(
      JSON.stringify({
        error: { code: 429, message: 'Resource has been exhausted', status: 'RESOURCE_EXHAUSTED' },
        details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '27s' }],
      }),
      { status: 429 },
    );
  const down = () => new Response('{"error":{"code":503}}', { status: 503 });

  const TEXT_0 = 'gemini-3.5-flash-lite';
  const TEXT_1 = 'gemini-3.1-flash-lite';

  try {
    // ---- 7. Quota rotates the KEY and stays on the same model ----
    console.log('\n7. 429 on key A -> same model, key B');
    {
      const g = await loadGemini(['KEY_A', 'KEY_B']);
      stub((_m, k) => (k === 'KEY_A' ? quota() : ok()));
      const out = await g.sessionTip(PROFILE, 'Biology', 'Cell', 'study');
      check('succeeded', out.length > 0);
      check(
        'route was A then B on the SAME model',
        calls.join(' -> ') === `${TEXT_0}/A -> ${TEXT_0}/B`,
        calls.join(' -> '),
      );
      check('never fell to a slower model', !calls.some((c) => c.startsWith(TEXT_1)));

      // ---- 8. Cooldown: the exhausted pair is not probed again ----
      stub((_m, k) => (k === 'KEY_A' ? quota() : ok()));
      await g.sessionTip(PROFILE, 'Physics', 'Motion', 'study');
      check(
        'next request skips the exhausted key entirely',
        calls.join(' -> ') === `${TEXT_0}/B`,
        calls.join(' -> '),
      );
    }

    // ---- 9. A 5xx rotates the MODEL, not the key ----
    console.log('\n9. 503 on model 1 -> next model, not next key');
    {
      const g = await loadGemini(['KEY_A', 'KEY_B']);
      stub((m) => (m === TEXT_0 ? down() : ok()));
      const out = await g.sessionTip(PROFILE, 'Chemistry', 'Acids', 'study');
      check('succeeded', out.length > 0);
      check(
        'did not burn key B on a model that is down',
        calls.join(' -> ') === `${TEXT_0}/A -> ${TEXT_1}/A`,
        calls.join(' -> '),
      );
    }

    // ---- 10. Genuinely exhausted everywhere ----
    console.log('\n10. Every model on every key out of quota');
    {
      const g = await loadGemini(['KEY_A', 'KEY_B']);
      stub(() => quota());
      try {
        await g.sessionTip(PROFILE, 'Urdu', 'Nazm', 'study');
        check('throws', false, 'unexpectedly succeeded');
      } catch (e: any) {
        check('tried all 3 models x 2 keys', calls.length === 6, `${calls.length} attempts`);
        check("kind is 'api' (retryable), not 'key'", e?.kind === 'api', `kind=${e?.kind}`);
      }

      // ---- 11. Stale cooldowns must never be the reason a student is refused ----
      stub(() => ok());
      const out = await g.sessionTip(PROFILE, 'Urdu', 'Nazm', 'study');
      check('recovers once quota returns, despite every pair cooling', out.length > 0);
      check('made a real attempt rather than refusing', calls.length >= 1, `${calls.length} attempts`);
    }

    // ---- 12. Offline stops immediately ----
    console.log('\n12. Dead network');
    {
      const g = await loadGemini(['KEY_A', 'KEY_B']);
      calls = [];
      globalThis.fetch = (async (url: any) => {
        calls.push(String(url));
        throw new Error('Network request failed');
      }) as typeof fetch;
      try {
        await g.sessionTip(PROFILE, 'Maths', 'Algebra', 'study');
        check('throws', false, 'unexpectedly succeeded');
      } catch (e: any) {
        check("kind is 'offline'", e?.kind === 'offline', `kind=${e?.kind}`);
        check(
          'gave up after 1 attempt, no pointless key/model grinding',
          calls.length === 1,
          `${calls.length} attempts`,
        );
      }
    }
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
