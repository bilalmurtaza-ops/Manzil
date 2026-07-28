import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FocusTimeline } from '../src/components/FocusTimeline';
import { ProgressRing } from '../src/components/ProgressRing';
import { getChapter, getSubject } from '../src/data/syllabus';
import { FocusCameraView, useFocusGuard } from '../src/lib/focusGuard/camera';
import { attentionSpanMinutes } from '../src/lib/focusGuard';
import { playCue, preloadVoicePack, stopSpeaking } from '../src/lib/focusGuard/voice/player';
import { useAppStore } from '../src/store/useAppStore';
import { color, font, radius, space, type } from '../src/theme/tokens';

/**
 * Live status copy. Phrased as observations, never accusations — "looking away"
 * describes what the camera saw; "you were distracted" would be a verdict the
 * data does not support.
 */
const GUARD_LIVE_TEXT: Record<string, string> = {
  focused: 'Focus Guard — on track',
  glance: 'Focus Guard — on track',
  distracted: 'Looking away from your work',
  away: 'Timer paused until you are back',
  drowsy: 'Eyes closed — take a breath and stretch',
  uncertain: 'Focus Guard — can’t see clearly, not scoring',
};

export default function FocusScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const plan = useAppStore((s) => s.plan);
  const toggleSessionDone = useAppStore((s) => s.toggleSessionDone);

  const session = useMemo(
    () => plan?.sessions.find((s) => s.id === sessionId),
    [plan, sessionId],
  );
  const subject = session ? getSubject(session.subjectId) : undefined;
  const chapter = session ? getChapter(session.subjectId, session.chapterId) : undefined;

  const totalSeconds = (session?.minutes ?? 25) * 60;
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  const [running, setRunning] = useState(true);
  const [finished, setFinished] = useState(false);
  const finishedRef = useRef(false);

  const focusGuardEnabled = useAppStore((s) => s.focusGuardEnabled);
  const focusVoiceEnabled = useAppStore((s) => s.focusVoiceEnabled);
  const focusVoiceId = useAppStore((s) => s.focusVoiceId);
  const focusVoiceDistracted = useAppStore((s) => s.focusVoiceDistracted);
  const vibrationEnabled = useAppStore((s) => s.vibrationEnabled);
  const recordAttentionSpan = useAppStore((s) => s.recordAttentionSpan);

  const focus = useFocusGuard({
    enabled: focusGuardEnabled,
    paused: !running,
    finished,
    speakOnDistracted: focusVoiceEnabled && focusVoiceDistracted,
  });

  /**
   * The clock only counts time the student was actually there.
   *
   * This is the quiet heart of the feature: a 25-minute session now means 25
   * minutes of study, not 25 minutes of a timer running in an empty room. It
   * also means being away is never a punishment — the time simply isn't spent.
   */
  const timerRunning = running && !focus.away;

  // A single soft tap for sustained distraction, already rate-limited to at
  // most once every two minutes inside the hook. Never a sound, never a nag.
  useEffect(() => {
    if (focus.nudge === 0 || !vibrationEnabled) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft);
  }, [focus.nudge, vibrationEnabled]);

  // Resolve the clips up front so the first cue is instant — a spoken nudge
  // that arrives two seconds late is worse than none at all. Missing clips are
  // reported, never thrown: a half-installed pack degrades to silence.
  useEffect(() => {
    if (!focusVoiceEnabled) return;
    void preloadVoicePack().then((missing) => {
      if (missing.length > 0) {
        console.warn(`Focus Guard voice: ${missing.length} clip(s) unavailable`);
      }
    });
  }, [focusVoiceEnabled]);

  // Speak on token change, not on state — the hook decides WHEN (cues.ts owns
  // the transition rules and rate limiting), this only plays.
  useEffect(() => {
    if (!focusVoiceEnabled || !focus.voiceCue) return;
    // The chosen voice MUST be passed: omitting it silently fell back to the
    // default, so picking any other voice in Settings previewed correctly and
    // then played as Alice for the whole session.
    playCue(focus.voiceCue, focusVoiceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus.voiceCue?.token, focusVoiceEnabled, focusVoiceId]);

  // Leaving the screen mid-line must not leave a voice talking to an empty room.
  useEffect(() => () => stopSpeaking(), []);

  // Remember how long their concentration actually held, so the plan engine can
  // stop prescribing 45-minute blocks to someone whose attention breaks at 15.
  useEffect(() => {
    if (!finished || !focus.report) return;
    const span = attentionSpanMinutes(focus.report);
    if (span !== null && span > 0) recordAttentionSpan(span);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished, focus.report]);

  useEffect(() => {
    if (!timerRunning || finished) return;
    const t = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(t);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [timerRunning, finished]);

  useEffect(() => {
    if (secondsLeft === 0 && !finishedRef.current) {
      finishedRef.current = true;
      complete();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft]);

  const complete = () => {
    setFinished(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (session && !session.done) toggleSessionDone(session.id);
  };

  const mm = Math.floor(secondsLeft / 60);
  const ss = secondsLeft % 60;
  const progress = 1 - secondsLeft / totalSeconds;

  if (!session) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.metaText}>Session not found.</Text>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Text style={styles.closeLink}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.lg }]}>
      <Stack.Screen options={{ animation: 'slide_from_bottom' }} />

      {!finished ? (
        <>
          <View style={styles.topBar}>
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          </View>

          {/* Small, visible, and never hidden — the student can always see that
              the camera is on and what it can see. */}
          <FocusCameraView status={focus} />

          {focusGuardEnabled && focus.phase !== 'idle' && (
            <View style={styles.guardBar}>
              <View
                style={[
                  styles.guardDot,
                  {
                    backgroundColor:
                      focus.phase !== 'running'
                        ? color.inkFaint
                        : focus.state === 'focused' || focus.state === 'glance'
                          ? color.greenMid
                          : focus.state === 'uncertain'
                            ? color.inkFaint
                            : color.gold,
                  },
                ]}
              />
              <Text style={styles.guardText} numberOfLines={2}>
                {focus.message ??
                  (focus.phase === 'calibrating'
                    ? 'Focus Guard — settle into your reading position'
                    : focus.phase === 'permission'
                      ? 'Focus Guard — waiting for camera access'
                      : GUARD_LIVE_TEXT[focus.state])}
              </Text>

              {/* Calibration failure is terminal by design — it used to retry on
                  every frame, which re-spoke the failure line ~3x a second. So
                  recovery has to be something the student does: fix the light or
                  move the phone, then tap. The timer is never interrupted. */}
              {focus.phase === 'unavailable' && focus.calibrationFailure && (
                <Pressable onPress={focus.retryCalibration} hitSlop={10}>
                  <Text style={styles.guardRetry}>Try again</Text>
                </Pressable>
              )}
            </View>
          )}

          <View style={styles.center}>
            <Text style={styles.subjectText}>{subject?.name}</Text>
            <Text style={styles.chapterText} numberOfLines={2}>
              {chapter ? `${chapter.no}. ${chapter.name}` : ''}
            </Text>

            <View style={{ marginVertical: 40 }}>
              <ProgressRing
                progress={progress}
                size={240}
                strokeWidth={10}
                tint={color.greenMid}
                track="rgba(242,238,227,0.12)"
              >
                <Text style={styles.timerText}>
                  {mm}:{ss.toString().padStart(2, '0')}
                </Text>
                <Text style={styles.timerSub}>
                  {focus.away
                    ? 'paused — waiting for you'
                    : running
                      ? 'focus — phone down'
                      : 'paused'}
                </Text>
              </ProgressRing>
            </View>

            <View style={styles.controls}>
              <Pressable
                style={styles.controlGhost}
                onPress={() => {
                  Haptics.selectionAsync();
                  setRunning((r) => !r);
                }}
              >
                <Text style={styles.controlGhostText}>{running ? 'Pause' : 'Resume'}</Text>
              </Pressable>
              <Pressable
                style={styles.controlPrimary}
                onPress={() => {
                  finishedRef.current = true;
                  complete();
                }}
              >
                <Text style={styles.controlPrimaryText}>Done early</Text>
              </Pressable>
            </View>
          </View>
        </>
      ) : (
        <View style={[styles.center, { flex: 1 }]}>
          <Animated.Text entering={FadeInDown.duration(500)} style={styles.doneUrdu}>
            شاباش!
          </Animated.Text>
          <Animated.Text entering={FadeInDown.delay(120).duration(500)} style={styles.doneTitle}>
            Session complete
          </Animated.Text>
          <Animated.Text entering={FadeIn.delay(250).duration(500)} style={styles.doneMeta}>
            {subject?.name} · {chapter?.name}
          </Animated.Text>

          {focus.report && focus.report.segments.length > 1 && (
            <Animated.View
              entering={FadeInDown.delay(320).duration(500)}
              style={styles.reportCard}
            >
              <View style={styles.reportHead}>
                <Text style={styles.reportTitle}>Focus Guard</Text>
                {focus.report.score !== null && (
                  <Text style={styles.reportScore}>
                    {Math.round(focus.report.score * 100)}% focused
                  </Text>
                )}
              </View>

              <FocusTimeline segments={focus.report.segments} />

              <Text style={styles.reportLine}>
                {(() => {
                  const r = focus.report;
                  const bits: string[] = [];
                  const mins = (ms: number) => Math.round(ms / 60000);
                  if (r.longestFocusMs > 0)
                    bits.push(`longest stretch ${mins(r.longestFocusMs)} min`);
                  if (r.distractionCount > 0)
                    bits.push(
                      `${r.distractionCount} time${r.distractionCount === 1 ? '' : 's'} looking away`,
                    );
                  if (r.awayCount > 0)
                    bits.push(`away ${mins(r.awayMs)} min`);
                  // Unmonitored time is always disclosed rather than quietly
                  // folded into the score.
                  if (r.uncertainMs > 30_000)
                    bits.push(`${mins(r.uncertainMs)} min not monitored`);
                  return bits.join(' · ');
                })()}
              </Text>

              {focus.report.score === null && (
                <Text style={styles.reportNote}>
                  Too little was seen to give a score — that’s not a bad session,
                  just an unmeasured one.
                </Text>
              )}
            </Animated.View>
          )}
          <Animated.View entering={FadeInDown.delay(400).duration(500)} style={{ marginTop: 48, width: '100%', paddingHorizontal: 40 }}>
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
  root: { flex: 1, backgroundColor: color.inkWash },
  center: { alignItems: 'center', justifyContent: 'center', flex: 1 },
  topBar: { paddingHorizontal: space.xl, alignItems: 'flex-end' },
  closeText: { fontSize: 22, color: 'rgba(242,238,227,0.6)', fontFamily: font.medium },
  closeLink: { ...type.bodyMedium, color: color.greenMid, marginTop: 12 },

  subjectText: {
    fontFamily: font.semibold,
    fontSize: 13,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: color.greenMid,
  },
  chapterText: {
    ...type.heading,
    color: color.paperOnDark,
    textAlign: 'center',
    marginTop: 8,
    paddingHorizontal: 40,
  },
  timerText: { fontFamily: font.bold, fontSize: 52, color: color.paperOnDark, letterSpacing: -1 },
  timerSub: { ...type.small, color: 'rgba(242,238,227,0.5)', marginTop: 2 },
  metaText: { ...type.body, color: 'rgba(242,238,227,0.7)' },

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
  controlPrimary: {
    height: 50,
    paddingHorizontal: 28,
    borderRadius: radius.full,
    backgroundColor: color.greenMid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlPrimaryText: { fontFamily: font.semibold, fontSize: 15, color: color.paperOnDark },

  guardBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.full,
    backgroundColor: 'rgba(242,238,227,0.08)',
    maxWidth: '86%',
  },
  guardDot: { width: 8, height: 8, borderRadius: radius.full },
  guardText: { ...type.small, color: 'rgba(242,238,227,0.75)', flexShrink: 1 },
  guardRetry: {
    ...type.small,
    color: color.greenMid,
    fontFamily: font.semibold,
    textDecorationLine: 'underline',
  },

  reportCard: {
    marginTop: 28,
    marginHorizontal: 24,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(242,238,227,0.07)',
    borderWidth: 1,
    borderColor: 'rgba(242,238,227,0.12)',
  },
  reportHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  reportTitle: {
    fontFamily: font.semibold,
    fontSize: 12,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: 'rgba(242,238,227,0.6)',
  },
  reportScore: { fontFamily: font.bold, fontSize: 17, color: color.paperOnDark },
  reportLine: {
    ...type.small,
    color: 'rgba(242,238,227,0.65)',
    marginTop: 10,
    lineHeight: 18,
  },
  reportNote: { ...type.small, color: 'rgba(242,238,227,0.5)', marginTop: 8, lineHeight: 18 },

  doneUrdu: { fontFamily: font.urduBold, fontSize: 44, lineHeight: 96, color: color.gold },
  doneTitle: { ...type.title, color: color.paperOnDark },
  doneMeta: { ...type.small, color: 'rgba(242,238,227,0.6)', marginTop: 8, textAlign: 'center', paddingHorizontal: 40 },
  doneButton: {
    height: 54,
    borderRadius: radius.lg,
    backgroundColor: color.greenMid,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneButtonText: { fontFamily: font.semibold, fontSize: 16, color: color.paperOnDark },
});
