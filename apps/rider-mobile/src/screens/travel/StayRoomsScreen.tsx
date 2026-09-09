import React, { useState } from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Screen, Text, Button, Skeleton, useTheme } from '@ubi/mobile-ui';
import { travelApi } from '../../api/travel';
import { RateCard } from '../../components/travel/RateCard';

/** Board 21b — room, occupancy, pay-now vs at-property, currency, cancellation deadline. Photos are supplied by the property. */
export function StayRoomsScreen() {
  const t = useTheme();
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<{ params: { propertyId: string; searchId: string } }>();
  const q = useQuery({ queryKey: ['rates', params.propertyId, params.searchId], queryFn: () => travelApi.rates(params.propertyId, params.searchId) });
  const [sel, setSel] = useState<string | undefined>();
  const cart = useMutation({ mutationFn: () => travelApi.createCart([{ kind: 'stay', offerRef: params.propertyId, rateId: sel }]), onSuccess: (c) => nav.navigate('Checkout', { cartId: c.id }) });
  const d = q.data;
  return (
    <Screen onBack={nav.goBack} footer={sel ? <Button label="Continue to payment" kind="inverse" loading={cart.isPending} onPress={() => cart.mutate()} /> : undefined}>
      <View accessibilityLabel="Hotel photos, supplied by the property" style={{ height: 170, marginHorizontal: -20, backgroundColor: t.colors.bg2 }} />
      {!d ? <Skeleton height={200} /> : (<>
        <Text variant="title">{d.property.name}</Text>
        <Text variant="caption" tone="text2">{d.property.area} · {d.property.distanceKm} km from {d.property.distanceTo} · {d.property.checkIn} → {d.property.checkOut} · {d.property.nights} nights</Text>
        {d.rates.map(r => <RateCard key={r.id} rate={r} selected={sel === r.id} onPress={() => setSel(r.id)} />)}
      </>)}
    </Screen>
  );
}
