import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
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

/** Bar geometry. Kept here so the collapsed width matches the rendered bars exactly. */
const BAR_W = 2.5;
const BAR_GAP = 2;
const BAR_COUNT = 3;
const BARS_W = BAR_COUNT * BAR_W + (BAR_COUNT - 1) * BAR_GAP;
const BAR_REST = 3;
const BAR_PEAK = 14;

/**
 * A three-bar equaliser drawn on the selected row while it speaks.
 *
 * Purely decorative — it does NOT track amplitude, unlike `VoiceWaveform`,
 * which genuinely follows the microphone. Named and commented so nobody later
 * mistakes it for a real level meter.
 *
 * It stays MOUNTED at all times and animates its own visibility. Rendering it
 * conditionally made it vanish the instant the preview ended, which reads as a
 * glitch rather than a finish; width, scale and opacity are interpolated from
 * one `shown` value so the row's layout closes up smoothly instead of snapping.
 */
function SpeakingBars({ active }: { active: boolean }) {
  const shown = useSharedValue(0);

  useEffect(() => {
    shown.value = withTiming(active ? 1 : 0, {
      // Slower leaving than arriving: an exit that matches the entrance speed
      // still reads as a snap. Ease-in-out lets it settle rather than stop.
      duration: active ? 200 : 420,
      easing: active ? Easing.out(Easing.quad) : Easing.inOut(Easing.cubic),
    });
  }, [active, shown]);

  const wrap = useAnimatedStyle(() => ({
    opacity: shown.value,
    width: interpolate(shown.value, [0, 1], [0, BARS_W]),
    marginLeft: interpolate(shown.value, [0, 1], [0, 8]),
    transform: [{ scale: interpolate(shown.value, [0, 1], [0.8, 1]) }],
  }));

  return (
    <Animated.View style={[styles.bars, wrap]}>
      {Array.from({ length: BAR_COUNT }, (_, i) => (
        <Bar key={i} index={i} active={active} />
      ))}
    </Animated.View>
  );
}

function Bar({ index, active }: { index: number; active: boolean }) {
  const h = useSharedValue(BAR_REST);

  useEffect(() => {
    if (active) {
      // Different durations per bar so the three drift out of phase on their
      // own — a shared clock with offsets would march them in lockstep.
      h.value = withRepeat(
        withTiming(BAR_PEAK - index * 2, {
          duration: 420 + index * 90,
          easing: Easing.inOut(Easing.quad),
        }),
        -1,
        true,
      );
    } else {
      // Cancel first: without this the repeat keeps fighting the settle and the
      // bar twitches on its way down.
      cancelAnimation(h);
      h.value = withDelay(
        index * 55, // left-to-right settle, so it reads as winding down
        withTiming(BAR_REST, { duration: 300, easing: Easing.out(Easing.cubic) }),
      );
    }
    return () => cancelAnimation(h);
  }, [active, index, h]);

  const style = useAnimatedStyle(() => ({ height: h.value }));
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

/** Roughly the preview line plus a beat. The pack is fixed, so a constant is honest. */
const PREVIEW_MS = 2600;

export function VoicePicker({
  selectedId,
  onSelect,
  onPreview,
  disabled = false,
}: {
  selectedId: string;
  onSelect: (id: string) => void;
  /**
   * Called after selection so the student hears the voice they picked.
   * Resolves FALSE when no clip could be played, which is what stops the bars
   * animating over silence.
   */
  onPreview: (id: string) => Promise<boolean>;
  disabled?: boolean;
}) {
  const [speaking, setSpeaking] = useState<string | null>(null);

  useEffect(() => {
    if (!speaking) return;
    const id = setTimeout(() => setSpeaking(null), PREVIEW_MS);
    return () => clearTimeout(id);
  }, [speaking]);

  const choose = (id: string) => {
    if (disabled) return;
    onSelect(id);
    // The equaliser starts only once the clip is genuinely playing. It used to
    // start regardless, so a preview that silently failed to resolve still
    // animated — the UI claiming a sound the student could not hear.
    void onPreview(id).then((played) => setSpeaking(played ? id : null));
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
                <SpeakingBars active={speaking === v.id} />
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

  // No `gap` here: the bars own their leading space via an animated marginLeft,
  // so the row closes up completely when they collapse to zero width.
  nameRow: { flexDirection: 'row', alignItems: 'center' },
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

  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: BAR_GAP,
    height: BAR_PEAK,
    // Clips the bars while the container collapses, so they slide away behind
    // the edge instead of poking out of a zero-width box.
    overflow: 'hidden',
  },
  bar: { width: BAR_W, borderRadius: radius.full, backgroundColor: color.greenMid },

  hint: { ...type.small, color: color.inkFaint, marginTop: 2 },
});
