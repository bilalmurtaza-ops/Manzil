import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { SettingsIcon } from '../../src/components/icons';
import { ProgressRing } from '../../src/components/ProgressRing';
import { Screen } from '../../src/components/Screen';
import { daysUntil } from '../../src/lib/planEngine';
import { computeReadiness } from '../../src/lib/readiness';
import { computeStreak, useAppStore } from '../../src/store/useAppStore';
import { color, font, radius, space, subjectColor, type } from '../../src/theme/tokens';

export default function ProgressScreen() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const plan = useAppStore((s) => s.plan);
  const quizAttempts = useAppStore((s) => s.quizAttempts);
  const activeDays = useAppStore((s) => s.activeDays);
  const resetAll = useAppStore((s) => s.resetAll);

  const confirmReset = () => {
    const doReset = () => {
      resetAll();
      router.replace('/onboarding');
    };
    if (Platform.OS === 'web') {
      doReset();
      return;
    }
    Alert.alert('Start over?', 'This erases your profile, plan, quiz history and flashcards.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Erase everything', style: 'destructive', onPress: doReset },
    ]);
  };

  const readiness = useMemo(
    () => (profile ? computeReadiness(profile, plan, quizAttempts) : null),
    [profile, plan, quizAttempts],
  );

  if (!profile || !readiness) return <Screen />;

  const countdown = Math.max(daysUntil(profile.examDate), 0);
  const streak = computeStreak(activeDays);
  const doneSessions = plan?.sessions.filter((s) => s.done).length ?? 0;

  return (
    <Screen bleed>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.urduAccent}>پیش رفت</Text>
            <Text style={[type.title, { color: color.ink }]}>Progress</Text>
          </View>
          <Pressable
            style={styles.settingsBtn}
            onPress={() => {
              if (useAppStore.getState().vibrationEnabled !== false) {
                Haptics.selectionAsync();
              }
              router.push('/settings' as any);
            }}
            hitSlop={12}
          >
            <SettingsIcon size={20} color={color.ink} />
          </Pressable>
        </View>

        {/* Overall readiness */}
        <Animated.View entering={FadeInDown.duration(400)} style={styles.heroCard}>
          <ProgressRing
            progress={readiness.overall}
            size={110}
            strokeWidth={9}
            tint={color.gold}
            track="rgba(242,238,227,0.15)"
          >
            <Text style={styles.heroGrade}>{readiness.gradeBand}</Text>
            <Text style={styles.heroGradeSub}>predicted</Text>
          </ProgressRing>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroPct}>{Math.round(readiness.overall * 100)}% ready</Text>
            <Text style={styles.heroNote}>{readiness.gradeNote}</Text>
          </View>
        </Animated.View>

        {/* Quick stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{doneSessions}</Text>
            <Text style={styles.statLabel}>sessions done</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{quizAttempts.length}</Text>
            <Text style={styles.statLabel}>quizzes taken</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{streak}</Text>
            <Text style={styles.statLabel}>day streak</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{countdown}</Text>
            <Text style={styles.statLabel}>days left</Text>
          </View>
        </View>

        {/* Per-subject rings */}
        <Text style={styles.sectionTitle}>Subject readiness</Text>
        <View style={styles.subjectGrid}>
          {readiness.subjects.map((s, i) => {
            const tint = subjectColor[s.subject.colorKey] ?? subjectColor.general;
            return (
              <Animated.View
                key={s.subject.id}
                entering={FadeInDown.delay(i * 50).duration(350)}
                style={styles.subjectCard}
              >
                <ProgressRing progress={s.score} size={56} strokeWidth={5} tint={tint.main} delay={i * 100}>
                  <Text style={[styles.subjectPct, { color: tint.main }]}>
                    {Math.round(s.score * 100)}
                  </Text>
                </ProgressRing>
                <Text style={styles.subjectName} numberOfLines={2}>
                  {s.subject.name}
                </Text>
              </Animated.View>
            );
          })}
        </View>

        {/* Risk chapters */}
        <Text style={styles.sectionTitle}>Exam-day risk</Text>
        <Text style={styles.sectionSub}>
          Heavy chapters in the pairing scheme where your preparation is thinnest. Kill these
          first — they decide your grade.
        </Text>
        <View style={styles.riskCard}>
          {readiness.riskChapters.map((c, i) => {
            const tint = subjectColor[c.subject.colorKey] ?? subjectColor.general;
            return (
              <View
                key={c.chapter.id}
                style={[
                  styles.riskRow,
                  i < readiness.riskChapters.length - 1 && styles.riskDivider,
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.riskSubject, { color: tint.main }]}>{c.subject.name}</Text>
                  <Text style={styles.riskChapter} numberOfLines={1}>
                    {c.chapter.no}. {c.chapter.name}
                  </Text>
                  <View style={styles.riskTrack}>
                    <View
                      style={[
                        styles.riskFill,
                        {
                          width: `${Math.max(Math.round(c.score * 100), 3)}%`,
                          backgroundColor:
                            c.score >= 0.6 ? color.greenMid : c.score >= 0.3 ? color.gold : color.rust,
                        },
                      ]}
                    />
                  </View>
                </View>
                <View style={styles.riskMeta}>
                  <Text style={styles.riskPct}>{Math.round(c.score * 100)}%</Text>
                  <Text style={styles.riskWeight}>weight {c.weight}/5</Text>
                </View>
              </View>
            );
          })}
        </View>

        <View style={styles.footerNote}>
          <Text style={styles.footerText}>
            Readiness blends your completed sessions with quiz results, weighted by each
            chapter's share of the actual board paper. Take chapter quizzes in Practice to
            sharpen the prediction.
          </Text>
        </View>

        <Pressable onPress={confirmReset} style={styles.resetButton} hitSlop={6}>
          <Text style={styles.resetText}>Start over — erase all data</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  settingsBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: color.card,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },

  urduAccent: { fontFamily: font.urdu, fontSize: 15, lineHeight: 36, color: color.greenMid },

  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
    backgroundColor: color.inkWash,
    borderRadius: radius.lg,
    padding: space.xl,
    marginTop: space.lg,
  },
  heroGrade: { fontFamily: font.bold, fontSize: 26, color: color.paperOnDark },
  heroGradeSub: { ...type.micro, color: color.fadedOnDark, textTransform: 'uppercase' },
  heroPct: { fontFamily: font.bold, fontSize: 22, color: color.paperOnDark },
  heroNote: { ...type.small, color: color.fadedOnDark, marginTop: 6, lineHeight: 19 },

  statsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  statCard: {
    flex: 1,
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: 12,
    alignItems: 'center',
  },
  statNumber: { fontFamily: font.bold, fontSize: 18, color: color.ink },
  statLabel: { ...type.micro, fontSize: 9, color: color.inkFaint, marginTop: 2, textTransform: 'uppercase' },

  sectionTitle: { ...type.heading, color: color.ink, marginTop: space.xl, marginBottom: 6 },
  sectionSub: { ...type.small, color: color.inkFaint, lineHeight: 18, marginBottom: 12 },

  subjectGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  subjectCard: {
    width: '31.5%',
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    alignItems: 'center',
    paddingVertical: 14,
    gap: 8,
  },
  subjectPct: { fontFamily: font.bold, fontSize: 13 },
  subjectName: {
    ...type.micro,
    fontSize: 10,
    color: color.inkSoft,
    textAlign: 'center',
    paddingHorizontal: 6,
  },

  riskCard: {
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
  },
  riskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  riskDivider: { borderBottomWidth: 1, borderBottomColor: color.line },
  riskSubject: {
    fontFamily: font.medium,
    fontSize: 10,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  riskChapter: { ...type.smallMedium, fontSize: 13.5, color: color.ink, marginTop: 2 },
  riskTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: color.line,
    overflow: 'hidden',
    marginTop: 7,
  },
  riskFill: { height: '100%', borderRadius: 2 },
  riskMeta: { alignItems: 'flex-end' },
  riskPct: { fontFamily: font.semibold, fontSize: 14, color: color.ink },
  riskWeight: { ...type.micro, fontSize: 9, color: color.inkFaint, marginTop: 2 },

  footerNote: {
    backgroundColor: color.cardWarm,
    borderRadius: radius.md,
    padding: space.lg,
    marginTop: space.xl,
  },
  footerText: { ...type.small, color: color.inkSoft, lineHeight: 19 },

  resetButton: { alignItems: 'center', marginTop: space.xl, paddingVertical: 8 },
  resetText: { ...type.smallMedium, color: color.rust },
});
