import React, { useState } from 'react';
import { View, FlatList } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { TravelStackParamList } from '../../navigation/routes';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Screen, Text, Chip, Button, Skeleton, Banner } from '@ubi/mobile-ui';
import { TID, track, formatMinor } from '@ubi/mobile-core';
import { travelApi, type FlightOffer } from '../../api/travel';
import { OfferCard } from '../../components/travel/OfferCard';

/** Board 21a — compare fare families before picking. Sort/filter chips are server-side params in RN-01 (client-side here for fixtures). */
export function FlightResultsScreen() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<RouteProp<TravelStackParamList, 'FlightResults'>>();
  const q = useQuery({ queryKey: ['flightSearch', params.searchId], queryFn: () => travelApi.refreshFlights(params.searchId), staleTime: 60_000 });
  const [sort, setSort] = useState<'cheapest' | 'earliest' | 'refundable' | 'bag'>('cheapest');
  const [sel, setSel] = useState<{ offerRef: string; familyId: string } | undefined>();
  const cart = useMutation({ mutationFn: () => travelApi.createCart([{ kind: 'flight', offerRef: sel!.offerRef, fareFamilyId: sel!.familyId }]), onSuccess: (c) => nav.navigate('PassengerDetails', { cartId: c.id, index: 0 }) });
  const s = q.data;
  React.useEffect(() => { if (s) track('travel_results_viewed', { searchId: s.searchId, count: s.offers.length, soldOut: s.offers.filter(o => o.soldOut).length, guaranteedCount: s.offers.filter(o => o.capabilities.priceGuaranteeUntil).length }); }, [s?.searchId]);
  const stale = s ? Date.now() - new Date(s.pricesAsOf).getTime() > 15 * 60_000 : false;
  const sorted = (s?.offers ?? []).slice().sort((a, b) => sort === 'earliest' ? a.departAt.localeCompare(b.departAt) : (a.fareFamilies[0]?.price.amountMinor ?? 9e12) - (b.fareFamilies[0]?.price.amountMinor ?? 9e12)).filter(o => sort === 'refundable' ? o.fareFamilies.some(f => /refund/i.test(f.refundRule) && !/non-refundable|no refund/i.test(f.refundRule)) : true);
  const selOffer = s?.offers.find(o => o.offerRef === sel?.offerRef); const selFam = selOffer?.fareFamilies.find(f => f.id === sel?.familyId);
  return (
    <Screen title={s ? s.from + ' → ' + s.to + ' · ' + new Date(s.date).toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Flights'} subtitle={s ? s.passengers + ' adult · Economy · prices refreshed ' + new Date(s.pricesAsOf).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit', hour12: false }) : undefined} onBack={nav.goBack} scroll={false}
      footer={selFam ? <Button testID={TID.flights.results.continue} label={'Continue · ' + selOffer!.carrier + ' ' + selFam.name} trailing={formatMinor(selFam.price)} loading={cart.isPending} onPress={() => { track('travel_offer_selected', { offerId: sel!.offerRef, fareFamily: selFam.name, priceMinor: selFam.price.amountMinor }); cart.mutate(); }} /> : undefined}>
      <View style={{ paddingHorizontal: 20, gap: 12, flex: 1 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>{(['cheapest', 'earliest', 'refundable', 'bag'] as const).map(k => <Chip key={k} label={k === 'bag' ? 'Bag included' : k[0].toUpperCase() + k.slice(1)} selected={sort === k} onPress={() => setSort(k)} />)}</View>
        {stale ? <Banner tone="warn" body="These prices are more than 15 minutes old. Refresh before you continue." /> : null}
        {q.isLoading ? <><Skeleton height={150} /><Skeleton height={150} /></> : q.isError ? <Banner tone="error" body="Couldn't load flights. Check your connection and try again." /> : (
          <FlatList testID={TID.flights.search.results} data={sorted} keyExtractor={(o: FlightOffer) => o.offerRef} contentContainerStyle={{ gap: 10, paddingBottom: 24 }} renderItem={({ item }) => <OfferCard offer={item} emphasis={sel?.offerRef === item.offerRef} selectedFamily={sel?.offerRef === item.offerRef ? sel.familyId : undefined} onSelectFamily={(id) => setSel({ offerRef: item.offerRef, familyId: id })} />}
            ListEmptyComponent={<Text variant="bodySm" tone="text2">No flights on this route for that day. Try another date.</Text>} />
        )}
      </View>
    </Screen>
  );
}
