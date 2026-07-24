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
import { PracticeIcon } from '../src/components/icons';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { ProgressRing } from '../src/components/ProgressRing';
import { subjectsForProfile } from '../src/data/syllabus';
import { GeminiError, gradeAnswer, type AnswerGrade } from '../src/lib/gemini';
import { pickImage } from '../src/lib/images';
import { useAppStore } from '../src/store/useAppStore';
import { color, font, radius, space, subjectColor, type } from '../src/theme/tokens';

const MARK_OPTIONS = [3, 5, 8];

export default function GraderScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const profile = useAppStore((s) => s.profile);

  const subjects = useMemo(
    () => (profile ? subjectsForProfile(profile.classLevel, profile.group) : []),
    [profile],
  );

  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [marks, setMarks] = useState(5);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grade, setGrade] = useState<AnswerGrade | null>(null);

  const capture = async (source: 'camera' | 'gallery') => {
    if (!profile || !subjectId || busy) return;
    setError(null);
    const picked = await pickImage(source);
    if (!picked) return;
    setBusy(true);
    setGrade(null);
    try {
      const result = await gradeAnswer(profile, picked.base64, subjectId, marks, picked.mimeType);
      setGrade(result);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(e instanceof GeminiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const pct = grade ? grade.marksAwarded / Math.max(grade.marksTotal, 1) : 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
      <Stack.Screen options={{ animation: 'slide_from_bottom' }} />
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <View>
          <Text style={styles.title}>Answer Grader</Text>
          <Text style={styles.subtitle}>An AI examiner marks your handwriting</Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.xl, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {!grade && !busy && (
          <Animated.View entering={FadeInDown.duration(350)}>
            <View style={styles.heroCard}>
              <PracticeIcon size={26} color={color.green} />
              <Text style={styles.heroText}>
                Write a long-question answer on paper — exactly like the board exam — then
                photograph it. AI grades it like a BISE examiner and tells you where the marks
                leaked.
              </Text>
            </View>

            <Text style={styles.sectionLabel}>Subject</Text>
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

            <Text style={styles.sectionLabel}>Question marks</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {MARK_OPTIONS.map((m) => (
                <Pressable
                  key={m}
                  style={[styles.markChip, marks === m && styles.markChipActive]}
                  onPress={() => {
                    Haptics.selectionAsync();
                    setMarks(m);
                  }}
                >
                  <Text style={[styles.markText, marks === m && { color: color.paperOnDark }]}>
                    {m} marks
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={{ gap: 10, marginTop: space.xl }}>
              <PrimaryButton
                label="Photograph my answer"
                onPress={() => capture('camera')}
                disabled={!subjectId}
              />
              <PrimaryButton
                label="Choose from gallery"
                variant="ghost"
                onPress={() => capture('gallery')}
                disabled={!subjectId}
              />
            </View>
            {!subjectId && (
              <Text style={styles.hint}>Pick a subject first.</Text>
            )}
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
            <Text style={styles.loadingText}>Examiner is marking your answer…</Text>
            <Text style={styles.loadingUrdu}>ممتحن پرچہ دیکھ رہے ہیں</Text>
          </View>
        )}

        {grade && (
          <Animated.View entering={FadeInDown.duration(350)}>
            <View style={styles.resultHero}>
              <ProgressRing
                progress={pct}
                size={120}
                strokeWidth={10}
                tint={pct >= 0.7 ? color.green : pct >= 0.4 ? color.gold : color.rust}
              >
                <Text style={styles.resultMarks}>
                  {grade.marksAwarded}
                  <Text style={styles.resultTotal}>/{grade.marksTotal}</Text>
                </Text>
              </ProgressRing>
              <Text style={styles.examinerNote}>{grade.examinerNote}</Text>
            </View>

            <Text style={styles.sectionLabel}>What earned marks</Text>
            {grade.strengths.map((s, i) => (
              <View key={i} style={[styles.pointRow, { backgroundColor: color.greenSoft }]}>
                <Text style={[styles.pointBullet, { color: color.green }]}>✓</Text>
                <Text style={[styles.pointText, { color: color.greenDeep }]}>{s}</Text>
              </View>
            ))}

            <Text style={styles.sectionLabel}>Where marks leaked</Text>
            {grade.improvements.map((s, i) => (
              <View key={i} style={[styles.pointRow, { backgroundColor: color.rustSoft }]}>
                <Text style={[styles.pointBullet, { color: color.rust }]}>→</Text>
                <Text style={[styles.pointText, { color: color.rust }]}>{s}</Text>
              </View>
            ))}

            <View style={{ gap: 10, marginTop: space.xl }}>
              <PrimaryButton label="Grade another answer" onPress={() => setGrade(null)} />
              <PrimaryButton label="Done" variant="ghost" onPress={() => router.back()} />
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
    backgroundColor: color.greenSoft,
    borderRadius: radius.lg,
    padding: space.xl,
    gap: 12,
  },
  heroText: { ...type.body, color: color.greenDeep, lineHeight: 21 },

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

  markChip: {
    flex: 1,
    height: 42,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.card,
  },
  markChipActive: { backgroundColor: color.green, borderColor: color.green },
  markText: { ...type.smallMedium, color: color.inkSoft },

  hint: { ...type.small, color: color.inkFaint, marginTop: 10, textAlign: 'center' },
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

  resultHero: { alignItems: 'center', marginTop: space.md },
  resultMarks: { fontFamily: font.bold, fontSize: 28, color: color.ink },
  resultTotal: { fontSize: 16, color: color.inkFaint },
  examinerNote: {
    ...type.body,
    color: color.inkSoft,
    textAlign: 'center',
    marginTop: space.lg,
    fontStyle: 'italic',
    paddingHorizontal: 10,
  },

  pointRow: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: radius.md,
    padding: 13,
    marginBottom: 7,
  },
  pointBullet: { fontFamily: font.bold, fontSize: 14 },
  pointText: { ...type.small, lineHeight: 19, flex: 1 },
});
