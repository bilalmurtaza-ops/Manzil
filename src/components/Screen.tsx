import type { PropsWithChildren } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color, space } from '../theme/tokens';

interface ScreenProps extends PropsWithChildren {
  style?: ViewStyle;
  /** Skip horizontal padding (e.g. for full-bleed scroll views). */
  bleed?: boolean;
}

export function Screen({ children, style, bleed }: ScreenProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.root,
        { paddingTop: insets.top + space.sm },
        !bleed && { paddingHorizontal: space.lg },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: color.paper,
  },
});
