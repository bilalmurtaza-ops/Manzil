# Manzil — منزل

**AI study planner for Pakistani matric students (Punjab Boards).**

Over 500,000 students failed matric in 2025 — overwhelmingly not for lack of ability, but for lack of a plan. Manzil is a personal AI ustaad that knows the PCTB syllabus, the official pairing schemes, and exactly how many days remain — and tells each student precisely what to study today.

## What's inside

- **Deterministic plan engine** — a day-by-day schedule computed from real chapter data (exam weight from the 2026 pairing schemes, student confidence, daily time, days to exam). Three phases: study pass → revision cycles → past-paper drills. Works fully offline, regenerates instantly, and silently self-repairs when days are missed.
- **Embedded syllabus dataset** — every subject and chapter for Class 9 (new 2025-26 national curriculum books) and Class 10 (current PCTB books), Science and Arts groups, with per-chapter pairing-scheme weightage. One dataset covers all 9 Punjab BISE boards.
- **Ustaad AI** — Gemini-powered tutor that answers in English, Urdu, or Roman Urdu, in board-exam style (5-mark answers, mnemonics, important questions).
- **Board-style chapter quizzes** — AI-generated MCQs in BISE objective-paper style; results feed the readiness model.
- **Answer Grader** — photograph a handwritten long answer; AI marks it like a BISE examiner and shows where marks leaked.
- **Snap to Study** — photograph textbook pages or class notes; AI turns them into flashcards.
- **Spaced repetition** — FSRS-lite scheduler brings each card back right before it would be forgotten. Fully local.
- **Readiness analytics** — per-subject readiness rings, predicted grade band, and an "exam-day risk" list of heavy pairing-scheme chapters with thin preparation.
- **Local-first** — no accounts, no signup. Everything lives on the phone; only AI calls need internet, and AI outputs are cached.

## Setup

1. `npm install`
2. Get a free Gemini API key at https://aistudio.google.com/apikey and put it in `.env`:
   ```
   EXPO_PUBLIC_GEMINI_API_KEY=your_key_here
   ```
   Optionally add spare keys from other Google accounts. Each one is a separate
   free-tier quota bucket, so Ustaad keeps answering after the first is spent:
   ```
   EXPO_PUBLIC_GEMINI_API_KEY_1=second_account_key
   EXPO_PUBLIC_GEMINI_API_KEY_2=third_account_key
   ```
   Slots `_1` … `_10` are recognised. Settings → Data & Storage shows how many
   the build actually picked up — check it after adding one.
3. Run on your phone: `npx expo start` then scan the QR with Expo Go (Android).

> Note: the API key ships inside the client for this contest build. A production release would proxy Gemini calls through a small server instead.

## Building the APK

```
npm i -g eas-cli
eas login
eas build -p android --profile preview
```

The build link EAS prints is the installable APK.

## Stack

Expo SDK 57 · React Native · TypeScript · expo-router · Reanimated · Zustand (AsyncStorage persistence) · react-native-svg · Google Gemini (`gemini-2.5-flash`, JSON-mode structured outputs, multimodal).
