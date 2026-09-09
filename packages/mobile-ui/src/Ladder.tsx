import React from 'react';
import { View } from 'react-native';
import { useTheme } from './theme';
import { Text } from './Text';

export type LadderStep = { label: string; detail?: string; state: 'done' | 'active' | 'pending' | 'skipped' };
/** Vertical status ladder (boards 20c, 21c, 21d). Pending steps are muted; the active one carries the warn colour and the word. */
export function Ladder({ steps, testID }: { steps: LadderStep[]; testID?: string }) {
  const t = useTheme();
  return (
    <View testID={testID} accessibilityRole="list">
      {steps.map((s, i) => {
        const last = i === steps.length - 1;
        const ring = s.state === 'done' ? t.colors.okTint : s.state === 'active' ? t.colors.warn : t.colors.border;
        return (
          <View key={s.label} accessibilityLabel={s.label + ', ' + s.state + (s.detail ? ', ' + s.detail : '')} style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ alignItems: 'center', width: 22 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: s.state === 'done' ? t.colors.okTint : 'transparent', borderWidth: 2, borderColor: ring, alignItems: 'center', justifyContent: 'center' }}>
                {s.state === 'done' ? <Text variant="label" tone="ok">✓</Text> : s.state === 'active' ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: t.colors.warn }} /> : null}
              </View>
              {!last ? <View style={{ width: 2, flex: 1, marginVertical: 4, backgroundColor: s.state === 'done' ? t.colors.okTint : s.state === 'active' ? t.colors.warn : t.colors.border }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: last ? 0 : 14 }}>
              <Text variant="bodySmStrong" tone={s.state === 'pending' || s.state === 'skipped' ? 'text3' : 'text'}>{s.label}</Text>
              {s.detail ? <Text variant="caption" tone={s.state === 'pending' ? 'text3' : 'text2'}>{s.detail}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
