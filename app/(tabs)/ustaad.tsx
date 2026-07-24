import * as Haptics from 'expo-haptics';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeInUp, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MicIcon, StopIcon } from '../../src/components/icons';
import { Screen } from '../../src/components/Screen';
import { VoiceWaveform } from '../../src/components/VoiceWaveform';
import { askUstaad, GeminiError } from '../../src/lib/gemini';
import type { ChatMessage } from '../../src/lib/types';
import { isVoiceSupported, useSpeechTranscript, type VoiceLang } from '../../src/lib/voice';
import { useAppStore } from '../../src/store/useAppStore';
import { color, font, radius, space, type } from '../../src/theme/tokens';

type VoiceUIState =
  | 'idle-text'
  | 'starting'
  | 'recording-listening'
  | 'recording-silence'
  | 'finalizing'
  | 'voice-error';

const SILENCE_CUTOFF_MS = 10_000;
const SILENCE_DEBOUNCE_MS = 700;

const QUICK_PROMPTS = [
  'Explain this simply',
  'Write a 5-mark board answer',
  'اردو میں سمجھائیں',
  'Make a mnemonic for me',
  'Most important questions of this chapter?',
];

let idCounter = 0;
const nextId = () => `c${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export default function UstaadScreen() {
  const insets = useSafeAreaInsets();
  const profile = useAppStore((s) => s.profile);
  const chatHistory = useAppStore((s) => s.chatHistory);
  const appendChat = useAppStore((s) => s.appendChat);
  const clearChat = useAppStore((s) => s.clearChat);

  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  // ---------- Voice input ----------
  const voiceSupported = useMemo(() => Platform.OS !== 'web' && isVoiceSupported(), []);
  const [voiceState, setVoiceState] = useState<VoiceUIState>('idle-text');
  const [voiceLang, setVoiceLang] = useState<VoiceLang>('en-US');
  const [voiceErrorMsg, setVoiceErrorMsg] = useState<string | null>(null);
  const speech = useSpeechTranscript();
  const level = useSharedValue(0); // 0-1 normalized amplitude, feeds VoiceWaveform
  const silenceTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const voiceErrorTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasFinalizedRef = useRef(false);
  const sendRef = useRef<(text: string) => void>(() => {});

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || busy || !profile) return;
    setError(null);
    setInput('');
    setBusy(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const userMsg: ChatMessage = {
      id: nextId(),
      role: 'user',
      text: message,
      createdAt: new Date().toISOString(),
    };
    appendChat(userMsg);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);

    try {
      const reply = await askUstaad(profile, chatHistory, message);
      appendChat({ id: nextId(), role: 'model', text: reply, createdAt: new Date().toISOString() });
      Haptics.selectionAsync();
    } catch (e) {
      setError(e instanceof GeminiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    }
  };
  sendRef.current = send;

  // Single funnel for manual stop, the 10s silence timeout, an early native 'end' event, and
  // app backgrounding — hasFinalizedRef stops a race between two triggers double-firing.
  const requestFinalize = useCallback(() => {
    if (hasFinalizedRef.current) return;
    hasFinalizedRef.current = true;
    if (silenceTimeoutRef.current) {
      clearTimeout(silenceTimeoutRef.current);
      silenceTimeoutRef.current = null;
    }
    setVoiceState('finalizing');
    speech.stop();
    // speech.stop is itself a stable (empty-deps) useCallback in useSpeechTranscript, unlike
    // the `speech` object literal which is new every render — depending on it directly keeps
    // requestFinalize stable too, so the AppState listener effect below doesn't needlessly
    // resubscribe on every render.
  }, [speech.stop]);

  // Native recognizer can end on its own (OS-level silence timeout, error, etc.) — treat that
  // exactly like a manual stop rather than leaving the UI stuck believing it's still recording.
  useEffect(() => {
    if (!speech.isRecognizing && (voiceState === 'recording-listening' || voiceState === 'recording-silence')) {
      requestFinalize();
    }
  }, [speech.isRecognizing, voiceState, requestFinalize]);

  // Once genuinely stopped, send whatever was captured (folding in a still-pending partial so
  // the last few words aren't dropped) and reset. Fires immediately if the recognizer had
  // already ended, or waits for the native 'end' event (and its trailing final result) after
  // an explicit stop() call.
  useEffect(() => {
    if (voiceState !== 'finalizing' || speech.isRecognizing) return;
    const full = [speech.transcript, speech.interimText].filter(Boolean).join(' ').trim();
    setVoiceState('idle-text');
    hasFinalizedRef.current = false;
    if (full) sendRef.current(full);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState, speech.isRecognizing]);

  // 'starting' -> 'recording-listening' once the native side confirms it actually started
  // (never optimistically, so a silent native failure can't leave us falsely "recording").
  useEffect(() => {
    if (voiceState === 'starting' && speech.isRecognizing) setVoiceState('recording-listening');
  }, [speech.isRecognizing, voiceState]);

  // Live VAD: waveform bars always reflect raw amplitude; only the silence *timer* depends on
  // the classified boolean below. Combine rule matches the plan: silence requires BOTH the
  // volume reading and the recognizer's own result stream to agree, avoiding false cutoffs from
  // ambient noise (volume alone) or a lagging recognizer (result-timing alone).
  useEffect(() => {
    if (voiceState !== 'recording-listening' && voiceState !== 'recording-silence') return;
    const norm = Math.max(0, Math.min(1, (speech.volume + 2) / 12)); // -2..10 -> 0..1
    level.value = withTiming(norm, { duration: 80 });

    const isSilentNow = speech.volume <= 0 && Date.now() - speech.lastResultAt > SILENCE_DEBOUNCE_MS;
    if (!isSilentNow) {
      if (silenceTimeoutRef.current) {
        clearTimeout(silenceTimeoutRef.current);
        silenceTimeoutRef.current = null;
      }
      if (voiceState !== 'recording-listening') setVoiceState('recording-listening');
    } else if (!silenceTimeoutRef.current) {
      setVoiceState('recording-silence');
      silenceTimeoutRef.current = setTimeout(requestFinalize, SILENCE_CUTOFF_MS);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speech.volume, speech.lastResultAt]);

  // A native/permission error at any point during voice mode surfaces briefly, then resets.
  useEffect(() => {
    if (!speech.error || voiceState === 'idle-text' || voiceState === 'voice-error') return;
    setVoiceErrorMsg(speech.error);
    setVoiceState('voice-error');
    if (voiceErrorTimeoutRef.current) clearTimeout(voiceErrorTimeoutRef.current);
    voiceErrorTimeoutRef.current = setTimeout(() => setVoiceState('idle-text'), 2500);
  }, [speech.error, voiceState]);

  // Backgrounding mid-recording: finalize exactly like a manual stop rather than leaving a
  // dangling session running (battery) or resuming into an ambiguous state on foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active' && (voiceState === 'recording-listening' || voiceState === 'recording-silence')) {
        requestFinalize();
      }
    });
    return () => sub.remove();
  }, [voiceState, requestFinalize]);

  // Stop any active recording and clear timers on unmount.
  useEffect(() => {
    return () => {
      if (silenceTimeoutRef.current) clearTimeout(silenceTimeoutRef.current);
      if (voiceErrorTimeoutRef.current) clearTimeout(voiceErrorTimeoutRef.current);
      speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startVoice = async () => {
    if (busy || voiceState !== 'idle-text') return;
    Keyboard.dismiss();
    Haptics.selectionAsync();
    setVoiceState('starting');
    const ok = await speech.start(voiceLang);
    if (!ok) {
      setVoiceErrorMsg(speech.error ?? 'Could not start voice input.');
      setVoiceState('voice-error');
      if (voiceErrorTimeoutRef.current) clearTimeout(voiceErrorTimeoutRef.current);
      voiceErrorTimeoutRef.current = setTimeout(() => setVoiceState('idle-text'), 2500);
    }
  };

  const toggleVoiceLang = () => {
    Haptics.selectionAsync();
    setVoiceLang((l) => (l === 'en-US' ? 'ur-PK' : 'en-US'));
  };

  const voiceActive = voiceState !== 'idle-text';
  const waveformActive = voiceState === 'recording-listening' || voiceState === 'recording-silence';
  const captionText =
    voiceState === 'voice-error'
      ? voiceErrorMsg
      : speech.interimText || speech.transcript || (voiceState === 'starting' ? 'Listening…' : '');

  return (
    <Screen bleed>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.headerUrdu}>استاد</Text>
            <Text style={styles.headerTitle}>Ustaad AI</Text>
          </View>
          {chatHistory.length > 0 && (
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                clearChat();
              }}
              hitSlop={10}
            >
              <Text style={styles.clearText}>Clear</Text>
            </Pressable>
          )}
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 12 }}
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
        >
          {chatHistory.length === 0 && (
            <Animated.View entering={FadeInDown.duration(400)} style={styles.emptyWrap}>
              <Text style={styles.emptyUrdu}>پوچھو، جھجکو مت</Text>
              <Text style={styles.emptyTitle}>
                Ask anything from your syllabus — in English, Urdu, or Roman Urdu.
              </Text>
              <Text style={styles.emptySub}>
                Ustaad knows your class, group and board. It answers the way marks are actually
                earned in BISE papers.
              </Text>
            </Animated.View>
          )}

          {chatHistory.map((m) => (
            <View
              key={m.id}
              style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleModel]}
            >
              <Text style={m.role === 'user' ? styles.bubbleUserText : styles.bubbleModelText}>
                {m.text}
              </Text>
              {m.role === 'model' && (
                <Text style={styles.aiDisclaimer}>Ustaad is AI and can make mistakes. Verify important answers.</Text>
              )}
            </View>
          ))}

          {busy && (
            <Animated.View
              entering={FadeInUp.duration(250)}
              style={[styles.bubble, styles.bubbleModel, styles.thinking]}
            >
              <ActivityIndicator size="small" color={color.greenMid} />
              <Text style={styles.thinkingText}>استاد سوچ رہے ہیں…</Text>
            </Animated.View>
          )}

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </ScrollView>

        {/* Quick prompts, or the live voice caption in the same slot while recording */}
        {voiceActive ? (
          <Animated.View entering={FadeIn.duration(200)} style={styles.captionRow}>
            <Text
              style={[styles.captionText, voiceState === 'voice-error' && styles.captionTextError]}
              numberOfLines={2}
            >
              {captionText || ' '}
            </Text>
          </Animated.View>
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
            style={{ flexGrow: 0 }}
          >
            {QUICK_PROMPTS.map((p) => (
              <Pressable key={p} style={styles.chip} onPress={() => send(p)}>
                <Text style={styles.chipText}>{p}</Text>
              </Pressable>
            ))}
          </ScrollView>
        )}

        {/* Input — swaps to the voice waveform while a voice turn is active, same row height */}
        <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom - 6, 8) }]}>
          {voiceActive ? (
            <>
              <View style={styles.wavePill}>
                <VoiceWaveform level={level} active={waveformActive} height={36} />
              </View>
              <Pressable style={styles.stopButton} onPress={requestFinalize} hitSlop={6}>
                <StopIcon size={16} color={color.paperOnDark} />
              </Pressable>
            </>
          ) : (
            <>
              <TextInput
                value={input}
                onChangeText={setInput}
                placeholder="Ask Ustaad…"
                placeholderTextColor={color.inkFaint}
                style={styles.input}
                multiline
                maxLength={600}
              />
              {voiceSupported && (
                <Pressable
                  style={[styles.langToggle, busy && { opacity: 0.4 }]}
                  onPress={toggleVoiceLang}
                  disabled={busy}
                  hitSlop={4}
                >
                  <Text style={styles.langToggleText}>{voiceLang === 'en-US' ? 'EN' : 'اردو'}</Text>
                </Pressable>
              )}
              {voiceSupported && (
                <Pressable
                  style={[styles.micButton, busy && { opacity: 0.4 }]}
                  onPress={startVoice}
                  disabled={busy}
                  hitSlop={4}
                >
                  <MicIcon size={19} color={color.greenDeep} />
                </Pressable>
              )}
              <Pressable
                style={[styles.sendButton, (!input.trim() || busy) && { opacity: 0.4 }]}
                onPress={() => send(input)}
                disabled={!input.trim() || busy}
              >
                <Text style={styles.sendText}>↑</Text>
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.lg,
    marginBottom: space.sm,
  },
  headerUrdu: { fontFamily: font.urdu, fontSize: 14, lineHeight: 34, color: color.greenMid },
  headerTitle: { ...type.title, color: color.ink, marginTop: -4 },
  clearText: { ...type.smallMedium, color: color.inkFaint },

  emptyWrap: {
    backgroundColor: color.cardWarm,
    borderRadius: radius.lg,
    padding: space.xl,
    marginTop: space.md,
  },
  emptyUrdu: { fontFamily: font.urduBold, fontSize: 20, lineHeight: 48, color: color.green },
  emptyTitle: { ...type.bodyMedium, color: color.ink, marginTop: 2 },
  emptySub: { ...type.small, color: color.inkSoft, marginTop: 8, lineHeight: 19 },

  bubble: {
    maxWidth: '86%',
    borderRadius: radius.lg,
    paddingHorizontal: 15,
    paddingVertical: 11,
    marginTop: 10,
  },
  bubbleUser: {
    alignSelf: 'flex-end',
    backgroundColor: color.green,
    borderBottomRightRadius: 6,
  },
  bubbleModel: {
    alignSelf: 'flex-start',
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
    borderBottomLeftRadius: 6,
  },
  bubbleUserText: { ...type.body, color: color.paperOnDark },
  bubbleModelText: { ...type.body, color: color.ink },
  aiDisclaimer: {
    ...type.small,
    fontSize: 10.5,
    lineHeight: 14,
    color: color.inkFaint,
    marginTop: 6,
  },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  thinkingText: { fontFamily: font.urdu, fontSize: 12, lineHeight: 30, color: color.inkSoft },

  errorCard: {
    backgroundColor: color.rustSoft,
    borderRadius: radius.md,
    padding: 12,
    marginTop: 10,
  },
  errorText: { ...type.small, color: color.rust },

  chipsRow: { gap: 8, paddingHorizontal: space.lg, paddingVertical: 8 },
  chip: {
    backgroundColor: color.greenSoft,
    borderRadius: radius.full,
    paddingHorizontal: 14,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: { ...type.smallMedium, color: color.greenDeep },

  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: space.lg,
    paddingTop: 4,
  },
  input: {
    flex: 1,
    minHeight: 46,
    maxHeight: 120,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: color.lineStrong,
    backgroundColor: color.card,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    fontFamily: font.regular,
    fontSize: 15,
    color: color.ink,
  },
  sendButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: color.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: { fontSize: 20, color: color.paperOnDark, fontFamily: font.bold },

  langToggle: {
    height: 46,
    minWidth: 38,
    paddingHorizontal: 8,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: color.lineStrong,
    backgroundColor: color.cardWarm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langToggleText: { fontFamily: font.semibold, fontSize: 12, color: color.inkSoft },
  micButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: color.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  captionRow: { paddingHorizontal: space.lg, paddingVertical: 8, minHeight: 34 },
  captionText: { ...type.small, color: color.inkSoft, lineHeight: 18 },
  captionTextError: { color: color.rust },

  wavePill: {
    flex: 1,
    height: 46,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: color.lineStrong,
    backgroundColor: color.card,
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  stopButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: color.rust,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
