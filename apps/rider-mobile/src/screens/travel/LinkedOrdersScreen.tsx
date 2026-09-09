import React from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { TravelStackParamList } from '../../navigation/routes';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, Skeleton, Button } from '@ubi/mobile-ui';
import { travelApi, type LinkedItem } from '../../api/travel';
import { ItemCard } from '../../components/travel/ItemCard';

/** Board 21e — linked orders: separate outcomes, separate money, separate policies, one screen. */
export function LinkedOrdersScreen() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<RouteProp<TravelStackParamList, 'LinkedOrders'>>();
  const q = useQuery({ queryKey: ['linked', params.tripId], queryFn: () => travelApi.linked(params.tripId) });
  const t = q.data;
  const failedRide = t?.items.find(i => i.kind === 'ride_reservation' && i.status === 'not_reserved');
  const act = (item: LinkedItem, key: string) => nav.navigate(key === 'book_on_day' ? 'Main' : 'AttachAirportRide', { orderId: item.orderId, direction: 'to_airport' });
  return (
    <Screen onBack={nav.goBack} footer={failedRide ? <Button label="Reserve a different class or time" kind="inverse" onPress={() => nav.navigate('AttachAirportRide', { orderId: failedRide.orderId, direction: 'to_airport' })} /> : undefined}>
      {!t ? <Skeleton height={240} /> : (<>
        <Text variant="display" accessibilityRole="header">{t.title}</Text>
        <Text variant="bodySm" tone="text2">These are separate orders. Here is what happened to each and what it costs you.</Text>
        {t.items.map(it => <ItemCard key={it.title} item={it} onAction={(k) => act(it, k)} />)}
        <Card style={{ gap: 4 }}><Text variant="label" tone="text2">If the flight is disrupted</Text><Text variant="caption">{t.items.find(i => i.kind === 'flight')?.disruption ?? 'Protection depends on the fare you bought. A reserved ride is moved once, free, to match a new flight time.'}</Text></Card>
      </>)}
    </Screen>
  );
}
