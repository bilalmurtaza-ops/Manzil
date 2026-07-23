import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { getSubject } from '../src/data/syllabus';
import { reviewCard, type Rating } from '../src/lib/fsrs';
import { todayISO } from '../src/lib/planEngine';
import { useAppStore } from '../src/store/useAppStore';
import { color, font, radius, space, subjectColor, type } from '../src/theme/tokens';

const RATINGS: { rating: Rating; label: string; sub: string; tint: string }[] = [
  { rating: 'again', label: 'Again', sub: 'forgot', tint: color.rust },
  { rating: 'hard', label: 'Hard', sub: 'barely', tint: color.gold },
  { rating: 'good', label: 'Good', sub: 'knew it', tint: color.greenMid },
  { rating: 'easy', label: 'Easy', sub: 'instant', tint: color.green },
];

export default function ReviewScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flashcards = useAppStore((s) => s.flashcards);
  const updateFlashcard = useAppStore((s) => s.updateFlashcard);

  // Snapshot the due queue once; ratings update the store behind the scenes.
  const [queue] = useState(() =>
    flashcards
      .filter((c) => c.due <= todayISO())
      .sort((a, b) => (a.due < b.due ? -1 : 1))
      .map((c) => c.id),
  );
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  const card = useMemo(
    () => flashcards.find((c) => c.id === queue[index]),
    [flashcards, queue, index],
  );
  const subject = card ? getSubject(card.subjectId) : undefined;
  const tint = subjectColor[subject?.colorKey ?? 'general'] ?? subjectColor.general;
  const finished = index >= queue.length;

  const rate = (rating: Rating) => {
    if (!card) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    updateFlashcard(reviewCard(card, rating));
    setReviewedCount((c) => c + 1);
    setRevealed(false);
    setIndex((i) => i + 1);
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
      <Stack.Screen options={{ animation: 'slide_from_bottom' }} />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <Text style={styles.title}>Flashcard review</Text>
        {!finished && queue.length > 0 && (
          <Text style={styles.counter}>
            {index + 1}/{queue.length}
          </Text>
        )}
      </View>

      {queue.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.doneUrdu}>سب یاد ہے</Text>
          <Text style={styles.doneTitle}>Nothing due right now</Text>
          <Text style={styles.doneSub}>
            Cards return exactly when you're about to forget them. Create more with Snap to
            Study.
          </Text>
          <PrimaryButton
            label="Back"
            variant="ghost"
            onPress={() => router.back()}
            style={{ alignSelf: 'stretch', marginTop: 32 }}
          />
        </View>
      )}

      {!finished && card && (
        <View style={{ flex: 1, paddingHorizontal: space.xl }}>
          <Animated.View key={card.id} entering={FadeInDown.duration(300)} style={{ flex: 1 }}>
            <Pressable
              style={[styles.card, { borderTopColor: tint.main }]}
              onPress={() => {
                if (!revealed) {
                  Haptics.selectionAsync();
                  setRevealed(true);
                }
              }}
            >
              <Text style={[styles.cardSubject, { color: tint.main }]}>{subject?.name}</Text>
              <Text style={styles.cardFront}>{card.front}</Text>
              {revealed ? (
                <>
                  <View style={styles.divider} />
                  <Text style={styles.cardBack}>{card.back}</Text>
                </>
              ) : (
                <Text style={styles.tapHint}>tap to reveal</Text>
              )}
            </Pressable>
          </Animated.View>

          {revealed && (
            <Animated.View
              entering={FadeInDown.duration(250)}
              style={[styles.ratingRow, { paddingBottom: Math.max(insets.bottom, 16) }]}
            >
              {RATINGS.map((r) => (
                <Pressable key={r.rating} style={styles.ratingButton} onPress={() => rate(r.rating)}>
                  <Text style={[styles.ratingLabel, { color: r.tint }]}>{r.label}</Text>
                  <Text style={styles.ratingSub}>{r.sub}</Text>
                </Pressable>
              ))}
            </Animated.View>
          )}
        </View>
      )}

      {finished && queue.length > 0 && (
        <View style={styles.center}>
          <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: 'center' }}>
            <Text style={styles.doneUrdu}>شاباش!</Text>
            <Text style={styles.doneTitle}>{reviewedCount} cards reviewed</Text>
            <Text style={styles.doneSub}>
              Each one is now scheduled to return right before you'd forget it.
            </Text>
          </Animated.View>
          <PrimaryButton
            label="Done"
            onPress={() => router.back()}
            style={{ alignSelf: 'stretch', marginTop: 40 }}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
  },
  closeText: { fontSize: 20, color: color.inkSoft, fontFamily: font.medium },
  title: { ...type.heading, fontSize: 19, color: color.ink, flex: 1 },
  counter: { fontFamily: font.semibold, fontSize: 14, color: color.inkFaint },

  card: {
    flex: 1,
    backgroundColor: color.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    borderTopWidth: 4,
    padding: space.xl,
    marginBottom: space.lg,
  },
  cardSubject: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  cardFront: { ...type.title, fontSize: 22, lineHeight: 30, color: color.ink, marginTop: 14 },
  tapHint: { ...type.small, color: color.inkFaint, marginTop: 'auto', textAlign: 'center' },
  divider: { height: 1, backgroundColor: color.line, marginVertical: space.lg },
  cardBack: { ...type.body, fontSize: 16, lineHeight: 24, color: color.inkSoft },

  ratingRow: { flexDirection: 'row', gap: 8 },
  ratingButton: {
    flex: 1,
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    paddingVertical: 12,
  },
  ratingLabel: { fontFamily: font.semibold, fontSize: 14 },
  ratingSub: { ...type.micro, color: color.inkFaint, marginTop: 2 },

  doneUrdu: { fontFamily: font.urduBold, fontSize: 32, lineHeight: 72, color: color.gold },
  doneTitle: { ...type.title, color: color.ink, textAlign: 'center' },
  doneSub: { ...type.small, color: color.inkSoft, textAlign: 'center', marginTop: 8, lineHeight: 19 },
});
