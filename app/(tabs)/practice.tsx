import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { CameraIcon, ChevronIcon, DojoIcon, PracticeIcon } from '../../src/components/icons';
import { Screen } from '../../src/components/Screen';
import { subjectsForProfile } from '../../src/data/syllabus';
import { todayISO } from '../../src/lib/planEngine';
import { useAppStore } from '../../src/store/useAppStore';
import { color, font, radius, space, subjectColor, type } from '../../src/theme/tokens';

export default function PracticeScreen() {
  const router = useRouter();
  const profile = useAppStore((s) => s.profile);
  const flashcards = useAppStore((s) => s.flashcards);
  const quizAttempts = useAppStore((s) => s.quizAttempts);

  const subjects = useMemo(
    () => (profile ? subjectsForProfile(profile.classLevel, profile.group) : []),
    [profile],
  );
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const activeSubject = subjects.find((s) => s.id === (subjectId ?? subjects[0]?.id));

  const dueCards = flashcards.filter((c) => c.due <= todayISO()).length;

  const bestScore = (chapterId: string) => {
    const attempts = quizAttempts.filter((a) => a.chapterId === chapterId);
    if (attempts.length === 0) return null;
    return Math.max(...attempts.map((a) => Math.round((a.correct / a.total) * 100)));
  };

  return (
    <Screen bleed>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: space.lg, paddingBottom: 32 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.urduAccent}>مشق</Text>
        <Text style={[type.title, { color: color.ink }]}>Practice</Text>

        {/* AI tools */}
        <View style={styles.toolsRow}>
          <Pressable
            style={[styles.toolCard, { backgroundColor: color.inkWash }]}
            onPress={() => router.push('/snap')}
          >
            <CameraIcon size={22} color={color.gold} />
            <Text style={[styles.toolTitle, { color: color.paperOnDark }]}>Snap to Study</Text>
            <Text style={[styles.toolSub, { color: color.fadedOnDark }]}>
              Photo of notes → flashcards
            </Text>
          </Pressable>
          <Pressable
            style={[styles.toolCard, { backgroundColor: color.greenSoft }]}
            onPress={() => router.push('/grader')}
          >
            <PracticeIcon size={22} color={color.green} />
            <Text style={[styles.toolTitle, { color: color.greenDeep }]}>Answer Grader</Text>
            <Text style={[styles.toolSub, { color: color.inkSoft }]}>
              AI marks your written answer
            </Text>
          </Pressable>
        </View>

        {/* Theorem Dojo — full-width entry card */}
        {profile && (
          <Pressable
            style={styles.dojoCard}
            onPress={() => {
              Haptics.selectionAsync();
              router.push({ pathname: '/dojo', params: { classLevel: profile.classLevel } });
            }}
          >
            <DojoIcon size={22} color={color.greenMid} />
            <View style={{ flex: 1 }}>
              <Text style={styles.dojoTitle}>Theorem Dojo · مسئلہ ڈوجو (ہندسی ثبوت)</Text>
              <Text style={styles.dojoSub}>
                Class {profile.classLevel} · {profile.classLevel === '10' ? '6 compulsory board theorems' : '4 proof results'} · tap-to-arrange proof puzzle
              </Text>
            </View>
            <ChevronIcon size={15} color={color.inkFaint} />
          </Pressable>
        )}

        {/* Flashcards */}
        <Pressable
          style={styles.reviewCard}
          onPress={() => {
            Haptics.selectionAsync();
            router.push('/review');
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.reviewTitle}>Flashcard review</Text>
            <Text style={styles.reviewSub}>
              {flashcards.length === 0
                ? 'No cards yet — create some with Snap to Study'
                : dueCards > 0
                  ? `${dueCards} card${dueCards === 1 ? '' : 's'} due today · spaced repetition`
                  : `All caught up · ${flashcards.length} cards in rotation`}
            </Text>
          </View>
          {dueCards > 0 && (
            <View style={styles.dueBadge}>
              <Text style={styles.dueBadgeText}>{dueCards}</Text>
            </View>
          )}
          <ChevronIcon size={15} color={color.inkFaint} />
        </Pressable>

        {/* Chapter quizzes */}
        <Text style={styles.sectionTitle}>Board-style chapter quiz</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
          style={{ flexGrow: 0, marginBottom: 12 }}
        >
          {subjects.map((s) => {
            const active = activeSubject?.id === s.id;
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
        </ScrollView>

        {activeSubject && profile && (
          <View style={styles.chapterCard}>
            {activeSubject.chapters[profile.classLevel]
              .filter((c) => c.weight >= 2)
              .map((c, i, arr) => {
                const score = bestScore(c.id);
                const tint = subjectColor[activeSubject.colorKey] ?? subjectColor.general;
                return (
                  <Pressable
                    key={c.id}
                    style={[styles.chapterRow, i < arr.length - 1 && styles.chapterDivider]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      router.push({
                        pathname: '/quiz',
                        params: { subjectId: activeSubject.id, chapterId: c.id },
                      });
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.chapterName} numberOfLines={1}>
                        {c.no}. {c.name}
                      </Text>
                      <View style={styles.weightRow}>
                        {[1, 2, 3, 4, 5].map((w) => (
                          <View
                            key={w}
                            style={[
                              styles.weightBar,
                              w <= c.weight && { backgroundColor: tint.main, opacity: 0.85 },
                            ]}
                          />
                        ))}
                        <Text style={styles.weightLabel}>exam weight</Text>
                      </View>
                    </View>
                    {score !== null && (
                      <View
                        style={[
                          styles.scoreBadge,
                          { backgroundColor: score >= 70 ? color.greenSoft : color.rustSoft },
                        ]}
                      >
                        <Text
                          style={[
                            styles.scoreText,
                            { color: score >= 70 ? color.green : color.rust },
                          ]}
                        >
                          {score}%
                        </Text>
                      </View>
                    )}
                    <ChevronIcon size={14} color={color.inkFaint} />
                  </Pressable>
                );
              })}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  urduAccent: { fontFamily: font.urdu, fontSize: 15, lineHeight: 36, color: color.greenMid },

  toolsRow: { flexDirection: 'row', gap: 10, marginTop: space.lg },
  toolCard: {
    flex: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: 4,
  },
  toolTitle: { fontFamily: font.semibold, fontSize: 15, marginTop: 8 },
  toolSub: { ...type.small, fontSize: 12 },

  dojoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    padding: space.lg,
    marginTop: 10,
  },
  dojoTitle: { fontFamily: font.semibold, fontSize: 15, color: color.ink },
  dojoSub: { ...type.small, color: color.inkFaint, marginTop: 3 },

  reviewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    padding: space.lg,
    marginTop: 10,
  },
  reviewTitle: { ...type.bodyMedium, color: color.ink },
  reviewSub: { ...type.small, color: color.inkFaint, marginTop: 2 },
  dueBadge: {
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: color.gold,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 7,
  },
  dueBadgeText: { fontFamily: font.bold, fontSize: 13, color: color.card },

  sectionTitle: { ...type.heading, color: color.ink, marginTop: space.xl, marginBottom: 12 },

  subjectChip: {
    height: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.card,
  },
  subjectChipText: { ...type.smallMedium, color: color.inkSoft },

  chapterCard: {
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
  },
  chapterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  chapterDivider: { borderBottomWidth: 1, borderBottomColor: color.line },
  chapterName: { ...type.smallMedium, fontSize: 14, color: color.ink },
  weightRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 5 },
  weightBar: { width: 12, height: 3, borderRadius: 2, backgroundColor: color.line },
  weightLabel: { ...type.micro, color: color.inkFaint, marginLeft: 5, fontSize: 9 },
  scoreBadge: { borderRadius: radius.full, paddingHorizontal: 8, paddingVertical: 3 },
  scoreText: { fontFamily: font.semibold, fontSize: 12 },
});
