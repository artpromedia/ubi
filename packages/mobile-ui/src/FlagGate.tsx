import React from 'react';
import { View } from 'react-native';
import { useFlag, useFlags, type AnyFlag, TID } from '@ubi/mobile-core';
import { useTheme } from './theme';
import { Text } from './Text';
import { Button } from './Button';
import { Skeleton } from './Skeleton';

/** Honest "not available here" (launch CLAUDE.md #5, #8). Deep links into a disabled feature land here, never on a broken screen. */
export function FlagGate({ flag, featureName, onDismiss, children }: { flag: AnyFlag; featureName: string; onDismiss: () => void; children: React.ReactNode }) {
  const on = useFlag(flag);
  const { status } = useFlags();
  const t = useTheme();
  if (status === 'loading') return <View style={{ padding: 20, gap: 10 }}><Skeleton height={28} width="60%" /><Skeleton height={120} /></View>;
  if (on) return <>{children}</>;
  return (
    <View testID={TID.common.flagOff.screen} style={{ flex: 1, padding: 24, justifyContent: 'center', gap: 12, backgroundColor: t.colors.bg }}>
      <Text variant="display">{featureName} isn't available here yet</Text>
      <Text variant="body" tone="text2">It's not offered in your city right now. We'll show it as soon as it is.</Text>
      <Button label="Back to home" kind="inverse" onPress={onDismiss} />
    </View>
  );
}
