import React, { useState } from 'react';
import { View } from 'react-native';
import { Text, Chip, Button, Card, useTheme } from '@ubi/mobile-ui';
import { TID } from '@ubi/mobile-core';
import type { ClarifyField } from '../../api/ask';

/** Board 20b — clarifying fields. The assistant asks; the user taps. Submit stays disabled until required fields are filled. */
export function ClarifyForm({ fields, passenger, onSubmit }: { fields: ClarifyField[]; passenger?: { name: string; detail: string; initials: string }; onSubmit: (answers: Record<string, unknown>) => void }) {
  const t = useTheme();
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const complete = fields.every(f => !f.required || answers[f.key] !== undefined || f.kind === 'passenger');
  return (
    <Card testID={TID.ask.clarify.form} style={{ gap: 10 }}>
      {fields.map(f => (
        <View key={f.key} accessibilityRole="radiogroup" accessibilityLabel={f.label}>
          <Text variant="label" tone="text2" style={{ marginBottom: 8 }}>{f.label}</Text>
          {f.kind === 'chips' ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{(f.options ?? []).map(o => <Chip key={o} label={o} selected={answers[f.key] === o} onPress={() => setAnswers(a => ({ ...a, [f.key]: o }))} />)}</View> : null}
          {f.kind === 'passenger' && passenger ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: t.radius.control, backgroundColor: t.colors.bg2 }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.colors.primaryTint, alignItems: 'center', justifyContent: 'center' }}><Text variant="label" tone="primaryInk">{passenger.initials}</Text></View>
              <View style={{ flex: 1 }}><Text variant="bodySm">{passenger.name}</Text><Text variant="caption" tone="text2">{passenger.detail}</Text></View>
              <Text variant="bodySmStrong" tone="link">Change</Text>
            </View>
          ) : null}
        </View>
      ))}
      <Button testID={TID.ask.clarify.submit} kind="inverse" size="md" label="Continue" disabled={!complete} onPress={() => onSubmit(answers)} />
    </Card>
  );
}
