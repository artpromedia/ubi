import React from 'react';
import { View, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, StatusPill, Button, Row, Skeleton, FlagGate } from '@ubi/mobile-ui';
import { TID, formatMinor } from '@ubi/mobile-core';
import { mandatesApi } from '../../api/mandates';

/** Board 20d — list. Each mandate shows action, limits, expiry and usage; nothing runs while paused. */
export function MandatesScreen() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const q = useQuery({ queryKey: ['mandates'], queryFn: mandatesApi.list });
  return (
    <FlagGate flag="ai_mandates" featureName="Automation" onDismiss={nav.goBack}>
      <Screen title="Automation" onBack={nav.goBack}>
        <Text variant="bodySm" tone="text2">Things UBI may do for you without asking each time. Each one is limited to the exact action and amounts you set here, and every run leaves a receipt.</Text>
        {q.isLoading ? <><Skeleton height={110} /><Skeleton height={110} /></> : null}
        {q.data?.map(m => (
          <Pressable key={m.id} testID={TID.mandates.list.item} accessibilityRole="button" accessibilityLabel={m.title + ', ' + m.status} onPress={() => nav.navigate('MandateEditor', { mandateId: m.id })} style={{ opacity: m.status === 'paused' ? 0.85 : 1 }}>
            <Card style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text variant="bodyStrong" style={{ flex: 1 }}>{m.title}</Text><StatusPill status={m.status} /></View>
              <Text variant="caption" tone="text2">{m.summary}</Text>
              <Row last label={m.status === 'paused' ? 'Paused — nothing runs while paused' : 'Used ' + formatMinor(m.usage.amountUsed) + ' of ' + formatMinor(m.periodCap.amount) + ' this month'} value={m.receiptsCount ? String(m.receiptsCount) + ' receipts' : 'Never used'} />
            </Card>
          </Pressable>
        ))}
        {q.data && q.data.length === 0 ? <Card><Text variant="bodySm" tone="text2">No automations yet. Start with an airport ride that books itself when your flight lands.</Text></Card> : null}
        <Button testID={TID.mandates.list.new} label="+ New automation" kind="secondary" onPress={() => nav.navigate('MandateEditor', {})} />
        <Text variant="caption" tone="text2">Not available for automation: sending money to people, changing your account, or anything outside rides and travel.</Text>
      </Screen>
    </FlagGate>
  );
}
