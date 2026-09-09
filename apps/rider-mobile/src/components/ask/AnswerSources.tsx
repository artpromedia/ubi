import React, { useState } from 'react';
import { View, Pressable } from 'react-native';
import { Text, useTheme } from '@ubi/mobile-ui';
import { TID } from '@ubi/mobile-core';
import type { Source } from '../../api/ask';

/** Board 20b — every policy answer names its documents. Collapsible; tapping "Open" shows the policy document sheet (reuses support policy viewer). */
export function AnswerSources({ sources, onOpen }: { sources: Source[]; onOpen: (s: Source) => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(true);
  if (!sources.length) return null;
  return (
    <View testID={TID.ask.answer.sources} style={{ borderLeftWidth: 2, borderLeftColor: t.colors.border, backgroundColor: t.colors.bg2, borderTopRightRadius: t.radius.control, borderBottomRightRadius: t.radius.control, paddingHorizontal: 12, paddingVertical: 8 }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(o => !o)} style={{ minHeight: 28, justifyContent: 'center' }}><Text variant="label" tone="text2">Sources · {String(sources.length)}</Text></Pressable>
      {open ? sources.map(s => (
        <Pressable key={s.ref} accessibilityRole="link" onPress={() => onOpen(s)} style={{ minHeight: 32, justifyContent: 'center' }}>
          <Text variant="caption">{s.title}{s.version ? ' · ' + s.version : ''}{s.updatedAt ? ' · updated ' + s.updatedAt : ''}</Text>
        </Pressable>
      )) : null}
    </View>
  );
}
