import React from 'react';
import { View } from 'react-native';
import { Card, Text, StatusPill, MoneyText, Chip, useTheme } from '@ubi/mobile-ui';
import { TID } from '@ubi/mobile-core';
import type { LinkedItem } from '../../api/travel';

/** Board 21c/21e. One card per order/reservation with its own status word, refs, policy and actions. */
export function ItemCard({ item, onAction }: { item: LinkedItem; onAction: (key: string) => void }) {
  const t = useTheme();
  const tone = item.kind === 'ride_reservation' ? 'primaryInk' : 'travelInk';
  return (
    <Card testID={item.kind === 'ride_reservation' ? TID.travel.linked.ride : TID.travel.itinerary.item} tone={item.status === 'not_reserved' ? 'error' : 'default'} style={{ gap: 6, opacity: item.status === 'not_booked' ? 0.75 : 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Text variant="label" tone={tone}>{item.dateLabel}</Text><StatusPill status={item.status} /></View>
      <Text variant="heading">{item.title}</Text>
      {item.subtitle ? <Text variant="caption" tone="text2">{item.subtitle}</Text> : null}
      {item.refs ? <Text variant="caption" tone="text2">{item.refs}</Text> : null}
      {item.charged ? <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="caption" tone="text2">Charged</Text><MoneyText money={item.charged} variant="bodySmStrong" /></View> : null}
      {item.policy ? <Text variant="caption" tone="text2">{item.policy}</Text> : null}
      {item.disruption ? <Text variant="caption" tone="text2">{item.disruption}</Text> : null}
      {item.actions.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>{item.actions.map(a => <Chip key={a.key} label={a.label} selected={a.primary} onPress={() => onAction(a.key)} />)}</View> : null}
    </Card>
  );
}
