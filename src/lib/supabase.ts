/**
 * Deliberately NOT using `react-native-url-polyfill` here.
 *
 * That package exists to patch React Native's old "homemade" URL/URLSearchParams
 * shim, which used to throw errors like "URL.hostname is not implemented" on
 * Hermes. Expo SDK 57 / React Native 0.86 replaced that shim with a correct,
 * complete native implementation, so the polyfill is no longer needed here.
 *
 * Installing it anyway is actively harmful: `setupURLPolyfill()` unconditionally
 * runs `globalThis.URL = <the polyfill's own reimplementation>`, which DOWNGRADES
 * RN 0.86's new built-in URL to a years-old third-party class that predates and
 * was never tested against RN 0.86's networking internals — globally, for every
 * fetch in the app, not just Supabase's own requests. This was confirmed as the
 * root cause of a real regression: after adding it, Gemini calls in gemini.ts
 * started failing on native (misreported as "offline" — see the narrower error
 * classification there) while web stayed unaffected, because the polyfill only
 * activates off-web (`Platform.OS !== 'web'`) and Gemini's calls are otherwise
 * identical in shape to a working curl/browser request. Do not re-add it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client for cloud backup.
 *
 * Cloud backup is entirely optional: a build without these env vars must still
 * run normally, with the backup UI degrading to a calm "not set up" state and
 * the local file export/import still fully working. Every caller therefore
 * checks `isCloudConfigured()` (or handles a null client) rather than assuming.
 *
 * The anon key ships client-side. That is only safe because Row Level Security
 * on `public.backups` has no policy for the `anon` role at all, so this key by
 * itself can read and write nothing — a session is required for every row.
 * The `service_role` key must never appear in this repo or in any client build.
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

/** Default budget for a single request. A 150 KB payload on a slow Pakistani
 *  connection needs real headroom, but nothing may hang forever. */
const REQUEST_TIMEOUT_MS = 25_000;

/** Cheap gate every backup entry point checks first. */
export function isCloudConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

/**
 * Single chokepoint bounding EVERY Supabase call — auth, select, upsert alike.
 * Mirrors the AbortController pattern in gemini.ts: a hung request surfaces as
 * an AbortError that the caller maps to a retryable failure, instead of leaving
 * a spinner on screen forever.
 */
const timeoutFetch: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  // Respect a caller-supplied signal too, without dropping our own timeout.
  const callerSignal = init?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
};

let client: SupabaseClient | null = null;

/**
 * Lazily-created singleton. Returns null when unconfigured rather than throwing
 * at module scope — importing this file must never be able to crash a screen.
 */
export function getSupabase(): SupabaseClient | null {
  if (!isCloudConfigured()) return null;
  if (client) return client;

  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // Session lives in AsyncStorage under its own key, entirely separate from
      // 'manzil-store'. A reinstall wipes it, which is load-bearing: no session
      // means a fresh install cannot upload over a good cloud backup.
      storage: AsyncStorage,
      storageKey: 'manzil-auth-v1',
      autoRefreshToken: true,
      persistSession: true,
      // No deep links and no OAuth in this app; leaving this on makes supabase-js
      // inspect and rewrite the URL on web for no benefit.
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: { fetch: timeoutFetch },
    // Realtime is never used — backup is request/response only.
    realtime: { params: { eventsPerSecond: 1 } },
  });

  return client;
}

/**
 * Token refresh while the app is foregrounded. Called from the backup scheduler's
 * AppState handling on native only; on web the browser tab handles this itself.
 *
 * Note on storage: the refresh token sits in AsyncStorage in plaintext rather than
 * SecureStore. The documented LargeSecureStore workaround needs expo-secure-store +
 * aes-js + react-native-get-random-values and does not work on web, which is this
 * project's primary QA path (`npm run web`). Accepted trade-off: the token grants
 * access only to this student's own backup row, never to anyone else's.
 */
export function startAuthAutoRefresh(): void {
  try {
    getSupabase()?.auth.startAutoRefresh();
  } catch {
    // Never let a refresh-plumbing failure reach a render.
  }
}

export function stopAuthAutoRefresh(): void {
  try {
    getSupabase()?.auth.stopAutoRefresh();
  } catch {
    // As above.
  }
}
