import { Tabs } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
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

function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
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
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
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
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapActive: {
    backgroundColor: color.greenSoft,
  },
  label: {
    fontFamily: font.medium,
    fontSize: 10.5,
    letterSpacing: 0.2,
  },
});
