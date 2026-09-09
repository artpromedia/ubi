import React from 'react';
import { View, Pressable } from 'react-native';
import { Card, Text, MoneyText, StatusPill, useTheme } from '@ubi/mobile-ui';
import { TID } from '@ubi/mobile-core';
import type { FlightOffer, FareFamily } from '../../api/travel';

const hm = (iso: string) => new Date(iso).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' });
export function FareFamilyOption({ f, selected, onPress }: { f: FareFamily; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={f.name + ', ' + f.baggage + ', ' + f.changeRule + ', ' + f.refundRule} onPress={onPress} style={{ flex: 1, borderWidth: selected ? 1.5 : 1, borderColor: selected ? t.colors.text : t.colors.border, borderRadius: t.radius.control, padding: 10, gap: 4, minHeight: 64 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text variant="bodySmStrong">{f.name}</Text><MoneyText money={f.price} variant="bodySmStrong" /></View>
      <Text variant="caption" tone="text2">{f.baggage} · {f.changeRule} · {f.refundRule}</Text>
    </Pressable>
  );
}
/** Board 21a. "Price guaranteed to" only when the adapter returned priceGuaranteeUntil; sold-out offers stay visible. */
export function OfferCard({ offer, selectedFamily, onSelectFamily, emphasis }: { offer: FlightOffer; selectedFamily?: string; onSelectFamily: (id: string) => void; emphasis?: boolean }) {
  const t = useTheme();
  const g = offer.capabilities.priceGuaranteeUntil;
  return (
    <Card testID={TID.flights.results.offer} emphasis={emphasis} style={{ gap: 8, opacity: offer.soldOut ? 0.7 : 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}><Text variant="heading" tabular>{hm(offer.departAt)} → {hm(offer.arriveAt)}</Text><Text variant="caption" tone="text2">{Math.floor(offer.durationMin / 60)}h {String(offer.durationMin % 60).padStart(2, '0')}m · {offer.stops === 0 ? 'non-stop' : offer.stops + ' stop'}</Text></View>
      <Text variant="caption" tone="text2">{offer.carrier} · {offer.flightNumber}{offer.aircraft ? ' · ' + offer.aircraft : ''}{offer.departTerminal ? ' · ' + offer.departTerminal + ' → ' + offer.arriveTerminal : ''}</Text>
      {offer.soldOut ? <Text variant="bodySmStrong" tone="errorInk">{offer.soldOutNote ?? 'Sold out'}</Text> : (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>{offer.fareFamilies.map(ff => <FareFamilyOption key={ff.id} f={ff} selected={selectedFamily === ff.id} onPress={() => onSelectFamily(ff.id)} />)}</View>
          {g ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><StatusPill status="live" suffix={'price guaranteed to ' + hm(g)} /><Text variant="caption" tone="text2">if you book now · not a seat reservation</Text></View>
             : <Text variant="caption" tone="warnInk">Price can change until you pay — no seat is held.</Text>}
        </>
      )}
    </Card>
  );
}
