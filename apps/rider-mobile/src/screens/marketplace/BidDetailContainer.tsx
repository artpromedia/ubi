// R05 + R09 container — Marketplace.BidDetail. Selection pins requestVersion + bidVersion;
// the screen converges on the award via GET (≈2s while pending) and renders success ONLY from
// durable server state (award.confirmed). version_conflict / bid_not_live send the rider back
// to the inbox with the server's refreshed-terms notice — never a silent retry.
import React, { useEffect, useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Screen, Skeleton, type LadderStep } from '@ubi/mobile-ui';
import { ApiError, track } from '@ubi/mobile-core';
import type { MarketplaceStackParamList } from '../../navigation/routes';
import { marketplaceApi } from '../../api/marketplace';
import { BidDetailScreen } from './BidDetailScreen';

const winLabel = (sec: number) => Math.round(sec / 60) + ' min';

export function BidDetailContainer() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const { params } = useRoute<RouteProp<MarketplaceStackParamList, 'BidDetail'>>();
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
  const [consented, setConsented] = useState(false);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [awardPolling, setAwardPolling] = useState(false);
  const awardQ = useQuery({
    queryKey: ['mp', 'award', params.requestId],
    queryFn: () => marketplaceApi.award(params.requestId),
    enabled: awardPolling,
    refetchInterval: (query) => (query.state.data && query.state.data.state !== 'pending' ? false : 2_000),
  });
  const award = awardQ.data ?? snap?.award;
  useEffect(() => { if (snap?.award?.state === 'pending') setAwardPolling(true); }, [snap?.award?.state]);
  const select = useMutation({
    mutationFn: (input: { bidId: string; requestVersion: number; bidVersion: number; consent: { etaVersion: number } | null }) =>
      marketplaceApi.select(params.requestId, {
        bidId: input.bidId, requestVersion: input.requestVersion, bidVersion: input.bidVersion,
        ...(input.consent ? { pickupWindowConsent: { etaVersion: input.consent.etaVersion, accepted: true as const } } : {}),
      }),
    onSuccess: (a) => { track('mp_bid_selected', { requestId: params.requestId, bidId: a.bidId, slot: a.slot }); setAwardPolling(true); },
    onError: (e) => {
      if (e instanceof ApiError && (e.code === 'version_conflict' || e.code === 'bid_not_live' || e.code === 'request_closed' || e.code === 'award_unresolved')) {
        track('mp_select_conflict', { requestId: params.requestId, code: e.code });
        nav.navigate('Offers', { requestId: params.requestId, unavailableNotice: e.message });
        return;
      }
      setFailReason(e instanceof ApiError ? e.message : 'Selection didn’t reach the server. Your offers are unchanged — try again.');
    },
  });
  // Durable outcomes only: confirmed moves forward, failed reopens honestly, unknown stays pending.
  useEffect(() => {
    if (award?.state === 'confirmed') {
      track('mp_award_confirmed', { requestId: params.requestId, awardId: award.awardId, slot: award.slot });
      if (award.slot === 'next') nav.navigate('Queued', { requestId: params.requestId });
      else nav.navigate('Ride', { screen: 'Assigned', params: { rideId: award.executionRef?.id ?? '' } });
    }
    if (award?.state === 'failed') setFailReason('The driver couldn’t be confirmed (wallet or capacity check failed). Your request is open again — pick another offer.');
  }, [award?.state]);
  const offer = snap?.offers.find(o => o.bidId === params.bidId);
  if (!snap || !offer) return <Screen title="Offer" onBack={nav.goBack}><Skeleton height={110} /><Skeleton height={160} /></Screen>;
  const r = snap.request;
  const slot = offer.kind === 'finishing_trip' ? 'next' as const : 'current' as const;
  const phase = failReason ? 'award_failed' as const : (select.isPending || award?.state === 'pending') ? 'award_pending' as const : 'detail' as const;
  const awardSteps: LadderStep[] = [
    { label: 'Offer selected', detail: 'Terms pinned at v' + offer.bidVersion, state: 'done' },
    { label: 'Confirming driver & payment', detail: 'Commission is captured exactly once at selection', state: 'active' },
    { label: r.service === 'ride' ? 'Assigning your trip' : 'Assigning your delivery', state: 'pending' },
  ];
  return (
    <BidDetailScreen
      driver={{ name: offer.driver.displayName, rating: offer.driver.rating, trips: offer.driver.completedTrips, vehicle: offer.driver.vehicle, plateMasked: offer.driver.plateMasked, initials: offer.driver.initials }}
      bid={{ bidId: offer.bidId, bidVersion: offer.bidVersion, requestVersion: r.version, amountMinor: offer.amountMinor, bookingFeeMinor: offer.bookingFeeMinor ?? null, totalMinor: offer.totalMinor ?? null, paymentLabel: 'UBI Wallet' }}
      slot={slot}
      window={slot === 'next' && offer.pickupWindow ? {
        label: winLabel(offer.pickupWindow.earliestSec) + '–' + winLabel(offer.pickupWindow.latestSec),
        consentCopy: 'I accept pickup within ' + winLabel(offer.pickupWindow.earliestSec) + '–' + winLabel(offer.pickupWindow.latestSec) + '. Cancelling stays free until the driver heads my way.',
        consented,
        onToggle: () => setConsented(v => !v),
      } : null}
      whyRecommended={offer.whyRecommended}
      widenedBanner={r.searchEnvelope.step > 0 ? 'The search area was widened — this offer and the others were kept.' : null}
      compareLine={null}
      phase={phase}
      awardSteps={awardSteps}
      failReason={failReason}
      onChoose={() => {
        setFailReason(null);
        select.mutate({ bidId: offer.bidId, requestVersion: r.version, bidVersion: offer.bidVersion, consent: slot === 'next' && offer.pickupWindow && consented ? { etaVersion: offer.pickupWindow.etaVersion } : null });
      }}
      onBack={nav.goBack}
    />
  );
}
