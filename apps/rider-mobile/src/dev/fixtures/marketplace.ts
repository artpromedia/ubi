// DEV ONLY marketplace fixtures (M08, boards R01–R11). ILLUSTRATIVE data, labeled as such:
// Lekki Phase 1 → Victoria Island, rider asks ₦2,800, drivers Emeka/Chidi/Tunde — none of the
// numbers here are policy (production markets fail closed until configured). The journey is
// stateful across successive GETs: offers arrive over time, one is withdrawn, awards resolve
// only via the award GET, and reversals go Pending → confirmed. No fabricated payment success.
import { ok, NGN, type FixtureInput } from './index';

const PICKUP = { label: 'Lekki Phase 1', lat: 6.4478, lng: 3.4723 };
const DROPOFF = { label: 'Victoria Island', lat: 6.4281, lng: 3.4216 };
const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
const qparam = (path: string, key: string) => { const m = path.match(new RegExp('[?&]' + key + '=([^&]+)')); return m ? decodeURIComponent(m[1]) : undefined; };

type MpFixState = {
  polls: number; lowPolls: number; awardPolls: number; queuePolls: number; queueCancelPolls: number;
  publishedAt: string; selected: 'bid_emeka' | 'bid_chidi' | null; cancelled: boolean; queueCancelled: boolean;
  returnTries: number; returnState: 'unreachable' | 'retrying' | 'return_approved' | 'held_at_point';
};
declare global { var __ubiMpFix: MpFixState | undefined; }
const fresh = (): MpFixState => ({ polls: 0, lowPolls: 0, awardPolls: 0, queuePolls: 0, queueCancelPolls: 0, publishedAt: new Date().toISOString(), selected: null, cancelled: false, queueCancelled: false, returnTries: 0, returnState: 'unreachable' });
const st = () => (globalThis.__ubiMpFix ??= fresh());

const quoteEnvelope = (service: string, vehicleClass: string) => ({
  quoteId: 'q_mp_1', service, vehicleClass, cityId: 'LOS', currency: 'NGN',
  suggestedFareMinor: NGN(2600), minimumFareMinor: NGN(2400), maximumFareMinor: NGN(3900),
  expiresAt: iso(120_000), pricingVersion: 'px_2026_09_1', policyVersion: 3,
  breakdown: [{ label: 'Base', amountMinor: NGN(700) }, { label: 'Distance · 8.4 km', amountMinor: NGN(1400) }, { label: 'Time · 22 min', amountMinor: NGN(500) }],
  routedDistanceMeters: 8400, routedDurationSec: 1320,
});

const driver = (displayName: string, initials: string, rating: string, completedTrips: number, vehicle: string, plateMasked: string) => ({ displayName, initials, rating, completedTrips, vehicle, plateMasked });
// bookingFeeMinor/totalMinor/deltaLabel: proposed MpOffer additions the R05 board needs (see src/api/marketplace.ts).
const offerEmeka = () => ({ bidId: 'bid_emeka', bidVersion: 1, requestRevision: 1, amountMinor: NGN(2800), kind: 'immediate', driver: driver('Emeka Okafor', 'EO', '4.9', 2413, 'Toyota Corolla · grey', 'LAG · 423 ··'), pickupLabel: 'Pickup in 4 min · 1.2 km away', pickupWindow: null, expiresAt: iso(90_000), withdrawn: false, whyRecommended: null, bookingFeeMinor: NGN(200), totalMinor: NGN(3000), deltaLabel: null });
const offerChidi = () => ({ bidId: 'bid_chidi', bidVersion: 1, requestRevision: 1, amountMinor: NGN(2800), kind: 'finishing_trip', driver: driver('Chidi Nwachukwu', 'CN', '4.8', 1876, 'Honda Accord · black', 'IKJ · 771 ··'), pickupLabel: 'Pickup window 12–18 min', pickupWindow: { earliestSec: 720, latestSec: 1080, etaVersion: 2 }, expiresAt: iso(110_000), withdrawn: false, whyRecommended: 'Finishing a trip 1.4 km from your pickup · 4.8★ over 1,876 trips · offers your price', bookingFeeMinor: NGN(200), totalMinor: NGN(3000), deltaLabel: null });
const offerTunde = (withdrawn: boolean) => ({ bidId: 'bid_tunde', bidVersion: 1, requestRevision: 1, amountMinor: NGN(3000), kind: 'immediate', driver: driver('Tunde Bakare', 'TB', '4.7', 934, 'Kia Rio · blue', 'EPE · 208 ··'), pickupLabel: 'Pickup in 3 min · 0.9 km away', pickupWindow: null, expiresAt: iso(75_000), withdrawn, whyRecommended: null, bookingFeeMinor: NGN(200), totalMinor: NGN(3200), deltaLabel: '+₦200 above your ask' });

