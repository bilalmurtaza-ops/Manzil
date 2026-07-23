import { Tabs } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Dimensions, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import {
  PlanIcon,
  PracticeIcon,
  ProgressIcon,
  TodayIcon,
  UstaadIcon,
} from '../../src/components/icons';
import { color, font } from '../../src/theme/tokens';

const TABS = [
  { name: 'today', label: 'Today', Icon: TodayIcon },
  { name: 'plan', label: 'Plan', Icon: PlanIcon },
  { name: 'practice', label: 'Practice', Icon: PracticeIcon },
  { name: 'ustaad', label: 'Ustaad', Icon: UstaadIcon },
  { name: 'progress', label: 'Progress', Icon: ProgressIcon },
] as const;

// Matches styles.bar's paddingHorizontal/iconWrap size below — kept in sync manually
// since the sliding pill's position is computed, not measured per-item.
const BAR_PADDING_H = 6;
const PILL_WIDTH = 44;

function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  // Seeded with a real estimate (not 0) so the pill never flashes in after the first
  // onLayout — the width itself only ever fills in a small rounding/inset difference.
  const [barWidth, setBarWidth] = useState(() => Dimensions.get('window').width);
  const pillX = useSharedValue(0);
  const hasPositioned = useRef(false);
  const columnWidth = (barWidth - BAR_PADDING_H * 2) / TABS.length;

  useEffect(() => {
    const target = BAR_PADDING_H + state.index * columnWidth + (columnWidth - PILL_WIDTH) / 2;
    if (!hasPositioned.current) {
      pillX.value = target; // snap into place on first paint, nothing to slide from yet
      hasPositioned.current = true;
    } else {
      pillX.value = withTiming(target, { duration: 260, easing: Easing.out(Easing.cubic) });
    }
  }, [state.index, columnWidth, pillX]);

  const pillStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pillX.value }],
  }));

  return (
    <View
      style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}
      onLayout={(e: LayoutChangeEvent) => setBarWidth(e.nativeEvent.layout.width)}
    >
      <Animated.View style={[styles.pill, pillStyle]} />
      {TABS.map((tab, index) => {
        const focused = state.index === index;
        const tint = focused ? color.green : color.inkFaint;
        return (
          <Pressable
            key={tab.name}
            style={styles.item}
            onPress={() => {
              if (!focused) {
                Haptics.selectionAsync();
                navigation.navigate(tab.name);
              }
            }}
          >
            <View style={styles.iconWrap}>
              <tab.Icon color={tint} size={21} />
            </View>
            <Text style={[styles.label, { color: tint }]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: color.paper },
      }}
    >
      {TABS.map((tab) => (
        <Tabs.Screen key={tab.name} name={tab.name} options={{ title: tab.label }} />
      ))}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: color.card,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.lineStrong,
    paddingTop: 8,
    paddingHorizontal: 6,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 3,
  },
  iconWrap: {
    width: 44,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    position: 'absolute',
    top: 8,
    left: 0,
    width: 44,
    height: 30,
    borderRadius: 15,
    backgroundColor: color.greenSoft,
  },
  label: {
    fontFamily: font.medium,
    fontSize: 10.5,
    letterSpacing: 0.2,
  },
});
