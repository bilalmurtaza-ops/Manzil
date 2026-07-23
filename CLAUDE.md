# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## This is a contest submission — read before touching anything

Manzil is being entered into a competition and winning is the goal, not "it runs." Judging includes Functionality, UI/UX, Demo, AI Integration, and Practical Usefulness — a change that's technically correct but looks unfinished, feels slow, or breaks under a judge's exploratory tapping is a loss condition. Concretely, on this codebase that means:

- **Never fabricate Pakistani curriculum content.** Subject names, chapter titles, pairing-scheme weights — every one of these has already been wrong once from confident guessing (see `src/data/syllabus.ts` header). If you touch syllabus data, verify it against at least 2 independent legitimate sources (or 1 official PCTB/BISE source), explicitly check the source is dated to the *current* curriculum cycle (Class 9 uses different, newer books than Class 10 — a correct-looking source for the wrong year is worse than no source), and never let unverified findings overwrite data that's already confirmed correct. When evidence is thin, say so in the data/comments rather than shipping a confident-sounding placeholder.
- **Never add a single-point-of-failure AI call.** Every Gemini call in `src/lib/gemini.ts` goes through a model chain (`TEXT_CHAIN` / `VISION_CHAIN`) that falls forward on failure — this exists because individual models have genuinely gone down mid-session and because one tier measured ~11x slower on a specific call shape (image + JSON schema) than assumed. A new AI feature bolted on as one bare `fetch` to one model is a regression, not a shortcut. If a call's real-world latency/behavior isn't already proven elsewhere in this file, test it against the live API before trusting it — `tsc` cannot catch a slow model or a bad fallback path.
- **Every failure mode must degrade gracefully, never hard-fail or dead-end.** Typed `GeminiError` + user-facing messages is the existing standard (offline, missing key, API error, unparseable response all have distinct copy). No AI feature should be able to crash a screen or leave the student stuck.
- **`weight` and `difficulty` are load-bearing, not decorative.** They mechanically drive study-time allocation (`planEngine.ts`) and risk-chapter surfacing (`readiness.ts`, threshold `weight >= 4`). A casual edit here silently reshapes every generated plan — treat changes to these fields with the same rigor as changes to the plan engine itself.
- **Run the full regression pass after any data or engine change**, not just `tsc`: `npx expo export --platform android`, then a `tsx` scenario script covering all 6 profile combinations (science-bio/science-cs/arts × class 9/10) exercising `generatePlan()` and `computeReadiness()`. A change that type-checks but produces an empty plan for one profile combo is a shipped bug.
- **Leave the app demoable after every change.** This is a live submission with a deadline, not a long-running product — don't land a change that leaves any screen mid-migration or visibly broken, even temporarily.

## Project

**Manzil** — mobile AI study planner for Pakistani matric students (Punjab BISE boards, Class 9 & 10). Expo SDK 57 + React Native + TypeScript. Local-first (no accounts, no backend); only AI calls hit the network. Built as a contest entry — the differentiator is real embedded pairing-scheme data + a deterministic plan engine, not another chatbot wrapper.

## Critical constraint

Expo SDK 57 changed significantly. Read the versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing native/config code. Do not assume older-SDK APIs.

## Commands

```bash
npm install                                   # uses .npmrc legacy-peer-deps (required — Radix/react-dom peer conflict)
npx expo start                                # dev; scan QR with Expo Go (Android). Camera features need a real device
npm run web                                    # browser QA (react-native-web) — fastest way to verify UI flows
npx tsc --noEmit                               # type-check; run after every change (strict mode)
npx expo export --platform android             # bundle smoke test — catches import/bundling errors tsc misses
npx tsx <script.ts>                            # run a standalone TS script (e.g. plan-engine tests); import via absolute C:/ paths
eas build -p android --profile preview         # produce installable APK (needs Expo login)
# or trigger .github/workflows/build-apk.yml manually (needs EXPO_TOKEN + optional GEMINI_API_KEY repo secrets)
```

There is no test runner configured. Engine logic is verified with throwaway `tsx` scripts (absolute-path imports) + browser walkthrough.

## Setup requirement

