// Driver-side negotiated-fare marketplace (M08, boards D01–D12).
// Paths follow contracts/openapi/marketplace.yaml; DTO shapes come straight from
// @ubi/contracts/src/marketplace.ts. Presets, fee, net and shortfall arrive
// SERVER-phrased and are rendered verbatim — the client never computes money
// (launch CLAUDE.md #1, M03A rule).
import { api, type Money } from '@ubi/mobile-core';
import type { MpBid, MpEligibility, MpFeedItem, MpFeedPage, MpPreset, MpRatePreview, MpRateProfile, MpService, MpSubmitBid, MpWalletHold, MpWalletOverview } from '@ubi/contracts';

export type { MpBid, MpEligibility, MpFeedItem, MpPreset, MpRatePreview, MpRateProfile, MpSubmitBid, MpWalletOverview };

/**
 * D06 "My offers" view. `title`, `holdState` and `holdDetail` are PROPOSED
 * contract additions the D06 board requires (request title and a server-composed
 * hold projection: a lost bid whose commission hold is not yet financially
 * confirmed released renders "release pending", never "released"). Until
 * packages/contracts MpBidSchema + contracts/openapi/marketplace.yaml carry
 * them, only fixtures serve them; see followups.
 */
export type MpBidDto = MpBid & { title?: string; holdState?: 'held' | 'release_pending' | 'released'; holdDetail?: string };

/** GET /v1/mp/requests/:id/driver-view (D02/D03/D10) per contracts/openapi/marketplace.yaml. */
export type MpDriverView = {
  item: MpFeedItem;
  eligibility: MpEligibility;
  presets: MpPreset[];
  profileLine?: string | null;
  ceilingNotice?: string | null;
  myBid?: MpBidDto | null;
};

/** `deferredPrompt` (D07 single deferred banner, server-phrased) is a PROPOSED MpFeedPage addition; fixture-only until contracts carry it. */
export type MpFeedPageDto = MpFeedPage & { deferredPrompt?: string | null };

/** D04 wallet rows. `title`/`releaseCondition` per hold and the top-up projection are PROPOSED server-composed additions (fixture-only; see followups). */
export type MpWalletHoldDto = MpWalletHold & { title?: string; releaseCondition?: string };
export type MpTopupRow = { label: string; state: 'pending' | 'cleared' | 'failed' };
export type MpWalletOverviewDto = Omit<MpWalletOverview, 'holds'> & { holds: MpWalletHoldDto[]; topupPresets?: string[]; topups?: MpTopupRow[] };

export type MpRateProfileSave = { cityId: string; service: MpService; vehicleClass: string; perKmMinor: number; minimumTripFareMinor: number };
export type MpRatePreviewBody = MpRateProfileSave & { exampleDistanceMeters: number };

/**
 * D05 + D11 jobs timeline. PROPOSED endpoint — the driver needs a server-composed
 * projection of award.confirmed / commission.captured / claim.promoted / queue.*
 * (MATRIX D05/D11); contracts/openapi/marketplace.yaml does not carry it yet.
 * Fixture-only until then. The winner card exists ONLY when the server has a
 * durable award.confirmed — the client never promotes a bid on its own.
 */
export type MpJobCardView = { claimId: string; slot: 'current' | 'next'; statusSuffix: string; title: string; fareMinor: Money; feeLine: string; feeReceiptId: string; detail: string; remainingLabel: string | null; tripId: string | null };
export type MpJobsView = {
  winnerToast: null | { title: string; fareMinor: Money; feeLine: string; receiptLine: string; addressesLine: string; tripId: string };
  current: MpJobCardView | null;
  next: MpJobCardView | null;
  promotion: null | 'pending' | 'failed_revalidating';
};

/**
 * "I am safely parked" attestation (D07 / RN-02). PROPOSED endpoint: the server
 * records the attestation and re-evaluates eligibility — the attestation alone
 * never makes the driver biddable (production telemetry wiring is RN-02 scope;
 * the server keeps rejecting bids with NOT_STATIONARY until its own signals agree).
 */
export type MpParkedAck = { state: 'parked_confirmed' | 'moving' | 'stale_location'; availabilityEpoch: number; confirmedAt: string };

export const marketplaceApi = {
  feed: (cursor?: string) => api<MpFeedPageDto>('GET', '/v1/mp/feed' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '')),
  driverView: (requestId: string) => api<MpDriverView>('GET', '/v1/mp/requests/' + requestId + '/driver-view'),
  submitBid: (body: MpSubmitBid) => api<MpBidDto>('POST', '/v1/mp/bids', body),
  reviseBid: (bidId: string, body: { amountMinor: Money; expectedVersion: number }) => api<MpBidDto>('POST', '/v1/mp/bids/' + bidId + '/revise', body),
  withdrawBid: (bidId: string) => api<MpBidDto>('POST', '/v1/mp/bids/' + bidId + '/withdraw'),
  myBids: () => api<{ bids: MpBidDto[] }>('GET', '/v1/mp/bids/mine'),
  rateProfiles: () => api<{ profiles: MpRateProfile[] }>('GET', '/v1/mp/rate-profiles'),
  // PUT carries an Idempotency-Key per the OpenAPI contract (api() adds it on POST only).
  saveRateProfile: (body: MpRateProfileSave) => api<MpRateProfile>('PUT', '/v1/mp/rate-profiles', body, { idempotent: true }),
  ratePreview: (body: MpRatePreviewBody) => api<MpRatePreview>('POST', '/v1/mp/rate-profiles/preview', body),
  walletOverview: () => api<MpWalletOverviewDto>('GET', '/v1/wallet/mp/overview'),
  // PROPOSED endpoints (see type docs above) — fixture-backed until the OpenAPI contract adds them.
  parked: () => api<MpParkedAck>('POST', '/v1/mp/driver/parked'),
  jobs: () => api<MpJobsView>('GET', '/v1/mp/driver/jobs'),
  // Top-up initiation returns the pending projection; it clears only on the wallet.topup.settled event (never an instant success).
  topup: (presetLabel: string) => api<{ topups: MpTopupRow[] }>('POST', '/v1/wallet/mp/topups', { presetLabel }),
};
