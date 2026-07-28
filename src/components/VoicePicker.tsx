import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';
import { FOCUS_VOICES } from '../lib/focusGuard/voice/lines';
import { color, font, radius, space, type } from '../theme/tokens';

/**
 * Focus Guard voice chooser.
 *
 * Tapping a row BOTH selects and previews — one gesture, and you immediately
 * hear what you just chose. A separate play button would make auditioning a
 * two-step chore for something you decide once.
 *
 * Preview is instant and works offline because the clips are bundled, which is
 * the whole reason the pack is pre-rendered rather than fetched.
 */

/**
 * A three-bar equaliser drawn on the selected row while it speaks.
 *
 * Purely decorative — it does NOT track amplitude, unlike `VoiceWaveform`,
 * which genuinely follows the microphone. Named and commented so nobody later
 * mistakes it for a real level meter.
 */
function SpeakingBars({ active }: { active: boolean }) {
  return (
    <View style={styles.bars}>
      {[0, 1, 2].map((i) => (
        <Bar key={i} index={i} active={active} />
      ))}
    </View>
  );
}

function Bar({ index, active }: { index: number; active: boolean }) {
  const h = useSharedValue(6);
  const style = useAnimatedStyle(() => ({ height: h.value }));
  if (active && h.value === 6) {
    h.value = withRepeat(
      withTiming(14 - index * 2, { duration: 420 + index * 90 }),
      -1,
      true,
    );
  }
  if (!active && h.value !== 6) h.value = withTiming(6, { duration: 160 });
  return <Animated.View style={[styles.bar, style]} />;
}

/** Hand-drawn tick, matching the app's no-icon-library rule. */
function Tick({ size = 13 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 12.5L9.5 18L20 6.5"
        stroke={color.paperOnDark}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function VoicePicker({
  selectedId,
  onSelect,
  onPreview,
  disabled = false,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  /** Called after selection so the student hears the voice they picked. */
  onPreview: (id: string) => void;
  disabled?: boolean;
}) {
  const [speaking, setSpeaking] = useState<string | null>(null);

  const choose = (id: string) => {
    if (disabled) return;
    onSelect(id);
    onPreview(id);
    setSpeaking(id);
    // Plain JS clock, per this codebase's convention for time-based logic —
    // long enough to cover the preview line, then the bars settle.
    setTimeout(() => setSpeaking((s) => (s === id ? null : s)), 2600);
  };

  return (
    <View style={styles.wrap}>
      {FOCUS_VOICES.map((v) => {
        const selected = v.id === selectedId;
        return (
          <Pressable
            key={v.id}
            onPress={() => choose(v.id)}
            disabled={disabled}
            style={[styles.row, selected && styles.rowSelected, disabled && styles.rowDisabled]}
          >
            {/* Left accent bar — the quiet signal of selection, so the row
                doesn't need a heavy border to read as chosen. */}
            <View style={[styles.accent, selected && styles.accentOn]} />

            <View style={{ flex: 1 }}>
              <View style={styles.nameRow}>
                <Text style={[styles.name, selected && styles.nameSelected]}>{v.name}</Text>
                {speaking === v.id && <SpeakingBars active />}
              </View>
              <Text style={styles.tagline}>{v.tagline}</Text>
            </View>

            <View style={[styles.check, selected && styles.checkOn]}>
              {selected && <Tick />}
            </View>
          </Pressable>
        );
      })}
      <Text style={styles.hint}>Tap a voice to hear it.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.sm },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 11,
    paddingRight: space.md,
    borderRadius: radius.md,
    marginBottom: 6,
    backgroundColor: 'transparent',
  },
  rowSelected: { backgroundColor: color.greenSoft },
  rowDisabled: { opacity: 0.45 },

  accent: {
    width: 3,
    alignSelf: 'stretch',
    marginLeft: 2,
    borderRadius: radius.full,
    backgroundColor: 'transparent',
  },
  accentOn: { backgroundColor: color.green },

  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontFamily: font.semibold, fontSize: 15, color: color.ink },
  nameSelected: { color: color.green },
  tagline: { ...type.small, color: color.inkSoft, marginTop: 1 },

  check: {
    width: 22,
    height: 22,
    borderRadius: radius.full,
    borderWidth: 1.5,
    borderColor: color.lineStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: color.green, borderColor: color.green },

  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 14 },
  bar: { width: 2.5, borderRadius: radius.full, backgroundColor: color.greenMid },

  hint: { ...type.small, color: color.inkFaint, marginTop: 2 },
});
