import * as Haptics from 'expo-haptics';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../src/components/Screen';
import { askUstaad, GeminiError } from '../../src/lib/gemini';
import type { ChatMessage } from '../../src/lib/types';
import { useAppStore } from '../../src/store/useAppStore';
import { color, font, radius, space, type } from '../../src/theme/tokens';

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

        {/* Quick prompts */}
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

        {/* Input */}
        <View style={[styles.inputRow, { paddingBottom: Math.max(insets.bottom - 6, 8) }]}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask Ustaad…"
            placeholderTextColor={color.inkFaint}
            style={styles.input}
            multiline
            maxLength={600}
          />
          <Pressable
            style={[styles.sendButton, (!input.trim() || busy) && { opacity: 0.4 }]}
            onPress={() => send(input)}
            disabled={!input.trim() || busy}
          >
            <Text style={styles.sendText}>↑</Text>
          </Pressable>
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
});
