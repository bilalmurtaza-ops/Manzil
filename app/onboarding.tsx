import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
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
import { PrimaryButton } from '../src/components/PrimaryButton';
import { BOARDS } from '../src/data/boards';
import { subjectsForProfile } from '../src/data/syllabus';
import { generatePlan, todayISO } from '../src/lib/planEngine';
import type { ClassLevel, StudentProfile, StudyGroup } from '../src/lib/types';
import { useAppStore } from '../src/store/useAppStore';
import { color, font, radius, space, subjectColor, type } from '../src/theme/tokens';

const STEPS = ['welcome', 'name', 'class', 'group', 'board', 'date', 'time', 'confidence'] as const;
type Step = (typeof STEPS)[number];

const GROUPS: { id: StudyGroup; label: string; sub: string }[] = [
  { id: 'science-bio', label: 'Science — Biology', sub: 'Physics · Chemistry · Biology' },
  { id: 'science-cs', label: 'Science — Computer', sub: 'Physics · Chemistry · Computer Science' },
  { id: 'arts', label: 'Arts / General', sub: 'General Math · General Science · electives' },
];

const TIME_OPTIONS = [
  { minutes: 60, label: '1 hour', sub: 'Light but steady' },
  { minutes: 90, label: '1.5 hours', sub: 'Balanced routine' },
  { minutes: 120, label: '2 hours', sub: 'Solid preparation' },
  { minutes: 180, label: '3 hours', sub: 'Serious push' },
  { minutes: 240, label: '4+ hours', sub: 'Exam-season mode' },
];

function defaultExamDate(classLevel: ClassLevel): string {
  // Punjab boards: 10th papers usually start early March, 9th mid April.
  const now = new Date();
  const year = now.getMonth() >= 4 ? now.getFullYear() + 1 : now.getFullYear();
  return classLevel === '10' ? `${year}-03-04` : `${year}-04-15`;
}

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// Exam date must stay in the future — the plan engine needs at least a few days of runway,
// and an exam "today"/in the past silently degraded to a meaningless 3-day plan.
function clampExamDate(iso: string): string {
  const min = shiftDate(todayISO(), 1);
  return iso < min ? min : iso;
}

function prettyDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function Onboarding() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const setProfile = useAppStore((s) => s.setProfile);
  const setPlan = useAppStore((s) => s.setPlan);

  const [stepIndex, setStepIndex] = useState(0);
  const [name, setName] = useState('');
  const [classLevel, setClassLevel] = useState<ClassLevel | null>(null);
  const [group, setGroup] = useState<StudyGroup | null>(null);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [examDate, setExamDate] = useState<string | null>(null);
  const [dailyMinutes, setDailyMinutes] = useState<number | null>(null);
  const [confidence, setConfidence] = useState<Record<string, number>>({});
  const [building, setBuilding] = useState(false);

  const step: Step = STEPS[stepIndex];

  const subjects = useMemo(
    () => (classLevel && group ? subjectsForProfile(classLevel, group) : []),
    [classLevel, group],
  );

  const canContinue = (() => {
    switch (step) {
      case 'welcome':
        return true;
      case 'name':
        return name.trim().length >= 2;
      case 'class':
        return classLevel !== null;
      case 'group':
        return group !== null;
      case 'board':
        return boardId !== null;
      case 'date':
        return examDate !== null;
      case 'time':
        return dailyMinutes !== null;
      case 'confidence':
        return true;
    }
  })();

  const next = () => {
    if (stepIndex < STEPS.length - 1) {
      Haptics.selectionAsync();
      // Seed exam date when reaching the date step.
      if (STEPS[stepIndex + 1] === 'date' && !examDate && classLevel) {
        setExamDate(defaultExamDate(classLevel));
      }
      setStepIndex(stepIndex + 1);
    } else {
      finish();
    }
  };

  const back = () => stepIndex > 0 && setStepIndex(stepIndex - 1);

  const finish = () => {
    if (!classLevel || !group || !boardId || !examDate || !dailyMinutes) return;
    setBuilding(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // Let the UI paint the "building" state before the sync generation runs.
    setTimeout(() => {
      const profile: StudentProfile = {
        name: name.trim(),
        classLevel,
        group,
        boardId,
        examDate,
        dailyMinutes,
        confidence,
        createdAt: new Date().toISOString(),
      };
      const plan = generatePlan(profile);
      setProfile(profile);
      setPlan(plan);
      router.replace('/(tabs)/today');
    }, 350);
  };

  if (building) {
    return (
      <View style={[styles.root, styles.center]}>
        <Animated.Text entering={FadeInDown.duration(400)} style={styles.buildingUrdu}>
          منزل
        </Animated.Text>
        <Animated.Text entering={FadeInDown.delay(150).duration(400)} style={styles.buildingText}>
          Building your personal roadmap…
        </Animated.Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, { paddingTop: insets.top + space.lg }]}>
        {/* Progress */}
        {step !== 'welcome' && (
          <View style={styles.progressRow}>
            <Pressable onPress={back} hitSlop={12}>
              <Text style={styles.backText}>←</Text>
            </Pressable>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${(stepIndex / (STEPS.length - 1)) * 100}%` }]}
              />
            </View>
          </View>
        )}

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {step === 'welcome' && (
            <View style={styles.welcome}>
              <Animated.Text entering={FadeInDown.duration(500)} style={styles.wordmarkUrdu}>
                منزل
              </Animated.Text>
              <Animated.Text entering={FadeInDown.delay(100).duration(500)} style={styles.wordmark}>
                Manzil
              </Animated.Text>
              <Animated.Text entering={FadeInDown.delay(200).duration(500)} style={styles.tagline}>
                Your board exams, mapped.{'\n'}A personal AI ustaad that knows your syllabus,
                your pairing scheme, and exactly what you should study today.
              </Animated.Text>
              <Animated.View entering={FadeInUp.delay(350).duration(500)} style={styles.factCard}>
                <Text style={styles.factNumber}>5,00,000+</Text>
                <Text style={styles.factText}>
                  students failed matric last year — almost all of them without a real study plan.
                  You won't be one of them.
                </Text>
              </Animated.View>
            </View>
          )}

          {step === 'name' && (
            <StepBlock title="What should we call you?" urdu="آپ کا نام؟">
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Your name"
                placeholderTextColor={color.inkFaint}
                style={styles.input}
                autoFocus
                maxLength={24}
                returnKeyType="done"
                onSubmitEditing={() => canContinue && next()}
              />
            </StepBlock>
          )}

          {step === 'class' && (
            <StepBlock title="Which class are you in?" urdu="کون سی کلاس؟">
              {(['9', '10'] as ClassLevel[]).map((c) => (
                <OptionCard
                  key={c}
                  label={c === '9' ? 'Class 9 — SSC Part I' : 'Class 10 — SSC Part II'}
                  sub={c === '9' ? 'First year of matric' : 'Board year — the big one'}
                  selected={classLevel === c}
                  onPress={() => setClassLevel(c)}
                />
              ))}
            </StepBlock>
          )}

          {step === 'group' && (
            <StepBlock title="Your study group?" urdu="آپ کا گروپ؟">
              {GROUPS.map((g) => (
                <OptionCard
                  key={g.id}
                  label={g.label}
                  sub={g.sub}
                  selected={group === g.id}
                  onPress={() => setGroup(g.id)}
                />
              ))}
            </StepBlock>
          )}

          {step === 'board' && (
            <StepBlock title="Your board?" urdu="آپ کا بورڈ؟">
              {BOARDS.map((b) => (
                <OptionCard
                  key={b.id}
                  label={b.name}
                  sub={b.available ? b.city : 'Coming soon'}
                  selected={boardId === b.id}
                  disabled={!b.available}
                  onPress={() => setBoardId(b.id)}
                />
              ))}
            </StepBlock>
          )}

          {step === 'date' && examDate && (
            <StepBlock
              title="When do your papers start?"
              urdu="امتحان کب؟"
              sub="Set the expected date — you can change it anytime."
            >
              <View style={styles.dateCard}>
                <Text style={styles.dateBig}>{prettyDate(examDate)}</Text>
                <Text style={styles.dateCountdown}>
                  {Math.max(
                    1,
                    Math.ceil(
                      (new Date(`${examDate}T00:00:00`).getTime() - Date.now()) / 86_400_000,
                    ),
                  )}{' '}
                  days from today
                </Text>
              </View>
              <View style={styles.adjustRow}>
                {[
                  { label: '−1 week', days: -7 },
                  { label: '−1 day', days: -1 },
                  { label: '+1 day', days: 1 },
                  { label: '+1 week', days: 7 },
                ].map((a) => {
                  const atFloor = a.days < 0 && examDate <= shiftDate(todayISO(), 1);
                  return (
                    <Pressable
                      key={a.label}
                      style={[styles.adjustChip, atFloor && styles.adjustChipDisabled]}
                      disabled={atFloor}
                      onPress={() => {
                        Haptics.selectionAsync();
                        setExamDate((d) => (d ? clampExamDate(shiftDate(d, a.days)) : d));
                      }}
                    >
                      <Text style={[styles.adjustText, atFloor && styles.adjustTextDisabled]}>
                        {a.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.presetRow}>
                {[
                  { label: 'Early March', date: `${examDate.slice(0, 4)}-03-04` },
                  { label: 'Mid April', date: `${examDate.slice(0, 4)}-04-15` },
                  { label: 'Mid May', date: `${examDate.slice(0, 4)}-05-15` },
                ].map((p) => (
                  <Pressable
                    key={p.label}
                    style={[styles.presetChip, examDate === p.date && styles.presetChipActive]}
                    onPress={() => {
                      Haptics.selectionAsync();
                      setExamDate(clampExamDate(p.date));
                    }}
                  >
                    <Text
                      style={[styles.presetText, examDate === p.date && styles.presetTextActive]}
                    >
                      {p.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </StepBlock>
          )}

          {step === 'time' && (
            <StepBlock title="Daily study time?" urdu="روزانہ کتنا وقت؟" sub="Be honest — the plan adapts to reality, not wishes.">
              {TIME_OPTIONS.map((t) => (
                <OptionCard
                  key={t.minutes}
                  label={t.label}
                  sub={t.sub}
                  selected={dailyMinutes === t.minutes}
                  onPress={() => setDailyMinutes(t.minutes)}
                />
              ))}
            </StepBlock>
          )}

          {step === 'confidence' && (
            <StepBlock
              title="Rate yourself in each subject"
              urdu="ہر مضمون میں اپنی تیاری"
              sub="1 = weak, 5 = strong. Weak subjects get more time in your plan."
            >
              {subjects.map((s) => (
                <View key={s.id} style={styles.confRow}>
                  <View style={styles.confLabelWrap}>
                    <View
                      style={[
                        styles.subjectDot,
                        { backgroundColor: subjectColor[s.colorKey]?.main ?? color.ink },
                      ]}
                    />
                    <Text style={styles.confLabel} numberOfLines={1}>
                      {s.name}
                    </Text>
                  </View>
                  <View style={styles.confDots}>
                    {[1, 2, 3, 4, 5].map((v) => {
                      const active = (confidence[s.id] ?? 3) >= v;
                      return (
                        <Pressable
                          key={v}
                          hitSlop={6}
                          onPress={() => {
                            Haptics.selectionAsync();
                            setConfidence((c) => ({ ...c, [s.id]: v }));
                          }}
                        >
                          <View
                            style={[
                              styles.confDot,
                              active && {
                                backgroundColor: subjectColor[s.colorKey]?.main ?? color.green,
                                borderColor: 'transparent',
                              },
                            ]}
                          />
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}
            </StepBlock>
          )}
        </ScrollView>

        <View style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
          <PrimaryButton
            label={
              step === 'welcome'
                ? 'Start — 60 seconds'
                : step === 'confidence'
                  ? 'Build my plan'
                  : 'Continue'
            }
            onPress={next}
            disabled={!canContinue}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function StepBlock({
  title,
  urdu,
  sub,
  children,
}: {
  title: string;
  urdu: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <Animated.View entering={FadeInDown.duration(350)}>
      <Text style={styles.stepUrdu}>{urdu}</Text>
      <Text style={styles.stepTitle}>{title}</Text>
      {sub ? <Text style={styles.stepSub}>{sub}</Text> : null}
      <View style={{ height: space.xl }} />
      {children}
    </Animated.View>
  );
}

function OptionCard({
  label,
  sub,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  sub?: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={() => {
        if (disabled) return;
        Haptics.selectionAsync();
        onPress();
      }}
      style={[
        styles.option,
        selected && styles.optionSelected,
        disabled && styles.optionDisabled,
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionLabel, selected && styles.optionLabelSelected]}>{label}</Text>
        {sub ? <Text style={styles.optionSub}>{sub}</Text> : null}
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioInner} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  center: { alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, paddingHorizontal: space.xl },

  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: space.xl },
  backText: { fontSize: 22, color: color.inkSoft, fontFamily: font.medium },
  progressTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.line,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: color.green, borderRadius: 2 },

  welcome: { paddingTop: 48 },
  wordmarkUrdu: {
    fontFamily: font.urduBold,
    fontSize: 64,
    lineHeight: 130,
    color: color.green,
  },
  wordmark: { ...type.display, fontSize: 40, color: color.ink, marginTop: -16 },
  tagline: { ...type.body, color: color.inkSoft, marginTop: space.lg, fontSize: 16, lineHeight: 24 },
  factCard: {
    marginTop: space.xxl,
    backgroundColor: color.inkWash,
    borderRadius: radius.lg,
    padding: space.xl,
  },
  factNumber: { fontFamily: font.bold, fontSize: 28, color: color.gold },
  factText: { ...type.body, color: color.fadedOnDark, marginTop: 6 },

  buildingUrdu: { fontFamily: font.urduBold, fontSize: 56, lineHeight: 120, color: color.green },
  buildingText: { ...type.bodyMedium, color: color.inkSoft, marginTop: 8 },

  stepUrdu: { fontFamily: font.urdu, fontSize: 18, lineHeight: 44, color: color.greenMid },
  stepTitle: { ...type.title, color: color.ink, marginTop: 2 },
  stepSub: { ...type.small, color: color.inkFaint, marginTop: 8 },

  input: {
    height: 58,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.lineStrong,
    backgroundColor: color.card,
    paddingHorizontal: 18,
    fontFamily: font.medium,
    fontSize: 18,
    color: color.ink,
  },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.line,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 10,
  },
  optionSelected: { borderColor: color.green, backgroundColor: color.greenSoft },
  optionDisabled: { opacity: 0.45 },
  optionLabel: { ...type.bodyMedium, fontSize: 16, color: color.ink },
  optionLabelSelected: { color: color.greenDeep },
  optionSub: { ...type.small, color: color.inkFaint, marginTop: 2 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: color.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: color.green },
  radioInner: { width: 11, height: 11, borderRadius: 6, backgroundColor: color.green },

  dateCard: {
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: color.line,
    padding: space.xl,
    alignItems: 'center',
  },
  dateBig: { fontFamily: font.bold, fontSize: 20, color: color.ink },
  dateCountdown: { ...type.small, color: color.greenMid, marginTop: 6, fontFamily: font.medium },
  adjustRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  adjustChip: {
    flex: 1,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: color.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.card,
  },
  adjustText: { ...type.smallMedium, color: color.inkSoft },
  adjustChipDisabled: { opacity: 0.4 },
  adjustTextDisabled: { color: color.inkFaint },
  presetRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  presetChip: {
    flex: 1,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.cardWarm,
  },
  presetChipActive: { backgroundColor: color.green },
  presetText: { ...type.smallMedium, color: color.inkSoft },
  presetTextActive: { color: color.paperOnDark },

  confRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 8,
  },
  confLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  subjectDot: { width: 8, height: 8, borderRadius: 4 },
  confLabel: { ...type.bodyMedium, color: color.ink, flexShrink: 1 },
  confDots: { flexDirection: 'row', gap: 7 },
  confDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: color.lineStrong,
    backgroundColor: color.card,
  },
});
