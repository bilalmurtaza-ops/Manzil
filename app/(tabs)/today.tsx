import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { CloudNudge } from '../../src/components/CloudNudge';
import { ChevronIcon, FlameIcon, LeafIcon, StarIcon } from '../../src/components/icons';
import { ProgressRing } from '../../src/components/ProgressRing';
import { Screen } from '../../src/components/Screen';
import { SessionCard } from '../../src/components/SessionCard';
import { daysUntil, repairPlan, todayISO } from '../../src/lib/planEngine';
import { computeStreak, useAppStore } from '../../src/store/useAppStore';
import { color, font, radius, space, type } from '../../src/theme/tokens';

const URDU_LINES = [
  'منزل قریب ہے، چلتے رہو',
  'قطرہ قطرہ دریا بنتا ہے',
  'محنت کبھی رائیگاں نہیں جاتی',
  'آج کا کام آج ہی کرو',
  'کامیابی تیاری سے ملتی ہے',
];

export default function TodayScreen() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const plan = useAppStore((s) => s.plan);
  const setPlan = useAppStore((s) => s.setPlan);
  const toggleSessionDone = useAppStore((s) => s.toggleSessionDone);
  const activeDays = useAppStore((s) => s.activeDays);
  const [repaired, setRepaired] = useState(false);

  // Auto-repair: silently reflow missed sessions forward. No guilt spiral.
  useEffect(() => {
    if (!plan || !profile) return;
    const today = todayISO();
    if (plan.sessions.some((s) => !s.done && s.date < today)) {
      setPlan(repairPlan(plan, profile));
      setRepaired(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const today = todayISO();
  const todaySessions = useMemo(
    () => (plan ? plan.sessions.filter((s) => s.date === today) : []),
    [plan, today],
  );
  const doneCount = todaySessions.filter((s) => s.done).length;
  const progress = todaySessions.length > 0 ? doneCount / todaySessions.length : 0;
  const streak = computeStreak(activeDays);
  const countdown = profile ? Math.max(daysUntil(profile.examDate), 0) : 0;
  const urduLine = URDU_LINES[new Date().getDate() % URDU_LINES.length];
  const allDone = todaySessions.length > 0 && doneCount === todaySessions.length;

  return (
    <Screen bleed>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.salam}>السلام علیکم</Text>
            <Text style={styles.name}>{profile?.name ?? 'Student'}</Text>
          </View>
          <View style={styles.streakChip}>
            <FlameIcon size={15} color={streak > 0 ? color.gold : color.inkFaint} />
            <Text style={[styles.streakText, streak === 0 && { color: color.inkFaint }]}>
              {streak}
            </Text>
          </View>
        </View>

        {/* Countdown + progress card */}
        <Animated.View entering={FadeInDown.duration(400)} style={styles.heroCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroCount}>{countdown}</Text>
            <Text style={styles.heroLabel}>days until your board exams</Text>
            <Text style={styles.heroUrdu}>{urduLine}</Text>
          </View>
          <ProgressRing
            progress={progress}
            size={78}
            strokeWidth={7}
            tint={allDone ? color.gold : color.greenMid}
            track="rgba(242,238,227,0.18)"
          >
            <Text style={styles.ringText}>
              {doneCount}/{todaySessions.length}
            </Text>
          </ProgressRing>
        </Animated.View>

        <CloudNudge />

        <Pressable
          style={styles.breatheCard}
          onPress={() => {
            Haptics.selectionAsync();
            router.push('/breathe');
          }}
        >
          <View style={styles.breatheIconWrap}>
            <LeafIcon size={18} color={color.greenMid} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.breatheTitle}>Feeling stressed?</Text>
            <Text style={styles.breatheSub}>Try a guided breathing exercise — 1 to 3 minutes</Text>
          </View>
          <ChevronIcon size={16} color={color.greenMid} />
        </Pressable>

        <Pressable
          style={styles.motivationCard}
          onPress={() => {
            Haptics.selectionAsync();
            router.push('/motivation');
          }}
        >
          <View style={styles.motivationIconWrap}>
            <StarIcon size={17} color={color.gold} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.motivationTitle}>کلامِ اقبال</Text>
            <Text style={styles.motivationSub}>A verse from Allama Iqbal to move you forward</Text>
          </View>
          <ChevronIcon size={16} color={color.gold} />
        </Pressable>

        {repaired && (
          <Animated.View entering={FadeIn.delay(200)} style={styles.repairNote}>
            <Text style={styles.repairText}>
              Missed a day? No problem — your plan quietly rebalanced itself. Just start from
              today.
            </Text>
          </Animated.View>
        )}

        {/* Sessions */}
        <Text style={styles.sectionTitle}>Today's sessions</Text>
        {todaySessions.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Nothing scheduled today</Text>
            <Text style={styles.emptyText}>
              Your exam plan hasn't reached today, or you've finished everything. Check the Plan
              tab — or revise flashcards in Practice.
            </Text>
          </View>
        ) : (
          todaySessions.map((s, i) => (
            <SessionCard
              key={s.id}
              session={s}
              index={i}
              onToggleDone={() => toggleSessionDone(s.id)}
              onStart={() =>
                router.push({ pathname: '/focus', params: { sessionId: s.id } })
              }
            />
          ))
        )}

        {allDone && (
          <Animated.View entering={FadeInDown.duration(400)} style={styles.doneCard}>
            <Text style={styles.doneUrdu}>شاباش!</Text>
            <Text style={styles.doneText}>
              All sessions complete. Rest well — tomorrow's plan is ready.
            </Text>
          </Animated.View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: space.lg },
  salam: { fontFamily: font.urdu, fontSize: 14, lineHeight: 34, color: color.greenMid },
  name: { ...type.title, color: color.ink, marginTop: -2 },
  streakChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: color.goldSoft,
    borderRadius: radius.full,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  streakText: { fontFamily: font.bold, fontSize: 15, color: color.gold },

  heroCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: color.inkWash,
    borderRadius: radius.lg,
    padding: space.xl,
    marginBottom: space.md,
  },
  heroCount: { fontFamily: font.bold, fontSize: 40, color: color.paperOnDark, letterSpacing: -1 },
  heroLabel: { ...type.small, color: color.fadedOnDark, marginTop: -2 },
  heroUrdu: {
    fontFamily: font.urdu,
    fontSize: 13,
    lineHeight: 32,
    color: 'rgba(201, 151, 46, 0.95)',
    marginTop: 6,
  },
  ringText: { fontFamily: font.semibold, fontSize: 15, color: color.paperOnDark },

  breatheCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: color.greenSoft,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: space.md,
  },
  breatheIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breatheTitle: { ...type.bodyMedium, color: color.greenDeep },
  breatheSub: { ...type.small, color: color.inkSoft, marginTop: 1 },

  motivationCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: color.goldSoft,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: space.md,
  },
  motivationIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  motivationTitle: {
    fontFamily: font.urduBold,
    fontSize: 15.5,
    lineHeight: 38,
    paddingBottom: 4,
    textAlign: 'left',
    color: color.ink,
  },
  motivationSub: { ...type.small, color: color.inkSoft, marginTop: 1 },

  repairNote: {
    backgroundColor: color.greenSoft,
    borderRadius: radius.md,
    padding: 14,
    marginBottom: space.md,
  },
  repairText: { ...type.small, color: color.greenDeep, lineHeight: 19 },

  sectionTitle: { ...type.heading, color: color.ink, marginTop: space.md, marginBottom: 12 },

  emptyCard: {
    backgroundColor: color.cardWarm,
    borderRadius: radius.md,
    padding: space.xl,
  },
  emptyTitle: { ...type.bodyMedium, color: color.ink },
  emptyText: { ...type.small, color: color.inkSoft, marginTop: 6, lineHeight: 19 },

  doneCard: {
    alignItems: 'center',
    backgroundColor: color.goldSoft,
    borderRadius: radius.lg,
    padding: space.xl,
    marginTop: space.md,
  },
  doneUrdu: { fontFamily: font.urduBold, fontSize: 26, lineHeight: 60, color: color.gold },
  doneText: { ...type.small, color: color.inkSoft, textAlign: 'center', marginTop: 2 },
});
