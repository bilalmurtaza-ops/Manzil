import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { color, font, radius, space, type } from '../src/theme/tokens';

/** Matches the visual character of Easing.inOut(Easing.sin) without depending on
 * reanimated's UI-thread callback scheduling, which the phase clock below avoids entirely. */
function easeInOutSine(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

// Box breathing (4-4-4-4): equal inhale/hold/exhale/hold, the standard rhythm used
// clinically and by the military for fast anxiety/stress downregulation.
type Phase = 'inhale' | 'hold1' | 'exhale' | 'hold2';
const PHASES: Phase[] = ['inhale', 'hold1', 'exhale', 'hold2'];
const PHASE_MS = 4000;
const PHASE_LABEL: Record<Phase, string> = {
  inhale: 'Breathe in',
  hold1: 'Hold',
  exhale: 'Breathe out',
  hold2: 'Hold',
};
const PHASE_URDU: Record<Phase, string> = {
  inhale: 'سانس اندر',
  hold1: 'روکیں',
  exhale: 'سانس باہر',
  hold2: 'روکیں',
};

const CYCLE_OPTIONS = [
  { cycles: 4, label: '4 rounds', sub: '~1 minute · quick reset' },
  { cycles: 8, label: '8 rounds', sub: '~2 minutes · standard' },
  { cycles: 12, label: '12 rounds', sub: '~3 minutes · deep calm' },
];

type Stage = 'setup' | 'active' | 'done';

export default function BreatheScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [stage, setStage] = useState<Stage>('setup');
  const [totalCycles, setTotalCycles] = useState(8);
  const [cycle, setCycle] = useState(0);
  const [phase, setPhase] = useState<Phase>('inhale');
  const [paused, setPaused] = useState(false);

  // 0 = fully exhaled, 1 = fully inhaled — the single source of truth the orb renders from.
  const breath = useSharedValue(0);

  const phaseIndexRef = useRef(0);
  const cycleRef = useRef(0);
  const totalCyclesRef = useRef(totalCycles);
  const phaseStartedAtRef = useRef(0);
  const phaseDurationRef = useRef(PHASE_MS);
  // The phase clock (tick + timeout) runs on the JS thread, not reanimated's UI-thread
  // callback — the same reliable pattern focus.tsx already uses for its countdown timer.
  const tickIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTick = () => {
    if (tickIntervalRef.current) {
      clearInterval(tickIntervalRef.current);
      tickIntervalRef.current = null;
    }
    if (phaseTimeoutRef.current) {
      clearTimeout(phaseTimeoutRef.current);
      phaseTimeoutRef.current = null;
    }
  };

  useEffect(() => () => stopTick(), []);

  const runPhase = (index: number, durationMs: number) => {
    const to = index === 0 || index === 1 ? 1 : 0;
    const isMotionPhase = index === 0 || index === 2;
    const from = breath.value;
    const startedAt = Date.now();
    phaseStartedAtRef.current = startedAt;
    phaseDurationRef.current = durationMs;

    stopTick();
    if (isMotionPhase) {
      // Self-clears only its own interval on completion — must never touch phaseTimeoutRef,
      // which is the sole authority for advancing the phase (see below).
      tickIntervalRef.current = setInterval(() => {
        const t = Math.min((Date.now() - startedAt) / durationMs, 1);
        breath.value = from + (to - from) * easeInOutSine(t);
        if (t >= 1 && tickIntervalRef.current) {
          clearInterval(tickIntervalRef.current);
          tickIntervalRef.current = null;
        }
      }, 33);
    } else {
      breath.value = to;
    }
    phaseTimeoutRef.current = setTimeout(() => advance(index), durationMs);
  };

  const advance = (completedIndex: number) => {
    Haptics.selectionAsync();
    const nextIndex = (completedIndex + 1) % PHASES.length;
    if (nextIndex === 0) {
      const next = cycleRef.current + 1;
      cycleRef.current = next;
      setCycle(next);
      if (next >= totalCyclesRef.current) {
        finish();
        return;
      }
    }
    phaseIndexRef.current = nextIndex;
    setPhase(PHASES[nextIndex]);
    runPhase(nextIndex, PHASE_MS);
  };

  const begin = (cycles: number) => {
    setTotalCycles(cycles);
    totalCyclesRef.current = cycles;
    cycleRef.current = 0;
    phaseIndexRef.current = 0;
    setCycle(0);
    setPhase('inhale');
    setPaused(false);
    setStage('active');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    breath.value = 0;
    runPhase(0, PHASE_MS);
  };

  const togglePause = () => {
    Haptics.selectionAsync();
    if (paused) {
      setPaused(false);
      runPhase(phaseIndexRef.current, phaseDurationRef.current);
    } else {
      const elapsed = Date.now() - phaseStartedAtRef.current;
      phaseDurationRef.current = Math.max(phaseDurationRef.current - elapsed, 50);
      setPaused(true);
      stopTick();
    }
  };

  const finish = () => {
    stopTick();
    setPaused(false);
    setStage('done');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const orbStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.7 + breath.value * 0.52 }],
  }));
  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.82 + breath.value * 0.42 }],
    opacity: 0.22 + breath.value * 0.26,
  }));

  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + space.lg, paddingBottom: Math.max(insets.bottom, space.lg) },
      ]}
    >
      <Stack.Screen options={{ animation: 'slide_from_bottom' }} />

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      {stage === 'setup' && (
        <Animated.View entering={FadeInDown.duration(400)} style={[styles.center, { flex: 1 }]}>
          <Text style={styles.setupUrdu}>سانس</Text>
          <Text style={styles.setupTitle}>Box Breathing</Text>
          <Text style={styles.setupSub}>
            4 seconds in, 4 hold, 4 out, 4 hold. A slow, steady rhythm used to settle exam nerves
            in minutes — no equipment, just your breath.
          </Text>

          <View style={styles.cycleOptions}>
            {CYCLE_OPTIONS.map((o) => (
              <Pressable key={o.cycles} style={styles.cycleOption} onPress={() => begin(o.cycles)}>
                <View>
                  <Text style={styles.cycleOptionLabel}>{o.label}</Text>
                  <Text style={styles.cycleOptionSub}>{o.sub}</Text>
                </View>
                <View style={styles.cycleOptionArrow}>
                  <Text style={styles.cycleOptionArrowText}>→</Text>
                </View>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      )}

      {stage === 'active' && (
        <View style={[styles.center, { flex: 1 }]}>
          <Text style={styles.cycleCounter}>
            Round {cycle + 1} of {totalCycles}
          </Text>

          <View style={styles.orbWrap}>
            <Animated.View style={[styles.halo, haloStyle]} />
            <Animated.View style={[styles.orbOuter, orbStyle]}>
              <Svg width={220} height={220} viewBox="0 0 220 220">
                <Defs>
                  <RadialGradient id="orbGrad" cx="36%" cy="30%" r="78%">
                    <Stop offset="0%" stopColor={color.greenMid} stopOpacity={1} />
                    <Stop offset="100%" stopColor={color.greenDeep} stopOpacity={1} />
                  </RadialGradient>
                </Defs>
                <Circle cx={110} cy={110} r={105} fill="url(#orbGrad)" />
              </Svg>
            </Animated.View>
            <View style={styles.phaseLabelWrap} pointerEvents="none">
              <Animated.Text
                key={phase}
                entering={FadeIn.duration(450)}
                exiting={FadeOut.duration(250)}
                style={styles.phaseLabel}
              >
                {PHASE_LABEL[phase]}
              </Animated.Text>
              <Animated.Text
                key={`${phase}-ur`}
                entering={FadeIn.delay(60).duration(450)}
                exiting={FadeOut.duration(250)}
                style={styles.phaseUrdu}
              >
                {PHASE_URDU[phase]}
              </Animated.Text>
            </View>
          </View>

          <View style={styles.controls}>
            <Pressable style={styles.controlGhost} onPress={togglePause}>
              <Text style={styles.controlGhostText}>{paused ? 'Resume' : 'Pause'}</Text>
            </Pressable>
            <Pressable style={styles.controlGhost} onPress={finish}>
              <Text style={styles.controlGhostText}>End</Text>
            </Pressable>
          </View>
        </View>
      )}

      {stage === 'done' && (
        <View style={[styles.center, { flex: 1 }]}>
          <Animated.Text entering={FadeInDown.duration(500)} style={styles.doneUrdu}>
            سکون
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(120).duration(500)} style={styles.doneTitle}>
            Well done
          </Animated.Text>
          <Animated.Text entering={FadeIn.delay(250).duration(500)} style={styles.doneMeta}>
            {cycle} round{cycle === 1 ? '' : 's'} of box breathing complete. Carry that calm into
            your next session.
          </Animated.Text>
          <Animated.View
            entering={FadeInDown.delay(400).duration(500)}
            style={{ marginTop: 48, width: '100%', paddingHorizontal: 40 }}
          >
            <Pressable style={styles.doneButton} onPress={() => router.back()}>
              <Text style={styles.doneButtonText}>Back to today</Text>
            </Pressable>
          </Animated.View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.inkWash, paddingHorizontal: space.xl },
  center: { alignItems: 'center', justifyContent: 'center' },
  topBar: { alignItems: 'flex-end' },
  closeText: { fontSize: 22, color: 'rgba(242,238,227,0.6)', fontFamily: font.medium },

  setupUrdu: { fontFamily: font.urduBold, fontSize: 40, lineHeight: 88, color: color.gold },
  setupTitle: { ...type.title, color: color.paperOnDark, marginTop: -6 },
  setupSub: {
    ...type.body,
    color: color.fadedOnDark,
    textAlign: 'center',
    marginTop: 12,
    paddingHorizontal: 12,
    lineHeight: 22,
  },

  cycleOptions: { width: '100%', marginTop: space.xxl },
  cycleOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(242,238,227,0.06)',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(242,238,227,0.14)',
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 10,
  },
  cycleOptionLabel: { fontFamily: font.semibold, fontSize: 16, color: color.paperOnDark },
  cycleOptionSub: { ...type.small, color: color.fadedOnDark, marginTop: 2 },
  cycleOptionArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.greenMid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cycleOptionArrowText: { color: color.paperOnDark, fontFamily: font.bold, fontSize: 15 },

  cycleCounter: {
    fontFamily: font.semibold,
    fontSize: 13,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: color.greenMid,
    marginBottom: 8,
  },

  orbWrap: {
    width: 320,
    height: 320,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 24,
  },
  halo: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(46,125,79,0.35)',
  },
  orbOuter: {
    width: 220,
    height: 220,
    borderRadius: 110,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: color.greenMid,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 12,
  },
  phaseLabelWrap: { position: 'absolute', alignItems: 'center' },
  phaseLabel: { fontFamily: font.bold, fontSize: 24, color: color.paperOnDark, letterSpacing: -0.3 },
  phaseUrdu: { fontFamily: font.urdu, fontSize: 16, lineHeight: 34, color: 'rgba(242,238,227,0.75)' },

  controls: { flexDirection: 'row', gap: 12, marginTop: 8 },
  controlGhost: {
    height: 50,
    paddingHorizontal: 28,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: 'rgba(242,238,227,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlGhostText: { fontFamily: font.medium, fontSize: 15, color: color.paperOnDark },

  doneUrdu: { fontFamily: font.urduBold, fontSize: 44, lineHeight: 96, color: color.gold },
  doneTitle: { ...type.title, color: color.paperOnDark },
  doneMeta: {
    ...type.small,
    color: 'rgba(242,238,227,0.6)',
    marginTop: 8,
    textAlign: 'center',
    paddingHorizontal: 40,
    lineHeight: 19,
  },
  doneButton: {
    height: 54,
    borderRadius: radius.lg,
    backgroundColor: color.greenMid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: { fontFamily: font.semibold, fontSize: 16, color: color.paperOnDark },
});
