import React from 'react';
import { View, ScrollView, Pressable, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from './theme';
import { Text } from './Text';

/** Safe-area screen with optional header row. Scroll by default; set scroll={false} for FlatList screens. */
export function Screen({ title, subtitle, onBack, action, children, scroll = true, footer, bg, contentStyle }: { title?: string; subtitle?: string; onBack?: () => void; action?: { label: string; onPress: () => void; testID?: string }; children: React.ReactNode; scroll?: boolean; footer?: React.ReactNode; bg?: 'bg' | 'bg2'; contentStyle?: ViewStyle }) {
  const t = useTheme();
  const header = (title || onBack) ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 }}>
      {onBack ? <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={{ width: t.targets.min, height: t.targets.min, alignItems: 'center', justifyContent: 'center' }}><Text variant="heading">‹</Text></Pressable> : null}
      <View style={{ flex: 1 }}>{title ? <Text variant="display" accessibilityRole="header">{title}</Text> : null}{subtitle ? <Text variant="caption" tone="text2">{subtitle}</Text> : null}</View>
      {action ? <Pressable testID={action.testID} accessibilityRole="button" onPress={action.onPress} style={{ minHeight: t.targets.min, justifyContent: 'center' }}><Text variant="bodySmStrong" tone="link">{action.label}</Text></Pressable> : null}
    </View>
  ) : null;
  const body = <View style={[{ paddingHorizontal: 20, paddingBottom: 24, gap: 12 }, contentStyle]}>{children}</View>;
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: bg === 'bg' ? t.colors.bg : t.colors.bg2 }}>
      {header}
      {scroll ? <ScrollView keyboardShouldPersistTaps="handled" contentInsetAdjustmentBehavior="automatic">{body}</ScrollView> : <View style={{ flex: 1 }}>{children}</View>}
      {footer ? <View style={{ paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.colors.divider, backgroundColor: t.colors.bg }}>{footer}</View> : null}
    </SafeAreaView>
  );
}
