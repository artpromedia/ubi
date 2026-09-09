import React from 'react';
import { View, Pressable } from 'react-native';
import { Card, Text, MoneyText, Row, useTheme } from '@ubi/mobile-ui';
import { TID } from '@ubi/mobile-core';
import type { Rate } from '../../api/travel';

const dt = (iso: string) => new Date(iso).toLocaleString('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' }) + ' WAT';
/** Board 21b. Pay-now and pay-at-property are separate lines; FX shown with the rate; occupancy rule blocks honestly. */
export function RateCard({ rate, selected, onPress }: { rate: Rate; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  const blocked = !rate.occupancy.bookable;
  return (
    <Pressable testID={TID.stays.rooms.rate} accessibilityRole="radio" accessibilityState={{ selected, disabled: blocked }} disabled={blocked} onPress={onPress}>
      <Card emphasis={selected} style={{ gap: 4, opacity: blocked ? 0.7 : 1 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}><Text variant="bodyStrong" style={{ flex: 1 }}>{rate.roomName}</Text>{blocked ? <Text variant="bodySmStrong" tone="errorInk">{rate.occupancy.reason}</Text> : <MoneyText money={rate.approximate ? rate.payAtProperty : rate.payNow} variant="bodyStrong" />}</View>
        {blocked ? <Text variant="caption" tone="text2">Not bookable for your guest count · change guests to see it</Text> : (<>
          <Text variant="caption" tone="text2">{rate.board ?? 'room only'} · sleeps {String(rate.occupancy.maxAdults)}</Text>
          <View style={{ borderTopWidth: 1, borderTopColor: t.colors.divider, marginTop: 6, paddingTop: 6 }}>
            <Row label="Pay now to UBI" value={<MoneyText money={rate.payNow} variant="bodySmStrong" />} />
            <Row label={rate.approximate ? 'Pay at the hotel (their rate on the day)' : 'Pay at the hotel'} value={<MoneyText money={rate.payAtProperty} variant="bodySmStrong" />} last />
            {rate.taxesNote ? <Text variant="caption" tone="text2">{rate.taxesNote}</Text> : null}
            {rate.supplierPrice && rate.fx ? <Text variant="caption" tone="text2">Hotel quotes in {rate.supplierPrice.currency} {(rate.supplierPrice.amountMinor / 100).toFixed(2)}; charged in naira at UBI's rate {rate.fx.rate.toLocaleString('en-NG')} fixed when you pay.</Text> : null}
          </View>
          <Text variant="caption" tone={rate.capabilities.refundSupported ? 'primaryInk' : 'warnInk'}>{rate.capabilities.refundSupported ? 'Free cancellation until ' + dt(rate.cancellation.freeUntil) + ' · ' + rate.cancellation.penaltyAfter : 'Non-refundable after ' + dt(rate.cancellation.freeUntil) + ' · UBI cannot refund an amount the hotel charges'}</Text>
        </>)}
      </Card>
    </Pressable>
  );
}
