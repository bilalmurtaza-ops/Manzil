import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { isCloudConfigured } from '../lib/supabase';
import { useAppStore } from '../store/useAppStore';
import { useCloudStore } from '../store/useCloudStore';
import { color, font, radius, space, type } from '../theme/tokens';
import { CloudIcon } from './icons';

/**
 * One-time, dismissible prompt to protect progress — deliberately NOT part of
 * onboarding, so a first run (including a judge's) never meets an account screen.
 *
 * It only appears once the student has progress actually worth protecting, which
 * is also the moment the offer makes sense to them.
 */
export function CloudNudge() {
  const router = useRouter();

  const profile = useAppStore((s) => s.profile);
  const activeDays = useAppStore((s) => s.activeDays);
  const quizAttempts = useAppStore((s) => s.quizAttempts);
  const vibrationEnabled = useAppStore((s) => s.vibrationEnabled !== false);

  const session = useCloudStore((s) => s.session);
  const nudgeDismissedAt = useCloudStore((s) => s.nudgeDismissedAt);
  const hydrated = useCloudStore((s) => s.hydrated);
  const dismissNudge = useCloudStore((s) => s.dismissNudge);

  const earnedIt = activeDays.length >= 3 || quizAttempts.length >= 3;

  if (!hydrated) return null;
  if (!isCloudConfigured()) return null;
  if (!profile) return null;
  if (session) return null;
  if (nudgeDismissedAt) return null;
  if (!earnedIt) return null;

  const haptic = () => {
    if (vibrationEnabled) {
      try {
        Haptics.selectionAsync();
      } catch {}
    }
  };

  return (
    <Animated.View entering={FadeInDown.duration(300)} style={styles.card}>
      <CloudIcon size={22} color={color.greenMid} />
      <View style={styles.body}>
        <Text style={styles.title}>Keep your progress safe</Text>
        <Text style={styles.sub}>
          Save your plan and streak online so a lost phone never costs you your preparation.
        </Text>
        <Pressable
          onPress={() => {
            haptic();
            router.push('/cloud');
          }}
          hitSlop={6}
        >
          <Text style={styles.cta}>Set up backup →</Text>
        </Pressable>
      </View>
      <Pressable
        onPress={() => {
          haptic();
          dismissNudge();
        }}
        hitSlop={12}
      >
        <Text style={styles.dismiss}>✕</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    backgroundColor: color.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    padding: space.lg,
    marginTop: space.lg,
  },
  body: { flex: 1 },
  title: { fontFamily: font.semibold, fontSize: 14, color: color.ink },
  sub: { ...type.small, color: color.inkSoft, marginTop: 4, lineHeight: 19 },
  cta: { fontFamily: font.semibold, fontSize: 13, color: color.greenMid, marginTop: space.sm },
  dismiss: { fontSize: 15, color: color.inkFaint, lineHeight: 18 },
});
