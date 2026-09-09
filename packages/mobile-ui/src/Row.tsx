import React from 'react';
import { View, Pressable } from 'react-native';
import { useTheme } from './theme';
import { Text } from './Text';

/** Key/value or list row, ≥ 44pt, divider from tokens. */
export function Row({ label, value, valueTone = 'text', onPress, last, children, testID, accessibilityLabel }: { label?: string; value?: React.ReactNode; valueTone?: 'text' | 'text2' | 'primaryInk' | 'errorInk' | 'warnInk' | 'ok'; onPress?: () => void; last?: boolean; children?: React.ReactNode; testID?: string; accessibilityLabel?: string }) {
  const t = useTheme();
  const body = (
    <View style={{ minHeight: t.targets.min, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.colors.divider }}>
      {children ?? (<>
        <Text variant="bodySm" tone="text2" style={{ flex: 1 }}>{label}</Text>
        {typeof value === 'string' ? <Text variant="bodySmStrong" tone={valueTone} tabular>{value}</Text> : value}
      </>)}
    </View>
  );
  return onPress ? <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}>{body}</Pressable> : <View testID={testID}>{body}</View>;
}
