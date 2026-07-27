import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeInUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckIcon, ChevronIcon } from '../src/components/icons';
import { PrimaryButton } from '../src/components/PrimaryButton';
import { ProgressRing } from '../src/components/ProgressRing';
import {
  theoremsForClass,
  type ProofStep,
  type Theorem,
} from '../src/data/theorems';
import { useAppStore } from '../src/store/useAppStore';
import { color, font, radius, space, type } from '../src/theme/tokens';
import type { ClassLevel } from '../src/lib/types';

/** Seeded Fisher-Yates shuffle — deterministic per theorem id so re-renders don't re-shuffle */
function shuffleSteps(steps: ProofStep[], seed: string): ProofStep[] {
  const arr = [...steps];
  // Simple string-based seed
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  const rand = () => {
    h ^= h << 13;
    h ^= h >> 17;
    h ^= h << 5;
    return (h >>> 0) / 0xffffffff;
  };
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

type Phase = 'read' | 'arrange' | 'result' | 'complete';

interface TheoremScore {
  theoremId: string;
  correct: number;
  total: number;
}

export default function DojoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const profile = useAppStore((s) => s.profile);
  const { classLevel: paramClass } = useLocalSearchParams<{ classLevel: string }>();

  // Resolve class level: use param if valid, else fall back to profile
  const classLevel: ClassLevel =
    paramClass === '9' || paramClass === '10'
      ? paramClass
      : (profile?.classLevel ?? '10');

  const theorems = useMemo(() => theoremsForClass(classLevel), [classLevel]);

  const [theoremIndex, setTheoremIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('read');
  const [scores, setScores] = useState<TheoremScore[]>([]);

  // Per-theorem arrange state
  // placedIds: step ids placed into slots (in order), null = empty slot
  const [placedIds, setPlacedIds] = useState<(string | null)[]>([]);
  const [checked, setChecked] = useState(false);

  const theorem: Theorem | undefined = theorems[theoremIndex];

  // Shuffled steps for the current theorem (stable per theorem id)
  const shuffled = useMemo(
    () => (theorem ? shuffleSteps(theorem.steps, theorem.id) : []),
    [theorem],
  );

  // IDs already placed (for hiding from pool)
  const placedSet = useMemo(() => new Set(placedIds.filter(Boolean) as string[]), [placedIds]);

  // Pool = shuffled steps not yet placed
  const pool = shuffled.filter((s) => !placedSet.has(s.id));

  const initArrange = useCallback(() => {
    if (!theorem) return;
    setPlacedIds(new Array(theorem.steps.length).fill(null));
    setChecked(false);
  }, [theorem]);

  const startArrange = () => {
    initArrange();
    setPhase('arrange');
  };

  // Tap a pool card → place into next empty slot
  const placeStep = (stepId: string) => {
    if (checked) return;
    const nextEmpty = placedIds.indexOf(null);
    if (nextEmpty === -1) return; // all slots filled
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPlacedIds((prev) => {
      const next = [...prev];
      next[nextEmpty] = stepId;
      return next;
    });
  };

  // Tap a placed card → return it to pool
  const removeStep = (slotIndex: number) => {
    if (checked) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setPlacedIds((prev) => {
      const next = [...prev];
      next[slotIndex] = null;
      // Shift remaining placements left to eliminate gaps
      const filled = next.filter(Boolean) as string[];
      const empties = next.filter((x) => x === null);
      return [...filled, ...empties.map(() => null)];
    });
  };

  const checkProof = () => {
    if (!theorem) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Count correct positions
    let correct = 0;
    placedIds.forEach((id, i) => {
      if (id && theorem.steps[i]?.id === id) correct++;
    });
    setScores((prev) => [...prev, { theoremId: theorem.id, correct, total: theorem.steps.length }]);
    setChecked(true);
  };

  const nextTheorem = () => {
    if (theoremIndex + 1 >= theorems.length) {
      setPhase('complete');
    } else {
      setTheoremIndex((i) => i + 1);
      setPhase('read');
      setPlacedIds([]);
      setChecked(false);
    }
  };

  const restart = () => {
    setTheoremIndex(0);
    setPhase('read');
    setPlacedIds([]);
    setChecked(false);
    setScores([]);
  };

  // ── Helpers ─────────────────────────────────────────────────

  const stepById = (id: string | null) =>
    id ? theorem?.steps.find((s) => s.id === id) ?? null : null;

  const isSlotCorrect = (slotIndex: number) => {
    if (!checked || !theorem) return null;
    const placedId = placedIds[slotIndex];
    if (!placedId) return false;
    return theorem.steps[slotIndex]?.id === placedId;
  };

  const correctStepForSlot = (slotIndex: number) =>
    checked ? theorem?.steps[slotIndex] : undefined;

  const currentScore = scores.find((s) => s.theoremId === theorem?.id);
  const totalMastered = scores.filter((s) => s.correct === s.total).length;

  // ── Render ───────────────────────────────────────────────────

  if (!theorem && phase !== 'complete') {
    return null;
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.md }]}>
      <Stack.Screen options={{ animation: 'slide_from_bottom' }} />

      {/* ─── Top bar ─── */}
      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.topLabel}>MATHEMATICS · ریاضی</Text>
          <Text style={styles.topTitle}>Theorem Dojo · مسئلہ ڈوجو (ہندسی ثبوت)</Text>
        </View>
        {phase !== 'complete' && (
          <View style={styles.counterBadge}>
            <Text style={styles.counterText}>
              {theoremIndex + 1}/{theorems.length}
            </Text>
          </View>
        )}
      </View>

      {/* ─── Progress bar ─── */}
      {phase !== 'complete' && (
        <View style={styles.progressTrack}>
          <View
            style={[
              styles.progressFill,
              { width: `${((theoremIndex) / theorems.length) * 100}%` },
            ]}
          />
        </View>
      )}

      {/* ════════════════════════════════════════════════════
          PHASE: read — show Given / To Prove / Construction
          ════════════════════════════════════════════════════ */}
      {phase === 'read' && theorem && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(320)}>
            {/* Chapter badge */}
            <View style={styles.chapterBadge}>
              <Text style={styles.chapterBadgeText}>
                Ch. {theorem.chapterNo} · {theorem.chapterName}
              </Text>
              <View style={styles.marksBadge}>
                <Text style={styles.marksText}>{theorem.marks} marks</Text>
              </View>
            </View>

            {/* Theorem statement */}
            <Text style={styles.theoremTitle}>{theorem.title}</Text>
            <View style={styles.statementCard}>
              <Text style={styles.statementText}>"{theorem.fullStatement}"</Text>
            </View>

            {/* Given */}
            <Text style={styles.sectionLabel}>GIVEN — معلوم</Text>
            <View style={styles.infoCard}>
              <Text style={styles.infoText}>{theorem.given}</Text>
            </View>

            {/* To Prove */}
            <Text style={styles.sectionLabel}>TO PROVE — مطلوب</Text>
            <View style={styles.infoCard}>
              <Text style={styles.infoText}>{theorem.toProve}</Text>
            </View>

            {/* Construction */}
            {theorem.construction && (
              <>
                <Text style={styles.sectionLabel}>CONSTRUCTION — عمل</Text>
                <View style={styles.infoCard}>
                  <Text style={styles.infoText}>{theorem.construction}</Text>
                </View>
              </>
            )}

            {/* Hint */}
            <View style={styles.hintCard}>
              <Text style={styles.hintLabel}>💡 Ustaad's Hint</Text>
              <Text style={styles.hintText}>{theorem.hint}</Text>
            </View>
          </Animated.View>
        </ScrollView>
      )}

      {phase === 'read' && theorem && (
        <View style={[styles.bottomAction, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <PrimaryButton label="Start Proof →" onPress={startArrange} />
        </View>
      )}

      {/* ════════════════════════════════════════════════════
          PHASE: arrange — tap-to-place proof puzzle
          ════════════════════════════════════════════════════ */}
      {phase === 'arrange' && theorem && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(280)}>
            <Text style={styles.arrangeTitle}>
              {theorem.title}
            </Text>
            <Text style={styles.arrangeSubtitle}>
              {checked
                ? 'Review your proof below'
                : `Arrange the ${theorem.steps.length} proof steps in the correct logical order`}
            </Text>

            {/* Proof slot grid */}
            <Text style={styles.proofLabel}>PROOF — ثبوت</Text>
            {theorem.steps.map((_, slotIndex) => {
              const placedStep = stepById(placedIds[slotIndex] ?? null);
              const correct = isSlotCorrect(slotIndex);
              const correctStep = correctStepForSlot(slotIndex);

              return (
                <Pressable
                  key={`slot-${slotIndex}`}
                  onPress={() => {
                    if (placedIds[slotIndex]) removeStep(slotIndex);
                  }}
                  style={[
                    styles.proofSlot,
                    placedStep && styles.proofSlotFilled,
                    checked && correct === true && styles.proofSlotCorrect,
                    checked && correct === false && placedStep && styles.proofSlotWrong,
                  ]}
                >
                  <View style={styles.stepNumberCircle}>
                    {checked && correct === true ? (
                      <CheckIcon size={12} color={color.green} strokeWidth={2.8} />
                    ) : (
                      <Text style={[
                        styles.stepNumber,
                        checked && correct === false && placedStep && { color: color.rust },
                      ]}>
                        {slotIndex + 1}
                      </Text>
                    )}
                  </View>

                  <View style={{ flex: 1 }}>
                    {placedStep ? (
                      <>
                        <Text style={[
                          styles.placedStatement,
                          checked && correct === false && { color: color.rust },
                        ]}>
                          {placedStep.statement}
                        </Text>
                        <Text style={[
                          styles.placedReason,
                          checked && correct === false && { color: color.rust, opacity: 0.8 },
                        ]}>
                          {placedStep.reason}
                        </Text>
                        {/* Show correct step when wrong */}
                        {checked && correct === false && correctStep && (
                          <Animated.View entering={FadeInUp.duration(250)} style={styles.correctHintBox}>
                            <Text style={styles.correctHintLabel}>Should be (Step {slotIndex + 1}):</Text>
                            <Text style={styles.correctHintText}>{correctStep.statement}</Text>
                          </Animated.View>
                        )}
                      </>
                    ) : (
                      <Text style={styles.emptySlotText}>
                        {checked ? '— not placed —' : 'Tap a step below to place here'}
                      </Text>
                    )}
                  </View>

                  {placedStep && !checked && (
                    <Text style={styles.removeHint}>↩</Text>
                  )}
                </Pressable>
              );
            })}

            {/* Step pool */}
            {!checked && pool.length > 0 && (
              <>
                <Text style={styles.poolLabel}>
                  AVAILABLE STEPS — tap to place ({pool.length} remaining)
                </Text>
                {pool.map((s) => (
                  <Pressable
                    key={s.id}
                    onPress={() => placeStep(s.id)}
                    style={styles.poolCard}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.poolStatement}>{s.statement}</Text>
                      <Text style={styles.poolReason}>{s.reason}</Text>
                    </View>
                    <ChevronIcon size={14} color={color.inkFaint} />
                  </Pressable>
                ))}
              </>
            )}

            {/* Score after check */}
            {checked && currentScore && (
              <Animated.View entering={FadeInUp.duration(300)} style={styles.scoreBox}>
                <Text style={styles.scoreTitle}>
                  {currentScore.correct === currentScore.total
                    ? '🎉 Perfect proof!'
                    : currentScore.correct >= currentScore.total * 0.7
                    ? '👍 Good — a few steps off'
                    : '📖 Keep practising this theorem'}
                </Text>
                <Text style={styles.scoreSubtitle}>
                  {currentScore.correct}/{currentScore.total} steps in correct position
                </Text>
              </Animated.View>
            )}

            <View style={{ height: 100 }} />
          </Animated.View>
        </ScrollView>
      )}

      {phase === 'arrange' && theorem && (
        <View style={[styles.bottomAction, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {!checked ? (
            <PrimaryButton
              label="Check My Proof"
              onPress={checkProof}
              disabled={placedIds.every((id) => id === null)}
            />
          ) : (
            <View style={{ gap: 10 }}>
              <PrimaryButton
                label={theoremIndex + 1 >= theorems.length ? 'See Results' : 'Next Theorem →'}
                onPress={nextTheorem}
              />
              <PrimaryButton
                label="Try Again"
                variant="ghost"
                onPress={() => {
                  // Remove last score for this theorem so it can be re-scored
                  setScores((prev) => prev.filter((s) => s.theoremId !== theorem.id));
                  initArrange();
                  setChecked(false);
                }}
              />
            </View>
          )}
        </View>
      )}

      {/* ════════════════════════════════════════════════════
          PHASE: complete — overall results screen
          ════════════════════════════════════════════════════ */}
      {phase === 'complete' && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.scrollContent, { alignItems: 'center' }]}
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeInDown.duration(400)} style={{ width: '100%', alignItems: 'center' }}>
            <Text style={styles.completeUrdu}>شاباش!</Text>
            <ProgressRing
              progress={totalMastered / theorems.length}
              size={140}
              strokeWidth={11}
              tint={
                totalMastered === theorems.length
                  ? color.green
                  : totalMastered >= theorems.length * 0.6
                  ? color.gold
                  : color.rust
              }
            >
              <Text style={styles.ringScore}>{totalMastered}/{theorems.length}</Text>
            </ProgressRing>
            <Text style={styles.completeTitle}>
              {totalMastered === theorems.length
                ? 'All theorems mastered!'
                : totalMastered >= Math.ceil(theorems.length * 0.6)
                ? 'Strong work — keep going'
                : 'Theorems need more practice'}
            </Text>
            <Text style={styles.completeSub}>
              In your board paper, Q9 asks you to write one full proof from memory.
              {totalMastered < theorems.length
                ? ' Focus on the theorems you got wrong — they decide your marks.'
                : ' You are ready for Q9!'}
            </Text>

            {/* Per-theorem breakdown */}
            <View style={styles.breakdownCard}>
              {theorems.map((t, i) => {
                const sc = scores.find((s) => s.theoremId === t.id);
                const perfect = sc && sc.correct === sc.total;
                return (
                  <View
                    key={t.id}
                    style={[styles.breakdownRow, i < theorems.length - 1 && styles.breakdownDivider]}
                  >
                    <View style={styles.breakdownDot}>
                      {perfect ? (
                        <CheckIcon size={12} color={color.green} strokeWidth={2.6} />
                      ) : (
                        <View style={styles.breakdownDotInner} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.breakdownTitle} numberOfLines={1}>
                        {t.title}
                      </Text>
                      <Text style={styles.breakdownSub}>
                        Ch. {t.chapterNo} · {sc ? `${sc.correct}/${sc.total} steps correct` : 'skipped'}
                      </Text>
                    </View>
                    {!perfect && sc && (
                      <View style={styles.weakBadge}>
                        <Text style={styles.weakBadgeText}>revise</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            <View style={{ width: '100%', gap: 10, marginTop: space.xxl }}>
              <PrimaryButton label="Practice Again" onPress={restart} />
              <PrimaryButton label="Done" variant="ghost" onPress={() => router.back()} />
            </View>
            <View style={{ height: 32 }} />
          </Animated.View>
        </ScrollView>
      )}
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
    paddingBottom: space.sm,
  },
  closeText: { fontSize: 20, color: color.inkSoft, fontFamily: font.medium },
  topLabel: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: color.greenMid,
  },
  topTitle: { ...type.smallMedium, fontSize: 14, color: color.ink },
  counterBadge: {
    backgroundColor: color.greenSoft,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  counterText: { fontFamily: font.semibold, fontSize: 12, color: color.green },

  progressTrack: {
    height: 3,
    backgroundColor: color.line,
    marginHorizontal: space.xl,
    borderRadius: 2,
    overflow: 'hidden',
    marginBottom: space.md,
  },
  progressFill: { height: '100%', backgroundColor: color.green },

  scrollContent: { paddingHorizontal: space.xl, paddingBottom: 32 },

  // ── Read phase ──
  chapterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: space.md,
  },
  chapterBadgeText: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 0.8,
    color: color.inkSoft,
    textTransform: 'uppercase',
    flex: 1,
  },
  marksBadge: {
    backgroundColor: color.goldSoft,
    borderRadius: radius.full,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  marksText: { fontFamily: font.semibold, fontSize: 11, color: color.goldDeep },

  theoremTitle: {
    fontFamily: font.bold,
    fontSize: 21,
    lineHeight: 28,
    color: color.ink,
    marginBottom: space.md,
  },
  statementCard: {
    backgroundColor: color.inkWash,
    borderRadius: radius.md,
    padding: space.lg,
    marginBottom: space.lg,
  },
  statementText: {
    fontFamily: font.medium,
    fontSize: 14,
    lineHeight: 22,
    color: color.paperOnDark,
    fontStyle: 'italic',
  },

  sectionLabel: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: color.greenMid,
    textTransform: 'uppercase',
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  infoCard: {
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    padding: space.lg,
  },
  infoText: { ...type.body, color: color.ink, lineHeight: 23 },

  hintCard: {
    backgroundColor: color.cardWarm,
    borderRadius: radius.md,
    padding: space.lg,
    marginTop: space.xl,
    borderWidth: 1,
    borderColor: color.lineStrong,
  },
  hintLabel: { fontFamily: font.semibold, fontSize: 13, color: color.gold, marginBottom: 6 },
  hintText: { ...type.small, color: color.inkSoft, lineHeight: 20 },

  bottomAction: {
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    backgroundColor: color.paper,
  },

  // ── Arrange phase ──
  arrangeTitle: {
    fontFamily: font.bold,
    fontSize: 18,
    lineHeight: 24,
    color: color.ink,
    marginBottom: 4,
  },
  arrangeSubtitle: { ...type.small, color: color.inkFaint, marginBottom: space.xl },

  proofLabel: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: color.greenMid,
    textTransform: 'uppercase',
    marginBottom: space.sm,
  },

  proofSlot: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.line,
    borderStyle: 'dashed',
    padding: space.md,
    marginBottom: 8,
    minHeight: 52,
  },
  proofSlotFilled: {
    borderStyle: 'solid',
    borderColor: color.lineStrong,
    backgroundColor: color.card,
  },
  proofSlotCorrect: {
    borderStyle: 'solid',
    borderColor: color.green,
    backgroundColor: color.greenSoft,
  },
  proofSlotWrong: {
    borderStyle: 'solid',
    borderColor: color.rust,
    backgroundColor: color.rustSoft,
  },

  stepNumberCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  stepNumber: {
    fontFamily: font.bold,
    fontSize: 11,
    color: color.green,
  },

  placedStatement: {
    fontFamily: font.medium,
    fontSize: 13,
    color: color.ink,
    lineHeight: 19,
  },
  placedReason: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.inkFaint,
    marginTop: 2,
    lineHeight: 16,
  },

  correctHintBox: {
    marginTop: 6,
    padding: 8,
    backgroundColor: color.greenSoft,
    borderRadius: radius.sm,
  },
  correctHintLabel: {
    fontFamily: font.semibold,
    fontSize: 10,
    color: color.greenDeep,
    letterSpacing: 0.5,
  },
  correctHintText: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.greenDeep,
    marginTop: 2,
  },

  emptySlotText: {
    ...type.small,
    color: color.inkFaint,
    fontStyle: 'italic',
    paddingTop: 4,
  },
  removeHint: {
    fontFamily: font.semibold,
    fontSize: 16,
    color: color.inkFaint,
    alignSelf: 'center',
  },

  poolLabel: {
    fontFamily: font.semibold,
    fontSize: 10,
    letterSpacing: 1.2,
    color: color.inkFaint,
    textTransform: 'uppercase',
    marginTop: space.lg,
    marginBottom: space.sm,
  },
  poolCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.lineStrong,
    padding: space.md,
    marginBottom: 8,
  },
  poolStatement: { fontFamily: font.medium, fontSize: 13, color: color.ink, lineHeight: 19 },
  poolReason: { fontFamily: font.regular, fontSize: 11, color: color.inkFaint, marginTop: 2, lineHeight: 16 },

  scoreBox: {
    backgroundColor: color.cardWarm,
    borderRadius: radius.md,
    padding: space.lg,
    marginTop: space.xl,
    alignItems: 'center',
  },
  scoreTitle: { fontFamily: font.semibold, fontSize: 15, color: color.ink, textAlign: 'center' },
  scoreSubtitle: { ...type.small, color: color.inkSoft, marginTop: 6, textAlign: 'center' },

  // ── Complete phase ──
  completeUrdu: {
    fontFamily: font.urduBold,
    fontSize: 36,
    lineHeight: 72,
    color: color.gold,
    textAlign: 'center',
  },
  ringScore: { fontFamily: font.bold, fontSize: 28, color: color.ink },
  completeTitle: {
    ...type.title,
    fontSize: 22,
    color: color.ink,
    textAlign: 'center',
    marginTop: space.xl,
  },
  completeSub: {
    ...type.small,
    color: color.inkSoft,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
    marginBottom: space.xl,
  },

  breakdownCard: {
    width: '100%',
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
  },
  breakdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: space.lg,
    paddingVertical: 13,
  },
  breakdownDivider: { borderBottomWidth: 1, borderBottomColor: color.line },
  breakdownDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakdownDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.rustSoft,
    borderWidth: 1.5,
    borderColor: color.rust,
  },
  breakdownTitle: { fontFamily: font.medium, fontSize: 13, color: color.ink },
  breakdownSub: { ...type.micro, color: color.inkFaint, marginTop: 2 },
  weakBadge: {
    backgroundColor: color.rustSoft,
    borderRadius: radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  weakBadgeText: { fontFamily: font.semibold, fontSize: 10, color: color.rust },
});