AI features need `EXPO_PUBLIC_GEMINI_API_KEY` in `.env` (free key: https://aistudio.google.com/apikey). `.env` is gitignored — never remove that entry, it holds a live key. Without the key, AI screens render but show a graceful "key missing" error. The key ships client-side for the contest build — production would proxy through a server.

## Architecture

**Routing** — expo-router, file-based in `app/`. `app/index.tsx` redirects to `/onboarding` or `/(tabs)/today` based on whether a profile exists (after store hydration). `app/(tabs)/` holds the 5 tabs (today, plan, practice, ustaad, progress) with a fully custom `_layout.tsx` tab bar. Full-screen flows (`focus`, `quiz`, `snap`, `grader`, `review`, `onboarding`) are top-level routes presented as modals/slides.

**State** — single Zustand store `src/store/useAppStore.ts`, persisted to AsyncStorage. Holds `profile`, `plan`, `quizAttempts`, `flashcards`, `chatHistory`, `activeDays`. `hydrated` flag gates routing until persistence loads (`onRehydrateStorage`). `computeStreak()` lives here. All app data flows through this store — there is no other source of truth.

**The two load-bearing subsystems:**

1. **Syllabus dataset** (`src/data/syllabus.ts`) — the moat. Every subject → chapters for Class 9 (new 2025-26 national-curriculum books) and Class 10 (current PCTB books), Science + Arts groups. Each chapter has `weight` (1-5, board-exam weight derived from official 2026 pairing schemes), `difficulty`, `estMinutes`. `subjectsForProfile(class, group)` is the entry point. `boards.ts` — all 9 Punjab boards share this one dataset. When editing chapter data, `weight` drives the plan engine and readiness scoring — it is not cosmetic.

2. **Plan engine** (`src/lib/planEngine.ts`) — pure/deterministic, no AI in the calendar. `generatePlan(profile)` builds day-by-day sessions across three phases: study pass (~62% of runway) → revision cycles → past-paper drills. Weak-confidence subjects get more minutes; block sizes shrink on light days to keep subjects mixed; `fillDays()` is the shared day-filler. `repairPlan()` reflows missed (undone, past-dated) sessions forward within daily capacity without deleting history — called from `today.tsx` on mount. Sessions are dated from `todayISO()` day-index (day 0 = today).

**AI layer** (`src/lib/gemini.ts`) — two ordered model-fallback chains, not one model. `TEXT_CHAIN` = [3.5-flash-lite, 3.1-flash-lite, 3.5-flash], ordered by quota (500/500/20 RPD) — used by `generateQuiz`, `sessionTip`, and `askUstaad` when no image is attached. `VISION_CHAIN` = [3.5-flash, 3.6-flash, 3.5-flash-lite], ordered by speed — Lite tier measured ~11x slower specifically on image+`responseSchema` calls (114s vs ~10-13s) — used by `gradeAnswer`, `cardsFromImage`, and `askUstaad` with an image. `generateChain()` advances to the next model on any `'api'`-kind failure (quota hit, 5xx), so a request only fails once every model in its chain is down; never retries `'key'`/`'offline'`/`'parse'` failures since those recur identically on every model. `APP_CONTEXT` (Pakistan/Matriculation/PCTB framing) is sent as `systemInstruction` on every call — empirically verified to add only ~60 tokens with no safety-filtering or latency effect. Everything feeding app logic uses JSON mode + `responseSchema`, never free-text parsing. Errors throw typed `GeminiError` with `kind: 'offline'|'key'|'api'|'parse'` — screens surface `error.message` directly. When touching this file, verify against the live API with a `tsx` script (set `EXPO_PUBLIC_GEMINI_API_KEY` in the shell env first) — `tsc` can't catch a wrong model ID or a broken fallback path.

**Spaced repetition** (`src/lib/fsrs.ts`) — FSRS-lite, fully offline. `reviewCard(card, rating)` grows/collapses stability → next `due` date. Review queue = cards with `due <= today`.

**Readiness** (`src/lib/readiness.ts`) — `computeReadiness()` blends plan completion (coverage) with quiz mastery, weighted by chapter pairing-scheme weight → per-subject scores, predicted grade band, and `riskChapters` (heavy weight + thin prep). Powers the Progress tab.

## Design system

`src/theme/tokens.ts` is the single source for all styling — `color` (Ink & Ivory + Pakistan green; never introduce raw hex in components), `subjectColor` (per-subject identity), `space`, `radius`, `font`, `type`. Two font families: Space Grotesk (UI) + Noto Nastaliq Urdu (`font.urdu`/`urduBold`, used for Urdu accent text throughout). Icons are hand-authored SVGs in `src/components/icons.tsx` — no icon library. Motion is restrained Reanimated (`FadeInDown` entrances, `ProgressRing` animated stroke); haptics on every meaningful tap via `expo-haptics`. Reusable primitives: `Screen`, `PrimaryButton`, `ProgressRing`, `SessionCard`.

## Conventions

- Absolute-from-`src` relative imports (`../../src/lib/...`); no path alias configured.
- ID generation: local `nextId()` counters per file (timestamp + counter) — not uuid.
- Dates are ISO `yyyy-mm-dd` strings throughout; `todayISO()` / `daysUntil()` in `planEngine.ts` are the shared helpers.
- Fonts load in `app/_layout.tsx`; splash held until loaded. Adding a font family means updating both `_layout.tsx` and `tokens.ts`.
- After editing plan/readiness logic, re-run a `tsx` scenario script (225-day + ~20-day crunch + missed-days repair) before trusting it.
