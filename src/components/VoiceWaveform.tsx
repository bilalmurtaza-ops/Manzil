import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  type SharedValue,
} from 'react-native-reanimated';
import { color, radius } from '../theme/tokens';

interface VoiceWaveformProps {
  /** 0-1 normalized amplitude — the parent assigns this directly from live
   * volumechange ticks (optionally eased via a short withTiming), matching
   * this codebase's convention that a JS-thread clock drives the shared
   * value while the shared value itself only ever paints, never decides
   * app logic (see app/breathe.tsx). */
  level: SharedValue<number>;
  /** False while starting/erroring — bars settle to a flat idle baseline. */
  active: boolean;
  barCount?: number;
  color?: string;
  height?: number;
}

interface BarProps {
  level: SharedValue<number>;
  multiplier: number;
  active: boolean;
  color: string;
  minHeight: number;
  maxHeight: number;
}

function WaveBar({ level, multiplier, active, color: barColor, minHeight, maxHeight }: BarProps) {
  const style = useAnimatedStyle(() => {
    const target = active ? minHeight + level.value * multiplier * (maxHeight - minHeight) : minHeight;
    return { height: Math.max(minHeight, Math.min(maxHeight, target)) };
  });
  return <Animated.View style={[styles.bar, { backgroundColor: barColor }, style]} />;
}

/** Live waveform for voice input — bars genuinely track mic amplitude, not a decorative loop. */
export function VoiceWaveform({
  level,
  active,
  barCount = 24,
  color: tint = color.green,
  height = 46,
}: VoiceWaveformProps) {
  // Fixed per-bar spread computed once so bars don't move in lockstep like a single pulsing
  // block — memoized so it never reshuffles across re-renders (that would read as jitter).
  const multipliers = useMemo(
    () => Array.from({ length: barCount }, () => 0.45 + Math.random() * 0.55),
    [barCount],
  );

  return (
    <View style={[styles.row, { height }]}>
      {multipliers.map((m, i) => (
        <WaveBar
          key={i}
          level={level}
          multiplier={m}
          active={active}
          color={tint}
          minHeight={4}
          maxHeight={height}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  bar: { width: 3.5, borderRadius: radius.full },
});
