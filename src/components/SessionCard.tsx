import * as Haptics from 'expo-haptics';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { getChapter, getSubject } from '../data/syllabus';
import type { PlanSession } from '../lib/types';
import { color, font, radius, subjectColor, type } from '../theme/tokens';
import { CheckIcon } from './icons';

const KIND_LABEL: Record<PlanSession['kind'], string> = {
  study: 'Study',
  revise: 'Revise',
  practice: 'Past-paper drill',
};

interface Props {
  session: PlanSession;
  index?: number;
  onToggleDone: () => void;
  onStart?: () => void;
}

export function SessionCard({ session, index = 0, onToggleDone, onStart }: Props) {
  const subject = getSubject(session.subjectId);
  const chapter = getChapter(session.subjectId, session.chapterId);
  const tint = subjectColor[subject?.colorKey ?? 'general'] ?? subjectColor.general;

  return (
    <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>
      <Pressable
        onPress={onStart}
        style={[styles.card, session.done && styles.cardDone]}
      >
        <View style={[styles.spine, { backgroundColor: tint.main }]} />
        <View style={styles.body}>
          <View style={styles.topRow}>
            <Text style={[styles.subject, { color: tint.main }]}>{subject?.name ?? '—'}</Text>
            <View style={[styles.kindChip, { backgroundColor: tint.soft }]}>
              <Text style={[styles.kindText, { color: tint.main }]}>
                {KIND_LABEL[session.kind]} · {session.minutes}m
              </Text>
            </View>
          </View>
          <Text
            style={[styles.chapter, session.done && styles.chapterDone]}
            numberOfLines={2}
          >
            {chapter ? `${chapter.no}. ${chapter.name}` : session.chapterId}
          </Text>
        </View>
        <Pressable
          hitSlop={10}
          onPress={() => {
            Haptics.notificationAsync(
              session.done
                ? Haptics.NotificationFeedbackType.Warning
                : Haptics.NotificationFeedbackType.Success,
            );
            onToggleDone();
          }}
          style={[styles.check, session.done && styles.checkDone]}
        >
          {session.done ? <CheckIcon size={15} color={color.paperOnDark} /> : null}
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    marginBottom: 10,
    overflow: 'hidden',
  },
  cardDone: { opacity: 0.55 },
  spine: { width: 4, alignSelf: 'stretch' },
  body: { flex: 1, paddingHorizontal: 14, paddingVertical: 13 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  subject: { fontFamily: font.semibold, fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase' },
  kindChip: { borderRadius: radius.full, paddingHorizontal: 9, paddingVertical: 3 },
  kindText: { fontFamily: font.medium, fontSize: 11 },
  chapter: { ...type.bodyMedium, color: color.ink, marginTop: 6 },
  chapterDone: { textDecorationLine: 'line-through', color: color.inkFaint },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: color.lineStrong,
    marginRight: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: color.card,
  },
  checkDone: { backgroundColor: color.green, borderColor: color.green },
});
