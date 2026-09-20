// R04 + R07 container — Marketplace.Offers. Polls the owner snapshot (searching/open ≈ 5s,
// award_pending ≈ 2s, terminal off). Offer order is stable: arrival order, sort applied only on
// an explicit toggle (later arrivals append), and withdrawn/dropped offers keep their last-known
// card struck through instead of vanishing mid-interaction.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Screen, Skeleton } from '@ubi/mobile-ui';
import { track } from '@ubi/mobile-core';
import type { MarketplaceStackParamList, MarketplaceQuoteParams } from '../../navigation/routes';
import { marketplaceApi, type MpOfferDto } from '../../api/marketplace';
import { OfferInboxScreen, type Offer } from './OfferInboxScreen';
import { displayOrder, mergeArrivalOrder, sortOfferIds } from './offerOrder';

const minsLeft = (iso: string) => Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 60_000));
const kmLabel = (meters: number) => { const km = meters / 1000; return (Number.isInteger(km) ? String(km) : km.toFixed(1)) + ' km'; };

export function OfferInboxContainer() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<RouteProp<MarketplaceStackParamList, 'Offers'>>();
  const q = useQuery({
    queryKey: ['mp', 'request', params.requestId],
    queryFn: () => marketplaceApi.request(params.requestId),
    refetchInterval: (query) => {
      const s = query.state.data?.request.state;
      if (s === 'award_pending') return 2_000;
      if (s === undefined || s === 'draft' || s === 'open') return 5_000;
      return false;
    },
  });
  const snap = q.data;
  // Keep-last-known cache + arrival order (stable across updates).
  const cacheRef = useRef<Map<string, MpOfferDto>>(new Map());
  const arrivalRef = useRef<string[]>([]);
  if (snap) {
    for (const o of snap.offers) cacheRef.current.set(o.bidId, o);
    arrivalRef.current = mergeArrivalOrder(arrivalRef.current, snap.offers);
  }
  const [sort, setSort] = useState<'price' | 'eta'>('price');
  const [sortedIds, setSortedIds] = useState<string[] | null>(null);
  const [, setClock] = useState(0); // re-render for elapsed/expiry labels
  useEffect(() => { const t = setInterval(() => setClock(c => c + 1), 1_000); return () => clearInterval(t); }, []);
  const cancel = useMutation({
    mutationFn: () => marketplaceApi.cancel(params.requestId),
    onSuccess: () => { track('mp_request_cancelled', { requestId: params.requestId }); nav.goBack(); },
  });
  // Award convergence: only durable server state moves the rider forward.
  const award = snap?.award;
  useEffect(() => {
    if (award?.state !== 'confirmed') return;
    if (award.slot === 'next') nav.navigate('Queued', { requestId: params.requestId });
    else nav.navigate('Ride', { screen: 'Assigned', params: { rideId: award.executionRef?.id ?? '' } });
  }, [award?.state]);
  if (!snap) return <Screen title="Your request is live"><Skeleton height={90} /><Skeleton height={130} /><Skeleton height={130} /></Screen>;
  const r = snap.request;
  const dtos = displayOrder(arrivalRef.current, sortedIds).map(id => cacheRef.current.get(id)).filter((o): o is MpOfferDto => !!o);
  const offers: Offer[] = dtos.map(o => ({
    bidId: o.bidId, bidVersion: o.bidVersion,
    driverName: o.driver.displayName, rating: o.driver.rating, trips: o.driver.completedTrips, vehicle: o.driver.vehicle, initials: o.driver.initials,
    amountMinor: o.amountMinor,
    // Server-phrased when provided; otherwise only an amount COMPARISON (no client money arithmetic).
    deltaLabel: o.deltaLabel ?? (o.amountMinor.amountMinor === r.requestedFareMinor.amountMinor ? null : o.amountMinor.amountMinor > r.requestedFareMinor.amountMinor ? 'above your ask' : 'below your ask'),
    kind: o.kind, pickupLabel: o.pickupLabel, expiresLabel: minsLeft(o.expiresAt) + ' min', withdrawn: o.withdrawn,
  }));
  const phase = (r.state === 'no_offers' || (r.state === 'expired' && offers.length === 0)) ? 'no_offers'
    : (r.state === 'open' || r.state === 'draft') && offers.length === 0 ? 'searching'
      : params.unavailableNotice ? 'winner_unavailable' : 'offers';
  const elapsedSec = Math.max(0, Math.floor((Date.now() - Date.parse(r.createdAt)) / 1000));
  const onRepost = (kind: 'suggested' | 'same_wider') => {
    const quoteParams: MarketplaceQuoteParams = { service: r.service, vehicleClass: r.vehicleClass, pickup: r.pickup, dropoff: r.dropoff, ...(r.delivery ? { weightKg: r.delivery.weightKg, handling: r.delivery.handling } : {}) };
    track('mp_request_repost', { requestId: r.requestId, kind });
    nav.navigate('Fare', { quoteParams });
  };
  return (
    <OfferInboxScreen
      phase={phase}
      connection={q.isError ? 'reconnecting' : 'online'}
      requestedMinor={r.requestedFareMinor}
      elapsedLabel={Math.floor(elapsedSec / 60) + ':' + String(elapsedSec % 60).padStart(2, '0')}
      expiresLabel={'in ' + minsLeft(r.expiresAt) + ' min'}
      envelopeLabel={'Eligible drivers within ' + kmLabel(r.searchEnvelope.radiusMeters) + ' can see your request'}
      widenedBanner={r.searchEnvelope.step > 0 ? 'Search widened to ' + kmLabel(r.searchEnvelope.radiusMeters) + ' — your existing offers are kept.' : null}
      sort={sort}
      onSort={(s) => { setSort(s); setSortedIds(sortOfferIds(dtos, s)); track('mp_offers_sorted', { requestId: r.requestId, sort: s }); }}
      offers={offers}
      onOpenOffer={(bidId) => nav.navigate('BidDetail', { requestId: r.requestId, bidId })}
      unavailableNotice={params.unavailableNotice ?? null}
      onCancel={() => cancel.mutate()}
      onRepost={onRepost}
    />
  );
}
