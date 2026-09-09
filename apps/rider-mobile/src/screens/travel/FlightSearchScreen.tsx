import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useMutation } from '@tanstack/react-query';
import { Screen, Text, Card, Chip, Row, Toggle, Button, Banner } from '@ubi/mobile-ui';
import { TID, track, useFlag } from '@ubi/mobile-core';
import { travelApi } from '../../api/travel';
import type { TravelStackParamList } from '../../navigation/routes';

/** Board 21a — the conventional form Ask UBI also opens (params prefilled). */
export function FlightSearchScreen() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<RouteProp<TravelStackParamList, 'FlightSearch'>>();
  const staysOn = useFlag('stays_booking');
  const [mode, setMode] = useState<'return' | 'one_way'>(params?.returnDate ? 'return' : 'return');
  const [form, setForm] = useState({ from: params?.from ?? 'LOS', to: params?.to ?? 'ABV', departDate: params?.departDate ?? '2026-09-12', returnDate: params?.returnDate ?? '2026-09-14', passengers: params?.passengers ?? 1, cabin: 'economy', withStay: params?.withStay ?? false });
  const search = useMutation({ mutationFn: () => travelApi.searchFlights({ ...form, returnDate: mode === 'return' ? form.returnDate : undefined }), onSuccess: (r) => { track('travel_search', { mode, from: form.from, to: form.to, withStay: form.withStay }); nav.navigate('FlightResults', { searchId: r.searchId }); } });
  const label = (d: string) => new Date(d).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
  return (
    <Screen onBack={nav.goBack}>
      <Text variant="label" tone="travelInk" style={{ marginTop: 8 }}>Flights & stays</Text>
      <Text variant="display" accessibilityRole="header">Where are you flying?</Text>
      <View style={{ flexDirection: 'row', gap: 6 }}><Chip label="Return" selected={mode === 'return'} onPress={() => setMode('return')} /><Chip label="One way" selected={mode === 'one_way'} onPress={() => setMode('one_way')} /></View>
      <Card testID={TID.flights.search.form} style={{ paddingVertical: 2 }}>
        <Row onPress={() => nav.navigate('AirportPicker', { field: 'from' })} accessibilityLabel="From, Lagos LOS"><Text variant="label" tone="text3" style={{ width: 44 }}>From</Text><View style={{ flex: 1 }}><Text variant="bodyStrong">Lagos · {form.from}</Text><Text variant="caption" tone="text2">Murtala Muhammed · any terminal</Text></View></Row>
        <Row onPress={() => nav.navigate('AirportPicker', { field: 'to' })} accessibilityLabel="To, Abuja ABV"><Text variant="label" tone="text3" style={{ width: 44 }}>To</Text><View style={{ flex: 1 }}><Text variant="bodyStrong">Abuja · {form.to}</Text><Text variant="caption" tone="text2">Nnamdi Azikiwe International</Text></View></Row>
        <Row><View style={{ flex: 1 }}><Text variant="label" tone="text3">Depart</Text><Text variant="bodyStrong">{label(form.departDate)}</Text></View>{mode === 'return' ? <View style={{ flex: 1 }}><Text variant="label" tone="text3">Return</Text><Text variant="bodyStrong">{label(form.returnDate)}</Text></View> : null}</Row>
        <Row last><View style={{ flex: 1 }}><Text variant="label" tone="text3">Passengers</Text><Text variant="bodyStrong">{form.passengers} adult</Text></View><View style={{ flex: 1 }}><Text variant="label" tone="text3">Cabin</Text><Text variant="bodyStrong">Economy</Text></View></Row>
      </Card>
      {staysOn ? <Card><Toggle label="Add a hotel in Abuja" detail="Same dates · 1 guest · booked separately" value={form.withStay} onChange={v => setForm({ ...form, withStay: v })} /></Card> : null}
      {search.isError ? <Banner tone="error" body="Search is unavailable right now. Try again in a moment." /> : null}
      <Button testID={TID.flights.search.submit} label="Search flights" loading={search.isPending} onPress={() => search.mutate()} />
      <Text variant="caption" tone="text2">Domestic flights only for now. Prices include taxes; UBI's service fee per ticket is shown before you pay. Times are local (WAT, UTC+1).</Text>
    </Screen>
  );
}
