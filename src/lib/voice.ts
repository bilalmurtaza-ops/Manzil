import { useCallback, useRef, useState } from 'react';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
  type ExpoSpeechRecognitionErrorEvent,
} from 'expo-speech-recognition';

/**
 * On-device speech-to-text for the Ustaad chat input. Everything here runs
 * fully on the phone (no network call, no Gemini quota) — the transcript is
 * handed to the existing text pipeline exactly like a typed message.
 *
 * API confirmed directly against the installed package's shipped .d.ts files
 * (not the README), since its latest release is versioned for Expo SDK 56
 * (no sdk-57 dist-tag exists yet at time of writing) — this must be smoke
 * tested on a real device build before being trusted.
 */

export type VoiceLang = 'en-US' | 'ur-PK';

const ERROR_MESSAGES: Partial<Record<string, string>> = {
  'not-allowed': 'Microphone or speech recognition permission was denied.',
  'no-speech': "Didn't catch that — try again.",
  network: 'No internet connection needed for voice, but the recognizer failed. Try again.',
  'language-not-supported': 'This language is not supported on your device.',
  'service-not-allowed': 'Voice input is not available on this device right now.',
};

function friendlyError(e: ExpoSpeechRecognitionErrorEvent): string {
  return ERROR_MESSAGES[e.error] ?? e.message ?? 'Voice input failed. Try again.';
}

export async function requestSpeechPermissions(): Promise<boolean> {
  try {
    const perm = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    return perm.granted;
  } catch {
    return false;
  }
}

/** Cheap synchronous capability check for gating the mic UI — web/unsupported
 * environments degrade to text-only input rather than showing a dead button. */
export function isVoiceSupported(): boolean {
  try {
    return ExpoSpeechRecognitionModule.isRecognitionAvailable();
  } catch {
    return false;
  }
}

export interface UseSpeechTranscriptResult {
  /** Committed (isFinal) text accumulated so far this session. */
  transcript: string;
  /** Latest not-yet-final partial, for a live caption — replaces, does not append. */
  interimText: string;
  /** Raw -2..10 from the last volumechange tick; values <= 0 are inaudible. */
  volume: number;
  /** Timestamp of the last non-empty result event (final or interim). */
  lastResultAt: number;
  isRecognizing: boolean;
  error: string | null;
  /** Resolves false on permission denial or an unavailable recognizer; true once dispatched. */
  start: (lang: VoiceLang) => Promise<boolean>;
  stop: () => void;
}

export function useSpeechTranscript(): UseSpeechTranscriptResult {
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [volume, setVolume] = useState(-2);
  const [lastResultAt, setLastResultAt] = useState(0);
  const [isRecognizing, setIsRecognizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finalizedRef = useRef('');

  useSpeechRecognitionEvent('start', () => setIsRecognizing(true));
  useSpeechRecognitionEvent('end', () => setIsRecognizing(false));

  useSpeechRecognitionEvent('result', (e) => {
    const text = e.results[0]?.transcript ?? '';
    if (!text) return;
    setLastResultAt(Date.now());
    if (e.isFinal) {
      finalizedRef.current = [finalizedRef.current, text].filter(Boolean).join(' ');
      setTranscript(finalizedRef.current);
      setInterimText('');
    } else {
      setInterimText(text);
    }
  });

  useSpeechRecognitionEvent('volumechange', (e) => {
    setVolume(e.value);
    setLastResultAt((prev) => (e.value > 0 ? Date.now() : prev));
  });

  useSpeechRecognitionEvent('error', (e) => {
    if (__DEV__) console.log('[voice] error', e);
    setError(friendlyError(e));
    setIsRecognizing(false);
  });

  const start = useCallback(async (lang: VoiceLang): Promise<boolean> => {
    setError(null);
    finalizedRef.current = '';
    setTranscript('');
    setInterimText('');
    setVolume(-2);
    setLastResultAt(0);

    const granted = await requestSpeechPermissions();
    if (!granted) {
      setError('Microphone or speech recognition permission was denied.');
      return false;
    }
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      setError('Voice input is not available on this device.');
      return false;
    }
    try {
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        continuous: true,
        volumeChangeEventOptions: { enabled: true, intervalMillis: 100 },
      });
      // isRecognizing flips true on the native 'start' event, not here — that way a
      // silent native failure (error event instead of start) never leaves us stuck
      // believing we're recording when we're not.
      return true;
    } catch {
      setError('Could not start voice input.');
      return false;
    }
  }, []);

  const stop = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      // 'end' event still fires / isRecognizing still settles regardless.
    }
  }, []);

  return { transcript, interimText, volume, lastResultAt, isRecognizing, error, start, stop };
}
