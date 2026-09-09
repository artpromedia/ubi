import React from 'react';
import { View, Pressable } from 'react-native';
import { Card, Text, MoneyText, useTheme } from '@ubi/mobile-ui';
import { TID, formatMinor } from '@ubi/mobile-core';
import type { Alternative } from '../../api/travel';

const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' });
/** Board 21d. "₦0 to you" appears only when customerPays is zero AND the server holds the seat (heldUntil). */
export function AlternativeCard({ a, selected, onPress }: { a: Alternative; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const free = a.customerPays.amountMinor === 0;
  return (
    <Pressable testID={TID.travel.disruption.alternative} accessibilityRole="radio" accessibilityState={{ selected }} onPress={onPress}>
      <Card emphasis={selected} style={{ gap: 3 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}><Text variant="heading" tabular>{hm(a.departAt)} → {hm(a.arriveAt)}</Text>{free ? <Text variant="bodySmStrong" tone="primaryInk">₦0 to you</Text> : <MoneyText money={a.customerPays} variant="bodySmStrong" />}</View>
        <Text variant="caption" tone="text2">{a.carrier} {a.flightNumber}{a.fareFamily ? ' · ' + a.fareFamily : ''}{a.baggage ? ' · ' + a.baggage : ''}{a.seatsLeft !== undefined ? ' · ' + a.seatsLeft + ' seats left' : ''}</Text>
        {a.covered && a.covered.amountMinor > 0 ? <Text variant="caption" tone="text2">Fare {formatMinor(a.price)} · UBI covers {formatMinor(a.covered)} difference{a.heldUntil ? ' · seat is held for you until ' + hm(a.heldUntil) : ''}</Text> : null}
        {a.note ? <Text variant="caption" tone="text2">{a.note}</Text> : null}
      </Card>
    </Pressable>
  );
}
