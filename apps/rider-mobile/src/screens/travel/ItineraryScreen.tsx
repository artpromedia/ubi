import React from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Skeleton } from '@ubi/mobile-ui';
import { travelApi, type LinkedItem } from '../../api/travel';
import { ItemCard } from '../../components/travel/ItemCard';

/** Board 21c — every item with its own status, times (with time zone) and policy. */
export function ItineraryScreen() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<{ params: { tripId: string } }>();
  const q = useQuery({ queryKey: ['trip', params.tripId], queryFn: () => travelApi.trip(params.tripId) });
  const act = (item: LinkedItem, key: string) => {
    if (key === 'change' || key === 'cancel') nav.navigate('Servicing', { orderId: item.orderId });
    else if (key === 'retry_time' || key === 'reserve') nav.navigate('AttachAirportRide', { orderId: item.orderId ?? params.tripId, direction: 'from_airport' });
    else if (key === 'boarding_pass') nav.navigate('BoardingPass', { orderId: item.orderId });
    else if (key === 'add_return') nav.navigate('FlightSearch', { from: 'ABV', to: 'LOS' });
    else if (key === 'remind') nav.navigate('Main', { screen: 'Home' });
  };
  const t = q.data;
  return (
    <Screen title={t?.title ?? 'Trip'} subtitle={t ? t.dates + ' · all times WAT (UTC+1)' : undefined} onBack={nav.goBack} action={{ label: 'Share', onPress: () => {} }}>
      {!t ? <><Skeleton height={140} /><Skeleton height={120} /></> : t.items.map(it => <ItemCard key={it.title + it.dateLabel} item={it} onAction={(k) => act(it, k)} />)}
    </Screen>
  );
}
