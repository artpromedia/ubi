import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { TravelStackParamList } from '../../navigation/routes';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Screen, Text, Card, Chip, Row, Button, MoneyText, Skeleton, Banner, useTheme } from '@ubi/mobile-ui';
import { TID, track, formatMinor } from '@ubi/mobile-core';
import { travelApi } from '../../api/travel';

/** Board 21e — pickup time derived from the flight; this ride's own terms; confirmed only when a driver commits. Reuses reservation pickers from 9a/16a in RN-01. */
export function AttachAirportRideScreen() {
  const t = useTheme();
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<RouteProp<TravelStackParamList, 'AttachAirportRide'>>();
  const q = useQuery({ queryKey: ['resSuggest', params.orderId, params.direction], queryFn: () => travelApi.reservationSuggestion(params.orderId, params.direction) });
  const [time, setTime] = useState<string | undefined>(); const [cls, setCls] = useState<string | undefined>(); const [failed, setFailed] = useState<string | undefined>();
  const reserve = useMutation({ mutationFn: () => travelApi.reserve(params.orderId, time!, cls!), onSuccess: (r) => { if (r.status === 'reserved') { track('reservation_attached', { orderId: params.orderId, pickupAt: time, classId: cls }); nav.navigate('LinkedOrders', { tripId: params.orderId }); } else { track('reservation_failed', { orderId: params.orderId, reason: r.reason }); setFailed(r.reason ?? 'No reserved drivers accepted this time.'); } } });
  const s = q.data; const chosenClass = s?.classes.find(c => c.id === cls);
  React.useEffect(() => { if (s && !time) { setTime(s.suggestedPickupAt); setCls(s.classes[0]?.id); } }, [s]);
  return (
    <Screen onBack={nav.goBack} bg="bg" footer={s && chosenClass ? <Button testID={TID.reservations.airport.confirm} label={'Reserve · ' + formatMinor(chosenClass.price) + ' on completion'} loading={reserve.isPending} onPress={() => reserve.mutate()} /> : undefined}>
      <View accessibilityLabel={s?.mapLabel ?? 'map'} style={{ height: 220, marginHorizontal: -20, backgroundColor: t.colors.bg2 }} />
      {!s ? <Skeleton height={220} /> : (<>
        <Text variant="title">{params.direction === 'to_airport' ? 'Ride to the airport' : 'Ride from the airport'}</Text>
        <Text variant="caption" tone="text2">{s.advice}</Text>
        {failed ? <Banner tone="error" title="Not reserved" body={failed + ' Try another time or class, or book on the day.'} /> : null}
        <Card testID={TID.reservations.airport.form} style={{ backgroundColor: t.colors.bg2, paddingVertical: 2 }}>
          <Row><View style={{ flex: 1 }}><Text variant="label" tone="text3">Pickup</Text><Text variant="bodySmStrong">{s.flightLabel}</Text></View><View style={{ flexDirection: 'row', gap: 6 }}>{s.options.map(o => <Chip key={o} label={new Date(o).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Lagos' })} selected={time === o} onPress={() => setTime(o)} />)}</View></Row>
          <Row onPress={() => nav.navigate('Ride', { screen: 'Search' })}><View style={{ flex: 1 }}><Text variant="label" tone="text3">From</Text><Text variant="bodySmStrong">{s.from}</Text></View><Text variant="bodySmStrong" tone="link">Change</Text></Row>
          <Row last><View style={{ flex: 1 }}><Text variant="label" tone="text3">Class</Text><View style={{ flexDirection: 'row', gap: 6, marginTop: 4 }}>{s.classes.map(c => <Chip key={c.id} label={c.label + ' · ' + formatMinor(c.price)} selected={cls === c.id} onPress={() => setCls(c.id)} />)}</View></View></Row>
        </Card>
        <Card style={{ gap: 4 }}><Text variant="label" tone="text2">This ride's own terms</Text><Text variant="caption">{s.terms}</Text></Card>
      </>)}
    </Screen>
  );
}
