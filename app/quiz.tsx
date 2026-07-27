import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { ProgressRing } from '../src/components/ProgressRing';
import { getChapter, getSubject } from '../src/data/syllabus';
import { GeminiError, generateQuiz, type QuizQuestion } from '../src/lib/gemini';
import { todayISO } from '../src/lib/planEngine';
import { useAppStore } from '../src/store/useAppStore';
import { color, font, radius, space, type } from '../src/theme/tokens';

let idCounter = 0;
const nextId = () => `q${Date.now().toString(36)}${(idCounter++).toString(36)}`;

export default function QuizScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { subjectId, chapterId } = useLocalSearchParams<{
    subjectId: string;
    chapterId: string;
  }>();
  const profile = useAppStore((s) => s.profile);
  const addQuizAttempt = useAppStore((s) => s.addQuizAttempt);

  const subject = subjectId ? getSubject(subjectId) : undefined;
  const chapter = subjectId && chapterId ? getChapter(subjectId, chapterId) : undefined;

  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [finished, setFinished] = useState(false);

  const load = async () => {
    // Returning silently here left the screen on its spinner forever, because
    // the render treats "no questions and no error" as still loading. Reachable
    // by opening /quiz without params (a deep link, or going back to a stale
    // route), so it needs a real error rather than an infinite wait.
    if (!profile || !subject || !chapter) {
      setError('That chapter could not be found. Pick a chapter from the Practice tab.');
      return;
    }
    setError(null);
    setQuestions(null);
    try {
      const qs = await generateQuiz(profile, subject.id, chapter.name, 8);
      setQuestions(qs);
    } catch (e) {
      setError(e instanceof GeminiError ? e.message : 'Could not build the quiz. Try again.');
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const answer = (i: number) => {
    if (selected !== null || !questions) return;
    setSelected(i);
    const correct = i === questions[index].correctIndex;
    if (correct) {
      setCorrectCount((c) => c + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const next = () => {
    if (!questions) return;
    if (index + 1 >= questions.length) {
      // record attempt
      if (profile && subject && chapter) {
        addQuizAttempt({
          id: nextId(),
          subjectId: subject.id,
          chapterId: chapter.id,
          // Local date: the store compares this against todayISO() to decide
          // whether today counts toward the streak, so the two must agree.
          date: todayISO(),
          total: questions.length,
          correct: correctCount,
        });
      }
      setFinished(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      setIndex((x) => x + 1);
      setSelected(null);
    }
  };

  const q = questions?.[index];
  const pct = questions ? correctCount / questions.length : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
      <Stack.Screen options={{ animation: 'slide_from_bottom' }} />

      {/* Top bar */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.topSubject}>{subject?.name}</Text>
          <Text style={styles.topChapter} numberOfLines={1}>
            {chapter?.name}
          </Text>
        </View>
        {questions && !finished && (
          <Text style={styles.counter}>
            {index + 1}/{questions.length}
          </Text>
        )}
      </View>

      {/* Loading */}
      {!questions && !error && (
        <View style={styles.center}>
          <ActivityIndicator color={color.green} size="large" />
          <Text style={styles.loadingText}>Building a board-style quiz…</Text>
          <Text style={styles.loadingUrdu}>پرچہ تیار ہو رہا ہے</Text>
        </View>
      )}

      {/* Error */}
      {error && (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <PrimaryButton label="Retry" onPress={load} style={{ marginTop: 20, alignSelf: 'stretch' }} />
        </View>
      )}

      {/* Question */}
      {q && !finished && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View key={index} entering={FadeInDown.duration(300)}>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${((index + (selected !== null ? 1 : 0)) / (questions?.length ?? 1)) * 100}%` },
                ]}
              />
            </View>
            <Text style={styles.question}>{q.question}</Text>
            {q.options.map((opt, i) => {
              const isCorrect = selected !== null && i === q.correctIndex;
              const isWrongPick = selected === i && i !== q.correctIndex;
              return (
                <Pressable
                  key={i}
                  onPress={() => answer(i)}
                  style={[
                    styles.option,
                    isCorrect && styles.optionCorrect,
                    isWrongPick && styles.optionWrong,
                  ]}
                >
                  <Text style={styles.optionLetter}>{'ABCD'[i]}</Text>
                  <Text
                    style={[
                      styles.optionText,
                      isCorrect && { color: color.greenDeep, fontFamily: font.semibold },
                      isWrongPick && { color: color.rust },
                    ]}
                  >
                    {opt}
                  </Text>
                </Pressable>
              );
            })}

            {selected !== null && (
              <Animated.View entering={FadeInUp.duration(300)} style={styles.explainCard}>
                <Text style={styles.explainTitle}>
                  {selected === q.correctIndex ? 'درست! Correct' : 'Not quite'}
                </Text>
                <Text style={styles.explainText}>{q.explanation}</Text>
              </Animated.View>
            )}
          </Animated.View>
        </ScrollView>
      )}

      {q && !finished && selected !== null && (
        <View style={{ paddingHorizontal: space.xl, paddingBottom: Math.max(insets.bottom, 16) }}>
          <PrimaryButton
            label={index + 1 >= (questions?.length ?? 0) ? 'See result' : 'Next question'}
            onPress={next}
          />
        </View>
      )}

      {/* Result */}
      {finished && questions && (
        <View style={[styles.center, { paddingHorizontal: space.xl }]}>
          <Animated.View entering={FadeInDown.duration(400)} style={{ alignItems: 'center' }}>
            <ProgressRing
              progress={pct}
              size={150}
              strokeWidth={11}
              tint={pct >= 0.7 ? color.green : pct >= 0.4 ? color.gold : color.rust}
            >
              <Text style={styles.resultPct}>{Math.round(pct * 100)}%</Text>
            </ProgressRing>
            <Text style={styles.resultTitle}>
              {pct >= 0.7 ? 'شاباش! Strong work' : pct >= 0.4 ? 'Getting there' : 'This chapter needs you'}
            </Text>
            <Text style={styles.resultSub}>
              {correctCount} of {questions.length} correct · saved to your readiness score
            </Text>
          </Animated.View>
          <View style={{ alignSelf: 'stretch', marginTop: 40, gap: 10 }}>
            <PrimaryButton
              label="Practice again"
              onPress={() => {
                setFinished(false);
                setIndex(0);
                setSelected(null);
                setCorrectCount(0);
                load();
              }}
            />
            <PrimaryButton label="Done" variant="ghost" onPress={() => router.back()} />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: space.xl,
    paddingBottom: space.md,
  },
  closeText: { fontSize: 20, color: color.inkSoft, fontFamily: font.medium },
  topSubject: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: color.greenMid,
  },
  topChapter: { ...type.smallMedium, fontSize: 14, color: color.ink },
  counter: { fontFamily: font.semibold, fontSize: 14, color: color.inkFaint },

  loadingText: { ...type.bodyMedium, color: color.inkSoft, marginTop: 18 },
  loadingUrdu: { fontFamily: font.urdu, fontSize: 13, lineHeight: 32, color: color.inkFaint },
  errorText: { ...type.body, color: color.rust, textAlign: 'center' },

  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: color.line,
    overflow: 'hidden',
    marginBottom: space.xl,
  },
  progressFill: { height: '100%', backgroundColor: color.green },

  question: { ...type.heading, fontSize: 19, lineHeight: 27, color: color.ink, marginBottom: space.xl },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.line,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  optionCorrect: { borderColor: color.green, backgroundColor: color.greenSoft },
  optionWrong: { borderColor: color.rust, backgroundColor: color.rustSoft },
  optionLetter: { fontFamily: font.bold, fontSize: 13, color: color.inkFaint, width: 16 },
  optionText: { ...type.body, color: color.ink, flex: 1 },

  explainCard: {
    backgroundColor: color.cardWarm,
    borderRadius: radius.md,
    padding: space.lg,
    marginTop: 6,
  },
  explainTitle: { fontFamily: font.semibold, fontSize: 14, color: color.ink },
  explainText: { ...type.small, color: color.inkSoft, marginTop: 5, lineHeight: 19 },

  resultPct: { fontFamily: font.bold, fontSize: 32, color: color.ink },
  resultTitle: { ...type.title, fontSize: 22, color: color.ink, marginTop: 24, textAlign: 'center' },
  resultSub: { ...type.small, color: color.inkFaint, marginTop: 8, textAlign: 'center' },
});
