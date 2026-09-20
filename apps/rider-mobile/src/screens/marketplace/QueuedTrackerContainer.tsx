// R10 container — Marketplace.Queued. Renders the server-composed queue projection
// (PROPOSED endpoint, fixture-backed — see src/api/marketplace.ts). Reversal rows show
// Pending/processing until the financial events confirm; nothing flips green locally.
import React, { useState } from 'react';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Screen, Skeleton } from '@ubi/mobile-ui';
import { track } from '@ubi/mobile-core';
import type { MarketplaceStackParamList } from '../../navigation/routes';
import { marketplaceApi } from '../../api/marketplace';
import { QueuedTrackerScreen } from './QueuedTrackerScreen';

export function QueuedTrackerContainer() {
  useNavigation();
  const { params } = useRoute<RouteProp<MarketplaceStackParamList, 'Queued'>>();
  const qc = useQueryClient();
  const [cancelled, setCancelled] = useState(false);
  const [keptDelay, setKeptDelay] = useState(false);
  const q = useQuery({
    queryKey: ['mp', 'queue', params.requestId],
    queryFn: () => marketplaceApi.queue(params.requestId),
    // Reversals settle within moments of the events landing; poll until both are final.
    refetchInterval: (query) => {
      const v = query.state.data;
      if (v?.delayed?.reversal && v.delayed.reversal.riderHold === 'released' && v.delayed.reversal.driverFee === 'reversed') return false;
      return 5_000;
    },
  });
  const cancel = useMutation({
    mutationFn: () => marketplaceApi.cancel(params.requestId),
    onSuccess: () => { setCancelled(true); track('mp_queued_cancelled', { requestId: params.requestId }); void qc.invalidateQueries({ queryKey: ['mp', 'queue', params.requestId] }); },
  });
  const v = q.data;
  if (!v) return <Screen title="Pickup"><Skeleton height={160} /><Skeleton height={120} /></Screen>;
  const delayed = v.delayed && (!keptDelay || cancelled || v.delayed.reversal) ? {
    noticeTitle: v.delayed.noticeTitle,
    noticeBody: v.delayed.noticeBody,
    keepLabel: v.delayed.keepLabel,
    onKeep: () => { setKeptDelay(true); track('mp_queued_kept_waiting', { requestId: params.requestId }); },
    onCancelFree: () => cancel.mutate(),
    reversal: v.delayed.reversal,
  } : null;
  return (
    <QueuedTrackerScreen
      driverFirstName={v.driverFirstName}
      steps={v.steps}
      fareMinor={v.fareMinor}
      windowLabel={v.windowLabel}
      eta={v.eta}
      delayed={delayed}
      onCancelInWindow={() => cancel.mutate()}
    />
  );
}
