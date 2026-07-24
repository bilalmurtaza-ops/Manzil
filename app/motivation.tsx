import * as Haptics from 'expo-haptics';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IQBAL_COUPLETS } from '../src/data/iqbalPoetry';
import { color, font, space, type } from '../src/theme/tokens';

// Eastern-Arabic (Urdu) numerals — a small bespoke touch for the progress counter.
const toUrduNum = (n: number): string =>
  String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);

function shuffled<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function MotivationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  // Fresh order each visit so tapping always surfaces something new.
  const deck = useMemo(() => shuffled(IQBAL_COUPLETS), []);
  const [index, setIndex] = useState(0);
  const couplet = deck[index];

  const next = () => {
    Haptics.selectionAsync();
    setIndex((i) => (i + 1) % deck.length);
  };

  return (
    <Pressable
      style={[
        styles.root,
        { paddingTop: insets.top + space.lg, paddingBottom: Math.max(insets.bottom, space.xl) },
      ]}
      onPress={next}
    >
      <Stack.Screen options={{ animation: 'fade' }} />

      <View style={styles.topBar}>
        <Pressable onPress={() => router.back()} hitSlop={14}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
      </View>

      {/* Verse — re-keyed by index so it re-animates on every tap */}
      <View style={styles.center}>
        <Animated.View key={index} entering={FadeInDown.duration(520)} style={styles.verseWrap}>
          <Text style={styles.theme}>{couplet.theme}</Text>
          <View style={styles.rule} />

          <Text style={styles.line}>{couplet.lines[0]}</Text>
          <Text style={styles.line}>{couplet.lines[1]}</Text>

          <Text style={styles.poet}>؎ علامہ اقبالؔ</Text>
        </Animated.View>
      </View>

      {/* Footer: progress + tap hint */}
      <Animated.View entering={FadeIn.delay(200).duration(500)} style={styles.footer}>
        <Text style={styles.counter}>
          {toUrduNum(index + 1)} <Text style={styles.counterDim}>/ {toUrduNum(deck.length)}</Text>
        </Text>
        <Text style={styles.hint}>کہیں بھی ٹیپ کریں · tap anywhere for the next verse</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.inkWash, paddingHorizontal: space.xl },
  topBar: { alignItems: 'flex-end' },
  closeText: { fontSize: 22, color: 'rgba(242,238,227,0.55)', fontFamily: font.medium },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  verseWrap: { alignItems: 'center', width: '100%' },

  theme: {
    fontFamily: font.urdu,
    fontSize: 15,
    lineHeight: 38,
    color: color.gold,
    textAlign: 'center',
  },
  rule: {
    width: 44,
    height: 1.5,
    borderRadius: 1,
    backgroundColor: 'rgba(201,151,46,0.5)',
    marginTop: 6,
    marginBottom: space.xl,
  },
  line: {
    fontFamily: font.urdu,
    fontSize: 25,
    lineHeight: 64,
    color: color.paperOnDark,
    textAlign: 'center',
    writingDirection: 'rtl',
    paddingHorizontal: 4,
  },
  poet: {
    fontFamily: font.urdu,
    fontSize: 15,
    lineHeight: 40,
    color: 'rgba(242,238,227,0.55)',
    textAlign: 'center',
    marginTop: space.xl,
  },

  footer: { alignItems: 'center', gap: 8 },
  counter: { fontFamily: font.semibold, fontSize: 15, color: color.gold, letterSpacing: 1 },
  counterDim: { color: 'rgba(242,238,227,0.4)' },
  hint: { ...type.small, fontSize: 11.5, color: 'rgba(242,238,227,0.42)', textAlign: 'center' },
});
