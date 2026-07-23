import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CameraIcon } from '../src/components/icons';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { subjectsForProfile } from '../src/data/syllabus';
import { cardsFromImage, GeminiError, type GeneratedCard } from '../src/lib/gemini';
import { newCard } from '../src/lib/fsrs';
import { pickImage } from '../src/lib/images';
import { useAppStore } from '../src/store/useAppStore';
import { color, font, radius, space, subjectColor, type } from '../src/theme/tokens';

let idCounter = 0;
const nextId = () => `f${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export default function SnapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const profile = useAppStore((s) => s.profile);
  const addFlashcards = useAppStore((s) => s.addFlashcards);

  const subjects = useMemo(
    () => (profile ? subjectsForProfile(profile.classLevel, profile.group) : []),
    [profile],
  );

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [cards, setCards] = useState<GeneratedCard[] | null>(null);
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const capture = async (source: 'camera' | 'gallery') => {
    if (!profile || busy) return;
    setError(null);
    const base64 = await pickImage(source);
    if (!base64) return;
    setBusy(true);
    setCards(null);
    setSaved(false);
    try {
      const result = await cardsFromImage(profile, base64);
      setTopic(result.topic);
      setCards(result.cards);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(e instanceof GeminiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (!cards || !subjectId) return;
    addFlashcards(
      cards.map((c) =>
        newCard({ id: nextId(), subjectId, front: c.front, back: c.back }),
      ),
    );
    setSaved(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setTimeout(() => router.back(), 900);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
      <Stack.Screen options={{ animation: 'slide_from_bottom' }} />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <View>
          <Text style={styles.title}>Snap to Study</Text>
          <Text style={styles.subtitle}>Photo of your notes → exam flashcards</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {!cards && !busy && (
          <Animated.View entering={FadeInDown.duration(350)}>
            <View style={styles.heroCard}>
              <CameraIcon size={30} color={color.gold} />
              <Text style={styles.heroText}>
                Photograph a textbook page, your class notes, or the blackboard — AI turns it
                into flashcards that come back for revision at exactly the right time.
              </Text>
            </View>
            <View style={{ gap: 10, marginTop: space.xl }}>
              <PrimaryButton label="Open camera" onPress={() => capture('camera')} />
              <PrimaryButton
                label="Choose from gallery"
                variant="ghost"
                onPress={() => capture('gallery')}
              />
            </View>
            {error && (
              <View style={styles.errorCard}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </Animated.View>
        )}

        {busy && (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={color.green} />
            <Text style={styles.loadingText}>Reading your notes…</Text>
            <Text style={styles.loadingUrdu}>نوٹس پڑھے جا رہے ہیں</Text>
          </View>
        )}

        {cards && (
          <Animated.View entering={FadeInDown.duration(350)}>
            <Text style={styles.topicLabel}>DETECTED TOPIC</Text>
            <Text style={styles.topicText}>{topic}</Text>

            <Text style={styles.sectionLabel}>Which subject do these belong to?</Text>
            <View style={styles.subjectWrap}>
              {subjects.map((s) => {
                const active = subjectId === s.id;
                const tint = subjectColor[s.colorKey] ?? subjectColor.general;
                return (
                  <Pressable
                    key={s.id}
                    style={[
                      styles.subjectChip,
                      active && { backgroundColor: tint.main, borderColor: tint.main },
                    ]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setSubjectId(s.id);
                    }}
                  >
                    <Text style={[styles.subjectChipText, active && { color: color.card }]}>
                      {s.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.sectionLabel}>
              {cards.length} cards generated
            </Text>
            {cards.map((c, i) => (
              <View key={i} style={styles.cardPreview}>
                <Text style={styles.cardFront}>{c.front}</Text>
                <Text style={styles.cardBack}>{c.back}</Text>
              </View>
            ))}

            <View style={{ marginTop: space.lg, gap: 10 }}>
              <PrimaryButton
                label={saved ? 'Saved ✓' : 'Save to my flashcards'}
                onPress={save}
                disabled={!subjectId || saved}
              />
              <PrimaryButton label="Retake photo" variant="ghost" onPress={() => capture('camera')} />
            </View>
          </Animated.View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
  },
  closeText: { fontSize: 20, color: color.inkSoft, fontFamily: font.medium },
  title: { ...type.heading, fontSize: 19, color: color.ink },
  subtitle: { ...type.small, color: color.inkFaint, marginTop: 1 },

  heroCard: {
    backgroundColor: color.inkWash,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: 14,
  },
  heroText: { ...type.body, color: color.fadedOnDark, lineHeight: 21 },

  errorCard: {
    backgroundColor: color.rustSoft,
    borderRadius: radius.md,
    padding: 14,
    marginTop: space.lg,
  },
  errorText: { ...type.small, color: color.rust },

  loadingWrap: { alignItems: 'center', paddingTop: 80 },
  loadingText: { ...type.bodyMedium, color: color.inkSoft, marginTop: 18 },
  loadingUrdu: { fontFamily: font.urdu, fontSize: 13, lineHeight: 32, color: color.inkFaint },

  topicLabel: { ...type.micro, color: color.inkFaint, letterSpacing: 1 },
  topicText: { ...type.title, fontSize: 21, color: color.ink, marginTop: 2 },

  sectionLabel: { ...type.smallMedium, color: color.inkSoft, marginTop: space.xl, marginBottom: 10 },
  subjectWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  subjectChip: {
    height: 34,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    paddingHorizontal: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.card,
  },
  subjectChipText: { ...type.smallMedium, fontSize: 12, color: color.inkSoft },

  cardPreview: {
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    padding: space.lg,
    marginBottom: 8,
  },
  cardFront: { ...type.bodyMedium, color: color.ink },
  cardBack: { ...type.small, color: color.inkSoft, marginTop: 6, lineHeight: 19 },
});
