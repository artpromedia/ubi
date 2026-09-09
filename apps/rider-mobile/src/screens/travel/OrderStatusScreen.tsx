import React from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { TravelStackParamList } from '../../navigation/routes';
import { useQuery } from '@tanstack/react-query';
import { Screen, Text, Card, StatusPill, Ladder, Button, Skeleton, Banner } from '@ubi/mobile-ui';
import { TID, track } from '@ubi/mobile-core';
import { travelApi, type OrderState } from '../../api/travel';

const pill = (s: OrderState) => s === 'ticketed' ? 'ticketed' : s === 'confirmed' ? 'confirmed' : s === 'failed_released' ? 'failed' : s === 'unknown_reconciling' ? 'processing' : s === 'cancelled' ? 'cancelled' : s === 'refunded' ? 'refund_in_progress' : 'supplier_pending';
/** Board 21c — the ladder. A PNR is not a ticket; the copy says so. Unknown results reconcile — no "pay again". */
export function OrderStatusScreen() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<RouteProp<TravelStackParamList, 'OrderStatus'>>();
  const q = useQuery({ queryKey: ['order', params.orderId], queryFn: () => travelApi.order(params.orderId), refetchInterval: (query) => (['submitted', 'supplier_pending', 'unknown_reconciling', 'payment_authorized'].includes(query.state.data?.state ?? '') ? 15_000 : false) });
  const o = q.data;
  React.useEffect(() => { if (o) track('travel_order_status_viewed', { orderId: o.id, state: o.state }); }, [o?.state]);
  return (
    <Screen onBack={nav.goBack} footer={o ? <Button label={o.state === 'ticketed' || o.state === 'confirmed' ? 'View itinerary' : 'Notify me · go back home'} kind="inverse" onPress={() => o.state === 'ticketed' || o.state === 'confirmed' ? nav.navigate('Itinerary', { tripId: o.tripId }) : nav.navigate('Main', { screen: 'Home' })} /> : undefined}>
      {!o ? <Skeleton height={240} /> : (<>
        <StatusPill status={pill(o.state)} />
        <Text variant="display" accessibilityRole="header">{o.headline}</Text>
        <Text variant="bodySm" tone="text2">{o.body}</Text>
        <Card><Ladder testID={TID.travel.order.ladder} steps={o.ladder.map(s => ({ label: s.label, detail: s.detail, state: s.state }))} /></Card>
        {o.siblingNote ? <Text variant="caption" tone="text2">{o.siblingNote}</Text> : null}
        {o.state === 'unknown_reconciling' ? <Banner tone="warn" title="We're confirming with the supplier" body="The answer took too long. We check the original request — we never book it twice. Your money stays held until we know." /> : null}
      </>)}
    </Screen>
  );
}
