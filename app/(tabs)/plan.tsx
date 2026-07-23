import * as Haptics from 'expo-haptics';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Screen } from '../../src/components/Screen';
import { getChapter, getSubject } from '../../src/data/syllabus';
import { daysUntil, generatePlan, todayISO } from '../../src/lib/planEngine';
import type { PlanSession } from '../../src/lib/types';
import { useAppStore } from '../../src/store/useAppStore';
import { color, font, radius, space, subjectColor, type } from '../../src/theme/tokens';

const KIND_SHORT: Record<PlanSession['kind'], string> = {
  study: 'Study',
  revise: 'Revise',
  practice: 'Drill',
};

const TIME_CHIPS = [60, 90, 120, 180, 240];

function dayLabel(iso: string): string {
  const today = todayISO();
  if (iso === today) return 'Today';
  const d = new Date(`${iso}T12:00:00`);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (iso === tomorrow.toISOString().slice(0, 10)) return 'Tomorrow';
  return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function PlanScreen() {
  const profile = useAppStore((s) => s.profile);
  const plan = useAppStore((s) => s.plan);
  const setPlan = useAppStore((s) => s.setPlan);
  const setProfile = useAppStore((s) => s.setProfile);
  const [showRebalance, setShowRebalance] = useState(false);

  const upcoming = useMemo(() => {
    if (!plan) return [];
    const today = todayISO();
    const byDate = new Map<string, PlanSession[]>();
    for (const s of plan.sessions) {
      if (s.date < today) continue;
      const list = byDate.get(s.date) ?? [];
      list.push(s);
      byDate.set(s.date, list);
    }
    return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [plan]);

  const visible = upcoming.slice(0, 14);
  const later = upcoming.slice(14);
  const laterCounts = useMemo(() => {
    const counts = { study: 0, revise: 0, practice: 0 };
    for (const [, sessions] of later) for (const s of sessions) counts[s.kind]++;
    return counts;
  }, [later]);

  const remaining = plan ? plan.sessions.filter((s) => !s.done).length : 0;
  const countdown = profile ? Math.max(daysUntil(profile.examDate), 0) : 0;

  const rebalance = (minutes: number) => {
    if (!profile) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const updated = { ...profile, dailyMinutes: minutes };
    setProfile(updated);
    setPlan(generatePlan(updated));
    setShowRebalance(false);
  };

  return (
    <Screen bleed>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.urduAccent}>آپ کا سفر</Text>
        <Text style={[type.title, { color: color.ink }]}>Your roadmap</Text>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{countdown}</Text>
            <Text style={styles.statLabel}>days left</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{remaining}</Text>
            <Text style={styles.statLabel}>sessions to go</Text>
          </View>
          <Pressable
            style={[styles.statCard, styles.rebalanceCard]}
            onPress={() => {
              Haptics.selectionAsync();
              setShowRebalance((v) => !v);
            }}
          >
            <Text style={[styles.statNumber, { color: color.green, fontSize: 20, lineHeight: 26 }]}>
              ⇄
            </Text>
            <Text style={[styles.statLabel, { color: color.green }]}>rebalance</Text>
          </Pressable>
        </View>

        {showRebalance && profile && (
          <Animated.View entering={FadeInDown.duration(300)} style={styles.rebalancePanel}>
            <Text style={styles.rebalanceTitle}>
              Life changed? Pick your new daily time — the whole plan regenerates instantly.
            </Text>
            <View style={styles.chipRow}>
              {TIME_CHIPS.map((m) => (
                <Pressable
                  key={m}
                  style={[styles.timeChip, profile.dailyMinutes === m && styles.timeChipActive]}
                  onPress={() => rebalance(m)}
                >
                  <Text
                    style={[
                      styles.timeChipText,
                      profile.dailyMinutes === m && styles.timeChipTextActive,
                    ]}
                  >
                    {m >= 60 ? `${m / 60}h` : `${m}m`}
                  </Text>
                </Pressable>
              ))}
            </View>
          </Animated.View>
        )}

        {visible.map(([date, sessions], di) => {
          const totalMin = sessions.reduce((a, s) => a + s.minutes, 0);
          return (
            <Animated.View
              key={date}
              entering={FadeInDown.delay(Math.min(di * 40, 300)).duration(300)}
            >
              <View style={styles.dayHeader}>
                <Text style={styles.dayLabel}>{dayLabel(date)}</Text>
                <Text style={styles.dayMeta}>{totalMin} min</Text>
              </View>
              <View style={styles.dayCard}>
                {sessions.map((s, i) => {
                  const subject = getSubject(s.subjectId);
                  const chapter = getChapter(s.subjectId, s.chapterId);
                  const tint = subjectColor[subject?.colorKey ?? 'general'] ?? subjectColor.general;
                  return (
                    <View
                      key={s.id}
                      style={[styles.sessionRow, i < sessions.length - 1 && styles.sessionDivider]}
                    >
                      <View style={[styles.dot, { backgroundColor: tint.main }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.sessionSubject}>{subject?.name}</Text>
                        <Text
                          style={[styles.sessionChapter, s.done && styles.sessionChapterDone]}
                          numberOfLines={1}
                        >
                          {chapter ? `${chapter.no}. ${chapter.name}` : ''}
                        </Text>
                      </View>
                      <Text style={[styles.sessionMeta, { color: tint.main }]}>
                        {KIND_SHORT[s.kind]} · {s.minutes}m
                      </Text>
                    </View>
                  );
                })}
              </View>
            </Animated.View>
          );
        })}

        {later.length > 0 && (
          <View style={styles.laterCard}>
            <Text style={styles.laterTitle}>+ {later.length} more days planned</Text>
            <Text style={styles.laterText}>
              {laterCounts.study > 0 ? `${laterCounts.study} study · ` : ''}
              {laterCounts.revise} revision · {laterCounts.practice} past-paper drills — all the
              way to exam day.
            </Text>
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  urduAccent: { fontFamily: font.urdu, fontSize: 15, lineHeight: 36, color: color.greenMid },

  statsRow: { flexDirection: 'row', gap: 10, marginTop: space.lg, marginBottom: space.xl },
  statCard: {
    flex: 1,
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    paddingVertical: 14,
    alignItems: 'center',
  },
  rebalanceCard: { backgroundColor: color.greenSoft, borderColor: color.greenSoft },
  statNumber: { fontFamily: font.bold, fontSize: 22, color: color.ink },
  statLabel: { ...type.micro, color: color.inkFaint, marginTop: 2, textTransform: 'uppercase' },

  rebalancePanel: {
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    padding: space.lg,
    marginBottom: space.xl,
  },
  rebalanceTitle: { ...type.small, color: color.inkSoft, lineHeight: 19 },
  chipRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  timeChip: {
    flex: 1,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeChipActive: { backgroundColor: color.green, borderColor: color.green },
  timeChipText: { ...type.smallMedium, color: color.inkSoft },
  timeChipTextActive: { color: color.paperOnDark },

  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 8,
    marginTop: 4,
  },
  dayLabel: { ...type.heading, color: color.ink },
  dayMeta: { ...type.smallMedium, color: color.inkFaint },
  dayCard: {
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    marginBottom: space.lg,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  sessionDivider: { borderBottomWidth: 1, borderBottomColor: color.line },
  dot: { width: 8, height: 8, borderRadius: 4 },
  sessionSubject: {
    fontFamily: font.medium,
    fontSize: 11,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    color: color.inkFaint,
  },
  sessionChapter: { ...type.smallMedium, fontSize: 14, color: color.ink, marginTop: 1 },
  sessionChapterDone: { textDecorationLine: 'line-through', color: color.inkFaint },
  sessionMeta: { fontFamily: font.medium, fontSize: 12 },

  laterCard: {
    backgroundColor: color.cardWarm,
    borderRadius: radius.md,
    padding: space.xl,
    marginTop: 4,
  },
  laterTitle: { ...type.bodyMedium, color: color.ink },
  laterText: { ...type.small, color: color.inkSoft, marginTop: 4, lineHeight: 19 },
});
