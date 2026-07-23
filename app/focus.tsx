import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ProgressRing } from '../src/components/ProgressRing';
import { getChapter, getSubject } from '../src/data/syllabus';
import { useAppStore } from '../src/store/useAppStore';
import { color, font, radius, space, type } from '../src/theme/tokens';

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

  useEffect(() => {
    if (!running || finished) return;
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
  }, [running, finished]);

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
                  {running ? 'focus — phone down' : 'paused'}
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
