import React from 'react';
import { Switch, View } from 'react-native';
import { useTheme } from './theme';
import { Text } from './Text';

export function Toggle({ label, detail, value, onChange, testID }: { label: string; detail?: string; value: boolean; onChange: (v: boolean) => void; testID?: string }) {
  const t = useTheme();
  return (
    <View style={{ minHeight: t.targets.min, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 }}>
      <View style={{ flex: 1 }}><Text variant="bodySm">{label}</Text>{detail ? <Text variant="caption" tone="text2">{detail}</Text> : null}</View>
      <Switch testID={testID} accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: t.colors.primary, false: t.colors.border }} thumbColor="#fff" />
    </View>
  );
}
