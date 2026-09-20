// Requester-side negotiated-fare marketplace (M08, boards R01–R11).
// Paths follow contracts/openapi/marketplace.yaml; DTO shapes come straight from
// @ubi/contracts/src/marketplace.ts. Money is server minor units, never computed here.
import { api, type Money } from '@ubi/mobile-core';
import type { MpAward, MpOffer, MpPublishRequest, MpQuoteEnvelope, MpRequest, MpSelectBid, MpService } from '@ubi/contracts';

export type { MpAward, MpOffer, MpQuoteEnvelope, MpRequest };

/**
 * POST /select 202 body per contracts/openapi/marketplace.yaml: the award is WRAPPED
 * ({ award, pickupPin? }), never the bare award. `pickupPin` is present ONLY when this
 * very call confirmed a current-slot ride award — it is revealed exactly once to the
 * owner and deliberately absent from idempotent replays and from every award GET, so
 * the caller must hold it the moment it arrives or it is gone for good.
 */
export type MpSelectResponse = { award: MpAward; pickupPin?: string };

export type MpQuoteQuery = { service: MpService; vehicleClass: string; pickupLat: number; pickupLng: number; dropoffLat: number; dropoffLng: number; weightKg?: number };

/**
 * Rider offer view. `bookingFeeMinor`, `totalMinor` and `deltaLabel` are PROPOSED
 * contract additions the R05 board requires (total-you-pay and the "+₦200" delta are
 * server-computed/phrased — clients never do money arithmetic). Until
 * packages/contracts MpOfferSchema + contracts/openapi/marketplace.yaml carry them,
 * only fixtures serve them; see followups.
 */
export type MpOfferDto = MpOffer & { bookingFeeMinor?: Money; totalMinor?: Money; deltaLabel?: string | null };

/** GET /v1/mp/requests/:id owner snapshot (request + private offers + award when selection ran). */
export type MpRequestSnapshot = { request: MpRequest; offers: MpOfferDto[]; award?: MpAward; seq: number };

/**
 * R10 queued-job tracker view. PROPOSED endpoint — the rider needs a server-composed
 * projection of queue.eta_updated / award.cancelled / commission.reversed (MATRIX R10);
 * contracts/openapi/marketplace.yaml does not carry it yet. Fixture-only until then.
 */
export type MpQueueView = {
  driverFirstName: string;
  steps: { label: string; detail?: string; state: 'done' | 'active' | 'pending' | 'skipped' }[];
  fareMinor: Money; windowLabel: string;
  eta: { label: string; inWindow: boolean };
  delayed: { noticeTitle: string; noticeBody: string; keepLabel: string; reversal: { riderHold: 'releasing' | 'released'; driverFee: 'pending' | 'reversed' } | null } | null;
};

/** R11b recipient-unreachable resolution view. PROPOSED endpoint pair (MATRIX R11). */
export type MpDeliveryReturnState = {
  state: 'unreachable' | 'retrying' | 'return_approved' | 'held_at_point';
  situation: string;
  returnFeeMinor: Money;
  custody: { label: string; detail?: string; state: 'done' | 'active' | 'pending' | 'skipped' }[];
};
export type MpDeliveryReturnAction = 'approve_return' | 'retry_recipient' | 'hold_at_point';

// RN's URLSearchParams is only partially implemented; build the query by hand.
const quoteQs = (p: MpQuoteQuery) => {
  const pairs: [string, string][] = [['service', p.service], ['vehicleClass', p.vehicleClass], ['pickupLat', String(p.pickupLat)], ['pickupLng', String(p.pickupLng)], ['dropoffLat', String(p.dropoffLat)], ['dropoffLng', String(p.dropoffLng)]];
  if (p.weightKg !== undefined) pairs.push(['weightKg', String(p.weightKg)]);
  return pairs.map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
};

export const marketplaceApi = {
  quote: (p: MpQuoteQuery) => api<MpQuoteEnvelope>('GET', '/v1/mp/quote?' + quoteQs(p)),
  publish: (body: MpPublishRequest) => api<MpRequest>('POST', '/v1/mp/requests', body),
  request: (requestId: string) => api<MpRequestSnapshot>('GET', '/v1/mp/requests/' + requestId),
  revise: (requestId: string, body: { requestedFareMinor: Money; quoteId?: string; expectedVersion: number }) => api<MpRequest>('POST', '/v1/mp/requests/' + requestId + '/revise', body),
  cancel: (requestId: string) => api<MpRequest>('POST', '/v1/mp/requests/' + requestId + '/cancel'),
  select: (requestId: string, body: MpSelectBid) => api<MpSelectResponse>('POST', '/v1/mp/requests/' + requestId + '/select', body),
  award: (requestId: string) => api<MpAward>('GET', '/v1/mp/requests/' + requestId + '/award'),
  // PROPOSED endpoints (see type docs above) — fixture-backed until the OpenAPI contract adds them.
  queue: (requestId: string) => api<MpQueueView>('GET', '/v1/mp/requests/' + requestId + '/queue'),
  deliveryReturnState: (deliveryId: string) => api<MpDeliveryReturnState>('GET', '/v1/mp/delivery/' + deliveryId + '/return-state'),
  deliveryReturnConsent: (deliveryId: string, action: MpDeliveryReturnAction) => api<MpDeliveryReturnState>('POST', '/v1/mp/delivery/' + deliveryId + '/return-consent', { action }),
};