const requestBody = (id: string, state: string, requested: { amountMinor: number; currency: string }, opts: { step?: number; closeReason?: string | null; version?: number } = {}) => ({
  requestId: id, state, revision: 1, version: opts.version ?? 1, service: 'ride', vehicleClass: 'standard', cityId: 'LOS', currency: 'NGN',
  requesterId: 'u_rider_1', quoteId: 'q_mp_1', requestedFareMinor: requested, suggestedFareMinor: NGN(2600), minimumFareMinor: NGN(2400), maximumFareMinor: NGN(3900),
  pickup: PICKUP, dropoff: DROPOFF, delivery: null, searchEnvelope: { step: opts.step ?? 0, radiusMeters: (opts.step ?? 0) > 0 ? 5000 : 3000, pickupEtaSec: 600 },
  policyVersion: 3, pricingVersion: 'px_2026_09_1', expiresAt: iso(150_000), createdAt: st().publishedAt, closeReason: opts.closeReason ?? null,
});

const award = (state: 'pending' | 'confirmed' | 'cancelled', slot: 'current' | 'next', bidId: string) => ({
  awardId: 'awd_mp_1', requestId: 'req_mp_1', bidId, state, requestVersion: 1, bidVersion: 1, driverId: bidId === 'bid_chidi' ? 'u_drv_chidi' : 'u_drv_emeka', requesterId: 'u_rider_1',
  fareMinor: NGN(2800), commissionMinor: NGN(280), slot, // 10% of ₦2,800, computed server-side (commissionMinorFor)
  executionRef: state === 'confirmed' ? { service: 'ride', id: 'ride_mp_901' } : null,
  createdAt: st().publishedAt, resolvedAt: state === 'pending' ? null : new Date().toISOString(),
});

const custody = (state: MpFixState['returnState']) => [
  { label: 'Picked up from you', detail: 'Photo + code verified 14:02', state: 'done' },
  { label: 'Delivery attempted · recipient unreachable', detail: '2 attempts · 14:31 and 14:40', state: 'done' },
  state === 'return_approved'
    ? { label: 'Returning to sender', detail: 'Return fee funded · courier heading back', state: 'active' }
    : state === 'held_at_point'
      ? { label: 'Held at partner pickup point', detail: 'Ajose Adeogun collection point', state: 'active' }
      : { label: 'Waiting on your decision', detail: 'Courier holds the package meanwhile', state: 'active' },
  { label: state === 'held_at_point' ? 'Collected' : 'Returned to you', state: 'pending' },
];
const returnView = () => ({ state: st().returnState, situation: '2 delivery attempts made — the recipient isn’t answering (11 min). The courier is waiting at Adeola Odeku St with your package.', returnFeeMinor: NGN(900), custody: custody(st().returnState) });

