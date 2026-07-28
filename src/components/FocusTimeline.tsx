import { StyleSheet, Text, View } from 'react-native';
import type { FocusSegment, FocusState } from '../lib/focusGuard';
import { color, font, radius, space, type } from '../theme/tokens';

/**
 * The session at a glance: one horizontal strip, coloured by state.
 *
 * Chosen over a chart because it needs no axis, no legend reading and no
 * numeracy — a student sees instantly where their attention broke. Segments are
 * laid out by real duration, so the strip is a true picture of the session
 * rather than an evenly-spaced summary.
 */

const STATE_COLOR: Record<FocusState, string> = {
  focused: color.greenMid,
  glance: color.greenSoft,
  distracted: color.gold,
  away: color.rust,
  drowsy: color.rustSoft,
  // Deliberately the most muted thing on screen: unmonitored time is an
  // absence of information, not a judgement.
  uncertain: color.line,
};

const STATE_LABEL: Record<FocusState, string> = {
  focused: 'Focused',
  glance: 'Brief glance',
  distracted: 'Looking away',
  away: 'Away from desk',
  drowsy: 'Eyes closed',
  uncertain: 'Not monitored',
};

export function FocusTimeline({
  segments,
  height = 12,
  showLegend = true,
}: {
  segments: FocusSegment[];
  height?: number;
  showLegend?: boolean;
}) {
  const total = segments.length ? segments[segments.length - 1].end - segments[0].start : 0;
  if (total <= 0) return null;

  // Only legend what actually happened — an unused colour is noise.
  const present: FocusState[] = [];
  for (const s of segments) if (!present.includes(s.state)) present.push(s.state);

  return (
    <View>
      <View style={[styles.strip, { height, borderRadius: height / 2 }]}>
        {segments.map((s, i) => {
          const share = (s.end - s.start) / total;
          if (share <= 0) return null;
          return (
            <View
              key={`${s.state}-${s.start}-${i}`}
              style={{ flex: share, backgroundColor: STATE_COLOR[s.state] }}
            />
          );
        })}
      </View>
      {showLegend && (
        <View style={styles.legend}>
          {present.map((st) => (
            <View key={st} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: STATE_COLOR[st] }]} />
              <Text style={styles.legendText}>{STATE_LABEL[st]}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

export { STATE_COLOR, STATE_LABEL };

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: color.line,
    width: '100%',
  },
  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.md,
    marginTop: space.sm,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  legendText: { ...type.small, color: color.inkSoft, fontFamily: font.medium },
});
