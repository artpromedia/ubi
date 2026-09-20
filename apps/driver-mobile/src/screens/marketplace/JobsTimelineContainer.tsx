// D05 + D11 container — Jobs (Root screen). Everything on this screen is a server
// projection of durable events (award.confirmed, commission.captured, claim.promoted,
// queue.*): the winner card and the fee receipt id exist only because the server said so.
// Promotion stays "pending"/"failed_revalidating" until the claim authority resolves it —
// the client never unlocks the next pickup on its own.
import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Screen, Skeleton, Banner } from '@ubi/mobile-ui';
import { track } from '@ubi/mobile-core';
import { marketplaceApi } from '../../api/marketplace';
import { JobsTimelineScreen, type JobCard } from './JobsTimelineScreen';

export function JobsTimelineContainer() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void; goBack: () => void }>();
  const q = useQuery({ queryKey: ['mp', 'jobs'], queryFn: marketplaceApi.jobs, refetchInterval: 5_000 });
  if (q.isError) {
    return (
      <Screen title="Your jobs" onBack={nav.goBack} bg="bg2">
        <Banner tone="error" title="Couldn’t load your jobs" body={(q.error as Error).message} />
      </Screen>
    );
  }
  const view = q.data;
  if (!view) return <Screen title="Your jobs" onBack={nav.goBack} bg="bg2"><Skeleton height={180} /><Skeleton height={120} /></Screen>;
  const card = (c: NonNullable<typeof view.current>): JobCard => ({
    claimId: c.claimId, slot: c.slot, statusSuffix: c.statusSuffix, title: c.title,
    fareMinor: c.fareMinor, feeLine: c.feeLine, feeReceiptId: c.feeReceiptId,
    detail: c.detail, remainingLabel: c.remainingLabel,
  });
  const toTrip = (tripId: string | null, screen: 'Navigate' | 'InTrip') => {
    if (!tripId) return;
    nav.navigate('Trip', { screen, params: { tripId } });
  };
  return (
    <JobsTimelineScreen
      winnerToast={view.winnerToast ? {
        title: view.winnerToast.title,
        fareMinor: view.winnerToast.fareMinor,
        feeLine: view.winnerToast.feeLine,
        receiptLine: view.winnerToast.receiptLine,
        addressesLine: view.winnerToast.addressesLine,
        onNavigate: () => { track('driver_mp_navigate_to_pickup', { tripId: view.winnerToast!.tripId }); toTrip(view.winnerToast!.tripId, 'Navigate'); },
      } : null}
      current={view.current ? card(view.current) : null}
      next={view.next ? card(view.next) : null}
      promotion={view.promotion}
      onContinueCurrent={() => toTrip(view.current?.tripId ?? null, 'InTrip')}
      onBack={nav.goBack}
    />
  );
}