export async function marketplaceFixtures(i: FixtureInput) {
  const s = st();
  if (i.method === 'GET' && i.path.startsWith('/v1/mp/quote')) {
    return ok(quoteEnvelope(qparam(i.path, 'service') ?? 'ride', qparam(i.path, 'vehicleClass') ?? 'standard'));
  }
  if (i.method === 'POST' && i.path === '/v1/mp/requests') {
    const asked = (i.body as { requestedFareMinor?: { amountMinor: number; currency: string } })?.requestedFareMinor ?? NGN(2800);
    if (asked.amountMinor < 2400_00) return { status: 422, json: { code: 'fare_out_of_bounds', message: 'Below the minimum for this route. Enter at least ₦2,400.', details: { field: 'requestedFareMinor', minimumFareMinor: NGN(2400) } } };
    globalThis.__ubiMpFix = fresh();
    // Publishing at exactly the floor demonstrates the R07a no-offers branch.
    if (asked.amountMinor === 2400_00) return { status: 201, json: requestBody('req_mp_low', 'open', asked) };
    return { status: 201, json: requestBody('req_mp_1', 'open', asked) };
  }
  if (i.method === 'GET' && /^\/v1\/mp\/requests\/req_mp_low$/.test(i.path)) {
    s.lowPolls += 1;
    if (s.lowPolls >= 3) return ok({ request: requestBody('req_mp_low', 'no_offers', NGN(2400), { closeReason: 'no_offers' }), offers: [], seq: s.lowPolls });
    return ok({ request: requestBody('req_mp_low', 'open', NGN(2400)), offers: [], seq: s.lowPolls });
  }
  if (i.method === 'GET' && /^\/v1\/mp\/requests\/req_mp_1$/.test(i.path)) {
    s.polls += 1;
    const offers = s.polls <= 1 ? [] : s.polls === 2 ? [offerEmeka()] : [offerEmeka(), offerChidi(), offerTunde(s.polls >= 4)];
    const state = s.cancelled ? 'cancelled' : s.selected ? (s.awardPolls >= 2 ? 'awarded' : 'award_pending') : 'open';
    const aw = s.selected ? award(s.awardPolls >= 2 ? 'confirmed' : 'pending', s.selected === 'bid_chidi' ? 'next' : 'current', s.selected) : undefined;
    // Step 1 envelope widening (R09) once the finishing-trip offer is in play; existing bids kept.
    return ok({ request: requestBody('req_mp_1', state, NGN(2800), { step: s.polls >= 3 ? 1 : 0, closeReason: s.cancelled ? 'cancelled' : null }), offers, ...(aw ? { award: aw } : {}), seq: s.polls });
  }
  if (i.method === 'POST' && /^\/v1\/mp\/requests\/req_mp_1\/select$/.test(i.path)) {
    const bidId = (i.body as { bidId?: string })?.bidId;
    if (bidId === 'bid_tunde') return { status: 409, json: { code: 'version_conflict', message: 'Tunde withdrew this offer while you were deciding. Offers below are refreshed — nothing was charged. Pick again.' } };
    s.selected = bidId === 'bid_chidi' ? 'bid_chidi' : 'bid_emeka';
    s.awardPolls = 0;
    return { status: 202, json: award('pending', s.selected === 'bid_chidi' ? 'next' : 'current', s.selected) };
  }
  if (i.method === 'GET' && /^\/v1\/mp\/requests\/req_mp_1\/award$/.test(i.path)) {
    if (!s.selected) return { status: 409, json: { code: 'award_unresolved', message: 'No selection has been made on this request.' } };
    s.awardPolls += 1;
    return ok(award(s.awardPolls >= 2 ? 'confirmed' : 'pending', s.selected === 'bid_chidi' ? 'next' : 'current', s.selected));
  }
  if (i.method === 'POST' && /^\/v1\/mp\/requests\/req_mp_(1|low)\/cancel$/.test(i.path)) {
    if (s.selected) { s.queueCancelled = true; s.queueCancelPolls = 0; }
    s.cancelled = true;
    return ok(requestBody(i.path.includes('req_mp_low') ? 'req_mp_low' : 'req_mp_1', 'cancelled', NGN(2800), { closeReason: 'cancelled' }));
  }
  if (i.method === 'POST' && /^\/v1\/mp\/requests\/req_mp_1\/revise$/.test(i.path)) {
    const b = i.body as { requestedFareMinor: { amountMinor: number; currency: string } };
    return ok(requestBody('req_mp_1', 'open', b.requestedFareMinor, { version: 2 }));
  }
  // PROPOSED endpoint (R10) — queue projection; see src/api/marketplace.ts.
  if (i.method === 'GET' && /^\/v1\/mp\/requests\/req_mp_1\/queue$/.test(i.path)) {
    s.queuePolls += 1;
    const base = { driverFirstName: 'Chidi', fareMinor: NGN(2800), windowLabel: '12–18 min' };
    if (s.queueCancelled) {
      s.queueCancelPolls += 1;
      const settled = s.queueCancelPolls >= 2;
      return ok({ ...base, steps: [], eta: { label: 'Cancelled', inWindow: false }, delayed: { noticeTitle: 'Cancelled — free of charge', noticeBody: 'The new estimate was outside the window you accepted, so this cancellation costs nothing. Money movements below settle as the events confirm.', keepLabel: 'Search again instead', reversal: { riderHold: settled ? 'released' : 'releasing', driverFee: settled ? 'reversed' : 'pending' } } });
    }
    if (s.queuePolls >= 3) {
      return ok({ ...base, steps: [{ label: 'You chose Chidi', detail: 'Fare fixed at ₦2,800', state: 'done' }, { label: 'Finishing their current trip', detail: 'Now estimated 24 min', state: 'active' }, { label: 'Heading to you', state: 'pending' }], eta: { label: 'About 24 min', inWindow: false }, delayed: { noticeTitle: 'Now estimated 24 min', noticeBody: 'You accepted a pickup window of up to 18 min. You can keep waiting, or cancel free and search again — your money is only moved when a trip happens.', keepLabel: 'Keep waiting · new ETA 24 min', reversal: null } });
    }
    return ok({ ...base, steps: [{ label: 'You chose Chidi', detail: 'Fare fixed at ₦2,800', state: 'done' }, { label: 'Finishing their current trip', detail: 'About 9 min remaining', state: 'active' }, { label: 'Heading to you', state: 'pending' }], eta: { label: 'About 14 min', inWindow: true }, delayed: null });
  }
  // PROPOSED endpoint pair (R11b) — recipient-unreachable resolution; see src/api/marketplace.ts.
  if (i.method === 'GET' && /^\/v1\/mp\/delivery\/[^/]+\/return-state$/.test(i.path)) return ok(returnView());
  if (i.method === 'POST' && /^\/v1\/mp\/delivery\/[^/]+\/return-consent$/.test(i.path)) {
    const action = (i.body as { action?: string })?.action;
    if (action === 'retry_recipient') { s.returnState = 'retrying'; return ok(returnView()); }
    if (action === 'hold_at_point') { s.returnState = 'held_at_point'; return ok(returnView()); }
    s.returnTries += 1;
    if (s.returnTries === 1) return { status: 422, json: { code: 'insufficient_spendable', message: 'Wallet balance too low for the ₦900 return fee. Top up, then approve again.' } };
    s.returnState = 'return_approved';
    return ok(returnView());
  }
  return undefined;
}
