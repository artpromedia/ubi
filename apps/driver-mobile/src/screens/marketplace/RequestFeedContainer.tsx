// D01 + D06 + D07 container — Requests.Feed. The feed and "My offers" poll REST snapshots
// (useResumableStream is the sanctioned upgrade path once the realtime channel ships, see
// followups). The motion gate comes from useMotionGate(): while moving, the screen renders
// no bid affordances at all — and the server independently rejects with NOT_STATIONARY.
import React, { useEffect, useRef, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { track } from '@ubi/mobile-core';
import { marketplaceApi, type MpBidDto } from '../../api/marketplace';
import { useMotionGate } from '../../lib/motion';
import { RequestFeedScreen, type FeedRequest, type MyBid } from './RequestFeedScreen';

const mmss = (iso: string) => {
  const sec = Math.max(0, Math.floor((Date.parse(iso) - Date.now()) / 1000));
  return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
};

/**
 * Server holdState vocabulary (D06): held | release_pending | released, where
 * `released` is only emitted after the wallet release is financially confirmed.
 * Anything else (older servers, machine-internal values like 'active'/'captured',
 * shape drift) is UNKNOWN and renders the safe pending state — never 'released':
 * claiming the money is back before the wallet confirms is the one lie this
 * screen must not tell.
 */
export const holdStateOrSafe = (v: unknown, safe: 'held' | 'release_pending'): 'held' | 'release_pending' | 'released' =>
  v === 'held' || v === 'release_pending' || v === 'released' ? v : safe;

// Live bid states keep a row in "My offers"; won bids move to Jobs and withdrawn ones
// disappear at the driver's own request. `invalidated` means the slot filled elsewhere
// (you won another request) — the hold releases, never a penalty.
export const bidRow = (b: MpBidDto): MyBid | null => {
  const status = b.state === 'submitted' || b.state === 'revised' || b.state === 'selected_pending' ? 'awaiting'
    : b.state === 'lost' ? 'lost'
      : b.state === 'expired' ? 'expired'
        : b.state === 'invalidated' ? 'won_elsewhere'
          : null;
  if (!status) return null;
  return {
    bidId: b.bidId,
    title: b.title ?? 'Request ' + b.requestId,
    amountMinor: b.amountMinor,
    status,
    holdMinor: b.commissionMinor,
    // Server-composed projection when it speaks the D06 vocabulary; anything unknown
    // (and a lost/closed bid whose hold has not been confirmed released) stays the
    // safe pending state — never claimed released early.
    holdState: holdStateOrSafe(b.holdState, status === 'awaiting' ? 'held' : 'release_pending'),
    holdDetail: b.holdDetail ?? (status === 'awaiting' ? 'closes ' + mmss(b.expiresAt) : ''),
  };
};

export function RequestFeedContainer() {
  const nav = useNavigation<{ navigate: (n: string, p?: unknown) => void }>();
  const gate = useMotionGate();
  const [tab, setTab] = useState<'feed' | 'myBids'>('feed');
  const feedQ = useQuery({ queryKey: ['mp', 'feed'], queryFn: () => marketplaceApi.feed(), refetchInterval: 10_000 });
  const bidsQ = useQuery({ queryKey: ['mp', 'bids', 'mine'], queryFn: marketplaceApi.myBids, refetchInterval: tab === 'myBids' ? 5_000 : 30_000 });
  // "Refreshed from server" pill exactly once after a reconnect (D06 reconnect rule).
  const wasError = useRef(false);
  const [reconnected, setReconnected] = useState(false);
  useEffect(() => {
    if (feedQ.isError) { wasError.current = true; return; }
    if (feedQ.isSuccess && wasError.current) {
      wasError.current = false;
      setReconnected(true);
      const t = setTimeout(() => setReconnected(false), 4_000);
      return () => clearTimeout(t);
    }
  }, [feedQ.isError, feedQ.isSuccess]);
  const requests: FeedRequest[] = (feedQ.data?.items ?? []).map((r) => ({
    requestId: r.requestId, revision: r.revision, title: r.title, meta: r.meta,
    askedMinor: r.askedMinor, askedByLabel: r.askedByLabel, capabilityBadge: r.capabilityBadge,
    expiresLabel: mmss(r.expiresAt),
  }));
  const myBids: MyBid[] = (bidsQ.data?.bids ?? []).map(bidRow).filter((b): b is MyBid => b !== null);
  return (
    <RequestFeedScreen
      motion={gate.motion}
      // Presence (online/offline + area) has no real plumbing yet — HomeScreen carries the
      // same static placeholder; both are wired to the presence service in RN-02 (followups).
      online
      areaLabel="Lekki"
      earningsTodayLabel=""
      tab={tab}
      onTab={setTab}
      requests={requests}
      onOpen={(requestId) => { track('driver_mp_request_opened', { requestId }); nav.navigate('Detail', { requestId }); }}
      deferredPrompt={gate.motion === 'moving' ? feedQ.data?.deferredPrompt ?? null : null}
      reconnected={reconnected}
      myBids={myBids}
      parkedConfirm={gate.motion === 'parked_confirmed' ? null : { confirming: gate.confirming, error: gate.confirmError, onConfirm: () => { void gate.confirmParked(); } }}
      quickLinks={[
        { key: 'jobs', label: 'Your jobs', onPress: () => nav.navigate('Jobs') },
        { key: 'wallet', label: 'Wallet holds', onPress: () => nav.navigate('WalletHolds') },
        { key: 'rates', label: 'My rates', onPress: () => nav.navigate('Rates') },
      ]}
    />
  );
}
