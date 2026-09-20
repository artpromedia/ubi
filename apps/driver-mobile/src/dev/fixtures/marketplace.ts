// DEV ONLY driver marketplace fixtures (M08, boards D01–D12). ILLUSTRATIVE data, labeled as
// such — none of these numbers are policy (production markets fail closed until configured,
// A03/A07). The fixtures PLAY THE SERVER, which is why the 10% half-up commission arithmetic
// lives here and never in a screen or container. Worked example (D04): cleared ₦1,000, holds
// ₦280 + ₦220 = ₦500 held, ₦500 spendable. The journey is stateful across successive calls:
// a lost bid's hold goes release_pending → released only over time (no instant success), a
// top-up clears only after polls (standing in for wallet.topup.settled), and the motion gate
// reads the dev motion signal so NOT_STATIONARY / LOCATION_STALE come back as SERVER
// eligibility reasons — the app never decides eligibility on its own.
import { currentMotion } from '../../lib/motion';

// Local copies of the index helpers (importing them from './index' would create an
// import cycle with the installer).
type FixtureInput = { method: string; path: string; body?: unknown };
const ok = (json: unknown) => ({ status: 200, json });
const NGN = (major: number) => ({ amountMinor: Math.round(major * 100), currency: 'NGN' });

const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
// The server's one commission rule: 10% of gross, half-up to the minor unit
// (packages/contracts commissionMinorFor — mirrored here because fixtures play the server).
const feeMinor = (grossMinor: number) => Math.floor((grossMinor * 1_000 + 5_000) / 10_000);
const money = (amountMinor: number) => ({ amountMinor, currency: 'NGN' });
const naira = (amountMinor: number) => '₦' + Math.round(amountMinor / 100).toLocaleString('en-NG');

type MpDriverFixState = {
  bidsPolls: number; jobsPolls: number; topupClearPolls: number | null;
  clearedMinor: number;
  myBid: null | { bidId: string; amountMinor: number; version: number; placedPolls: number; state: 'live' | 'withdrawn' };
  topups: { label: string; amountMinor: number; state: 'pending' | 'cleared' | 'failed' }[];
};
// eslint-disable-next-line no-var -- `declare global { var … }` is the only way to type a globalThis slot
declare global { var __ubiMpDriverFix: MpDriverFixState | undefined; }
const fresh = (): MpDriverFixState => ({ bidsPolls: 0, jobsPolls: 0, topupClearPolls: null, clearedMinor: 1000_00, myBid: null, topups: [] });
const st = () => (globalThis.__ubiMpDriverFix ??= fresh());

// ── Feed (D01): privacy-limited titles; exact addresses only after award ──────────────
const feedItems = () => [
  { requestId: 'req_mp_201', revision: 1, service: 'ride', title: 'Lekki Phase 1 → Victoria Island', meta: 'Ride · Economy · 8.4 km · ~22 min · pickup 1.2 km from you', askedMinor: NGN(2800), askedByLabel: 'rider asks', capabilityBadge: null, expiresAt: iso(150_000) },
  { requestId: 'req_mp_202', revision: 1, service: 'delivery', title: 'Ikoyi → Yaba', meta: 'Delivery · Box · 6.1 km · ~19 min · pickup 0.8 km from you', askedMinor: NGN(1800), askedByLabel: 'sender asks', capabilityBadge: 'Box · up to 5 kg', expiresAt: iso(120_000) },
  { requestId: 'req_mp_210', revision: 2, service: 'ride', title: 'Ajah → Epe', meta: 'Ride · Economy · 24.8 km · ~41 min · pickup 9.4 km from you', askedMinor: NGN(6500), askedByLabel: 'rider asks', capabilityBadge: null, expiresAt: iso(90_000) },
];

// ── Wallet worked example (D04): total 1000_00 / held 500_00 / spendable 500_00 ───────
const HOLD_A = 280_00; // awaiting bid on Surulere → Ikeja (₦2,800)
const HOLD_B = 220_00; // lost bid on Ikeja → Maryland (₦2,200), release pending → released
const bLost = () => st().bidsPolls >= 3; // hold B financially released after a few polls
const activeHolds = () => {
  const s = st();
  const holds = [
    { reservationId: 'rsv_a', bidId: 'bid_a', title: 'Surulere → Ikeja · your offer ' + naira(2800_00), amountMinor: money(HOLD_A), releaseCondition: 'Releases if the requester picks another driver or the request closes', state: 'active' },
    ...(bLost() ? [] : [{ reservationId: 'rsv_b', bidId: 'bid_b', title: 'Ikeja → Maryland · offer lost', amountMinor: money(HOLD_B), releaseCondition: 'Release pending · confirms when the requester’s choice is final', state: 'active' as const }]),
    ...(s.myBid && myBidPhase(s) === 'live' ? [{ reservationId: 'rsv_new', bidId: s.myBid.bidId, title: 'Lekki Phase 1 → Victoria Island · your offer ' + naira(s.myBid.amountMinor), amountMinor: money(feeMinor(s.myBid.amountMinor)), releaseCondition: 'Releases if the requester picks another driver or the request closes', state: 'active' as const }] : []),
  ];
  return holds.map((h) => ({ ...h, driverId: 'u_drv_chinedu', commissionBps: 1000, baseMinor: money(h.amountMinor.amountMinor * 10), roundingRule: 'half_up', policyVersion: 3, createdAt: iso(-300_000), releasedAt: null, capturedAt: null }));
};
const heldMinor = () => activeHolds().reduce((sum, h) => sum + h.amountMinor.amountMinor, 0);
const spendableMinor = () => st().clearedMinor - heldMinor();

// ── Presets (D02): server-generated, deduplicated, in-bounds, affordability-checked ───
const preset = (key: string, source: string, gross: number, title: string, emphasized: boolean) => {
  const fee = feeMinor(gross);
  const net = gross - fee;
  const spend = spendableMinor();
  const affordable = fee <= spend;
  return {
    key, source, amountMinor: money(gross), commissionMinor: money(fee), netMinor: money(net),
    title, feeNetLabel: 'fee ' + naira(fee) + ' · you keep ' + naira(net),
    affordable,
    shortfallMinor: affordable ? null : money(fee - spend),
    // EXACT server phrasing for the shortfall — clients render it verbatim (task E).
    shortfallLabel: affordable ? null : 'Needs ' + naira(fee) + ' spendable — you have ' + naira(spend) + '. Top up ' + naira(fee - spend) + ' to place this offer.',
    emphasized,
  };
};
const presets201 = () => [
  preset('p_req', 'requested', 2800_00, 'Offer ₦2,800 · rider’s price', true),
  preset('p_low', 'lower', 2600_00, 'Offer ₦2,600 · undercut slightly', false),
  preset('p_rate', 'rate_profile', 2520_00, 'Offer ₦2,520 · your rate profile', false),
  // Deliberately unaffordable against the ₦500 spendable worked example: fee ₦560.
  preset('p_high', 'higher', 5600_00, 'Offer ₦5,600 · high-demand ask', false),
];

const eligibility = (over: { eligible?: boolean; reasons?: { code: string; title: string; detail: string }[]; slot?: 'current' | 'next' | null } = {}) => ({
  eligible: over.eligible ?? true,
  slot: over.slot === undefined ? 'current' : over.slot,
  reasons: over.reasons ?? [],
  policyVersion: 3,
  availabilityEpoch: 7,
  evaluatedAt: new Date().toISOString(),
});

// The dev motion signal flows through the FIXTURE SERVER, so "you're moving" comes back as
// a server eligibility reason exactly like production (the app never self-evaluates).
const motionReasons = () => {
  const m = currentMotion();
  if (m === 'moving') return [{ code: 'NOT_STATIONARY', title: 'You’re moving', detail: 'Park safely, then confirm — the request stays in your feed and nothing counts against you.' }];
  if (m === 'stale_location') return [{ code: 'LOCATION_STALE', title: 'Location signal stale', detail: 'We can’t estimate your pickup time. Bidding resumes when GPS recovers or you confirm you’re parked.' }];
  return [];
};

// D10: the six blocked-reason codes, each with a next step.
const blockedReasons = [
  { code: 'OUTSIDE_RADIUS', title: 'Too far from the pickup', detail: 'This request is outside your 5 km search envelope. Head toward Ajah to see it become biddable.' },
  { code: 'PICKUP_ETA_TOO_LONG', title: 'Pickup would take too long', detail: 'Your estimated arrival is over the request’s 15 min pickup limit. Closer requests appear in your feed.' },
  { code: 'LOCATION_STALE', title: 'Location signal stale', detail: 'We can’t estimate your pickup time. Bidding resumes when GPS recovers or you confirm you’re parked.' },
  { code: 'NOT_STATIONARY', title: 'You’re moving', detail: 'Park safely, then confirm — the request stays in your feed and nothing counts against you.' },
  { code: 'SLOT_FULL', title: 'Both job slots are taken', detail: 'You have a current trip and a queued next job. Bidding reopens when one completes.' },
  { code: 'INSUFFICIENT_SPENDABLE', title: 'Not enough spendable balance', detail: 'Every offer reserves its 10% fee first. Top up in Wallet, then come back — this request stays open.' },
];

// The placed bid walks the full D06 lifecycle over successive "My offers" polls:
// awaiting → lost with release pending → released (the winner journey lives in D05/D11).
const myBidPhase = (s: MpDriverFixState): 'live' | 'lost_release_pending' | 'lost_released' | 'withdrawn' => {
  if (!s.myBid) return 'withdrawn';
  if (s.myBid.state === 'withdrawn') return 'withdrawn';
  const age = s.bidsPolls - s.myBid.placedPolls;
  if (age >= 8) return 'lost_released';
  if (age >= 5) return 'lost_release_pending';
  return 'live';
};
const bidBody = (s: MpDriverFixState) => {
  const b = s.myBid!;
  const fee = feeMinor(b.amountMinor);
  const phase = myBidPhase(s);
  return {
    bidId: b.bidId, requestId: 'req_mp_201', requestRevision: 1, bidVersion: b.version,
    state: phase === 'withdrawn' ? 'withdrawn' : phase === 'live' ? (b.version > 1 ? 'revised' : 'submitted') : 'lost',
    driverId: 'u_drv_chinedu', amountMinor: money(b.amountMinor), commissionMinor: money(fee), netMinor: money(b.amountMinor - fee),
    slot: 'current', dependsOnClaimId: null, reservationId: 'rsv_new', expiresAt: iso(125_000), createdAt: iso(-10_000),
    title: 'Lekki Phase 1 → Victoria Island',
    holdState: phase === 'live' ? 'held' : phase === 'lost_released' ? 'released' : 'release_pending',
    holdDetail: phase === 'live' ? 'closes 2:05' : phase === 'lost_released' ? 'confirmed just now' : 'your money returns once the choice is final',
  };
};

// ── D06 bid lifecycle: awaiting → lost with release pending → released ────────────────
const myBidsList = () => {
  const s = st();
  const rows = [
    { bidId: 'bid_a', requestId: 'req_mp_190', requestRevision: 1, bidVersion: 1, state: 'submitted', driverId: 'u_drv_chinedu', amountMinor: money(2800_00), commissionMinor: money(HOLD_A), netMinor: money(2800_00 - HOLD_A), slot: 'current', dependsOnClaimId: null, reservationId: 'rsv_a', expiresAt: iso(125_000), createdAt: iso(-240_000), title: 'Surulere → Ikeja', holdState: 'held', holdDetail: 'closes 2:05' },
    { bidId: 'bid_b', requestId: 'req_mp_185', requestRevision: 1, bidVersion: 2, state: 'lost', driverId: 'u_drv_chinedu', amountMinor: money(2200_00), commissionMinor: money(HOLD_B), netMinor: money(2200_00 - HOLD_B), slot: 'current', dependsOnClaimId: null, reservationId: 'rsv_b', expiresAt: iso(-60_000), createdAt: iso(-900_000), title: 'Ikeja → Maryland', holdState: bLost() ? 'released' : 'release_pending', holdDetail: bLost() ? 'confirmed 9:40' : 'your money returns once the choice is final' },
    { bidId: 'bid_c', requestId: 'req_mp_170', requestRevision: 1, bidVersion: 1, state: 'expired', driverId: 'u_drv_chinedu', amountMinor: money(3000_00), commissionMinor: money(300_00), netMinor: money(2700_00), slot: 'current', dependsOnClaimId: null, reservationId: 'rsv_c', expiresAt: iso(-3_600_000), createdAt: iso(-4_000_000), title: 'Yaba → Ebute Metta', holdState: 'released', holdDetail: 'confirmed 8:12' },
  ];
  if (s.myBid && myBidPhase(s) !== 'withdrawn') rows.unshift(bidBody(s));
  return rows;
};

// ── Rate profile (D09): 10 km at ₦300/km → ₦3,000 gross / ₦300 fee / ₦2,700 net ──────
const RATE_BOUNDS = { perKmMin: 150_00, perKmMax: 500_00, minFareMin: 400_00, minFareMax: 2000_00 };
let profileVersion = 3;
const rateProfile = () => ({
  profileId: 'rp_1', driverId: 'u_drv_chinedu', version: profileVersion, cityId: 'LOS', service: 'ride', vehicleClass: 'economy', currency: 'NGN',
  perKmMinor: 300_00, minimumTripFareMinor: 700_00,
  components: { perMinuteMinor: null, pickupPerKmMinor: null, handlingMinor: null },
  createdAt: iso(-86_400_000),
  scopeLabel: 'Lagos · Economy · sedan', componentsLine: 'Off · not configured',
  versionLine: 'Changes apply to future calculations only — live offers and won jobs keep their agreed amounts. Currently saved as v' + profileVersion + '.',
});
const ratePreview = (perKmMinor: number, minimumTripFareMinor: number) => {
  const grossRaw = perKmMinor * 10; // example 10 km trip
  const floorAdjusted = grossRaw < minimumTripFareMinor;
  const gross = floorAdjusted ? minimumTripFareMinor : grossRaw;
  const fee = feeMinor(gross);
  const net = gross - fee;
  const exceedsCeiling = perKmMinor > RATE_BOUNDS.perKmMax;
  return {
    profileFormulaVersion: 2,
    grossMinor: money(gross), commissionMinor: money(fee), netMinor: money(net),
    floorAdjusted, exceedsCeiling,
    rows: [
      { label: 'Gross · 10 km × ' + naira(perKmMinor) + '/km' + (floorAdjusted ? ' · floor applied' : ''), value: naira(gross), tone: exceedsCeiling ? 'errorInk' : undefined },
      { label: 'UBI fee 10%', value: '−' + naira(fee), tone: 'errorInk' },
      { label: 'You keep', value: naira(net), tone: 'ok' },
    ],
    disclaimer: exceedsCeiling
      ? 'Above the ' + naira(RATE_BOUNDS.perKmMax) + '/km ceiling for Lagos Economy — requests will clip your calculated offer to their limit. Before fuel and operating costs.'
      : 'Before fuel and operating costs. Real bids use each request’s routed distance.',
  };
};

export async function marketplaceFixtures(i: FixtureInput) {
  const s = st();
  // ── Feed (D01/D07) ──
  if (i.method === 'GET' && i.path.startsWith('/v1/mp/feed')) {
    return ok({ items: feedItems(), nextCursor: null, availabilityEpoch: 7, deferredPrompt: currentMotion() === 'moving' ? '1 request near your drop-off' : null });
  }
  // ── Driver view (D02/D03/D10) ──
  if (i.method === 'GET' && /^\/v1\/mp\/requests\/req_mp_210\/driver-view$/.test(i.path)) {
    const item = feedItems()[2];
    return ok({ item, eligibility: eligibility({ eligible: false, reasons: blockedReasons, slot: null }), presets: [], profileLine: null, ceilingNotice: null, myBid: null, currentClaimId: null });
  }
  if (i.method === 'GET' && /^\/v1\/mp\/requests\/(req_mp_201|req_mp_202)\/driver-view$/.test(i.path)) {
    const isRide = i.path.includes('req_mp_201');
    const item = feedItems()[isRide ? 0 : 1];
    const reasons = motionReasons();
    if (reasons.length) return ok({ item, eligibility: eligibility({ eligible: false, reasons, slot: null }), presets: [], profileLine: null, ceilingNotice: null, myBid: null, currentClaimId: null });
    if (!isRide) {
      return ok({
        item, eligibility: eligibility(), presets: [preset('d_req', 'requested', 1800_00, 'Offer ₦1,800 · sender’s price', true), preset('d_low', 'lower', 1600_00, 'Offer ₦1,600 · undercut slightly', false)],
        profileLine: null, ceilingNotice: null, myBid: null, currentClaimId: null,
      });
    }
    return ok({
      item, eligibility: eligibility(), presets: presets201(),
      profileLine: '₦300/km → calculates ₦2,520 on this route',
      ceilingNotice: null,
      myBid: s.myBid && myBidPhase(s) === 'live' ? bidBody(s) : null,
    });
  }
  if (i.method === 'GET' && /^\/v1\/mp\/requests\/[^/]+\/driver-view$/.test(i.path)) {
    return { status: 409, json: { code: 'request_closed', message: 'This request has closed. Your feed refreshes automatically.' } };
  }
  // ── Bids (D02 → D03) ──
  if (i.method === 'POST' && i.path === '/v1/mp/bids') {
    const body = i.body as { amountMinor?: { amountMinor: number } };
    const gross = body?.amountMinor?.amountMinor ?? 2800_00;
    const fee = feeMinor(gross);
    const spend = spendableMinor();
    if (fee > spend) {
      return { status: 422, json: { code: 'insufficient_spendable', message: 'Needs ' + naira(fee) + ' spendable — you have ' + naira(spend) + '. Top up ' + naira(fee - spend) + ' to place this offer.', details: { shortfallMinor: money(fee - spend) } } };
    }
    s.myBid = { bidId: 'bid_new', amountMinor: gross, version: 1, placedPolls: s.bidsPolls, state: 'live' };
    return { status: 201, json: bidBody(s) };
  }
  if (i.method === 'POST' && /^\/v1\/mp\/bids\/bid_new\/revise$/.test(i.path)) {
    if (!s.myBid || myBidPhase(s) !== 'live') return { status: 409, json: { code: 'bid_not_live', message: 'This offer is no longer live. The request view has been refreshed.' } };
    const body = i.body as { amountMinor?: { amountMinor: number } };
    const gross = body?.amountMinor?.amountMinor ?? s.myBid.amountMinor;
    const newFee = feeMinor(gross);
    const oldFee = feeMinor(s.myBid.amountMinor);
    const delta = newFee - oldFee;
    // Raising re-reserves the DIFFERENCE first (server-side), before the bid version moves.
    if (delta > 0 && delta > spendableMinor()) {
      return { status: 422, json: { code: 'insufficient_spendable', message: 'Raising to ' + naira(gross) + ' needs ' + naira(delta) + ' more spendable — you have ' + naira(spendableMinor()) + '. Top up ' + naira(delta - spendableMinor()) + ' to raise this offer.', details: { shortfallMinor: money(delta - spendableMinor()) } } };
    }
    s.myBid = { ...s.myBid, amountMinor: gross, version: s.myBid.version + 1 };
    return ok(bidBody(s));
  }
  if (i.method === 'POST' && /^\/v1\/mp\/bids\/bid_new\/withdraw$/.test(i.path)) {
    if (!s.myBid || myBidPhase(s) !== 'live') return { status: 409, json: { code: 'bid_not_live', message: 'This offer is no longer live.' } };
    s.myBid = { ...s.myBid, state: 'withdrawn' };
    return ok({ ...bidBody(s), state: 'withdrawn', holdState: 'release_pending', holdDetail: 'your money returns shortly' });
  }
  if (i.method === 'GET' && i.path === '/v1/mp/bids/mine') {
    s.bidsPolls += 1;
    return ok({ bids: myBidsList() });
  }
  // ── Rate profiles (D09) ──
  if (i.method === 'GET' && i.path === '/v1/mp/rate-profiles') return ok({ profiles: [rateProfile()] });
  if (i.method === 'PUT' && i.path === '/v1/mp/rate-profiles') {
    const b = i.body as { perKmMinor: number; minimumTripFareMinor: number };
    if (b.perKmMinor < RATE_BOUNDS.perKmMin || b.perKmMinor > RATE_BOUNDS.perKmMax) {
      return { status: 422, json: { code: 'rate_profile_out_of_bounds', message: 'Per-km rate must be between ' + naira(RATE_BOUNDS.perKmMin) + ' and ' + naira(RATE_BOUNDS.perKmMax) + ' for Lagos · Economy. Your current v' + profileVersion + ' stays active.' } };
    }
    if (b.minimumTripFareMinor < RATE_BOUNDS.minFareMin || b.minimumTripFareMinor > RATE_BOUNDS.minFareMax) {
      return { status: 422, json: { code: 'rate_profile_out_of_bounds', message: 'Minimum trip fare must be between ' + naira(RATE_BOUNDS.minFareMin) + ' and ' + naira(RATE_BOUNDS.minFareMax) + ' for Lagos · Economy. Your current v' + profileVersion + ' stays active.' } };
    }
    profileVersion += 1;
    return ok({ ...rateProfile(), perKmMinor: b.perKmMinor, minimumTripFareMinor: b.minimumTripFareMinor });
  }
  if (i.method === 'POST' && i.path === '/v1/mp/rate-profiles/preview') {
    const b = i.body as { perKmMinor: number; minimumTripFareMinor: number };
    return ok(ratePreview(b.perKmMinor, b.minimumTripFareMinor));
  }
  // ── Wallet (D04) ── (`?cityId=` names the market, per the contract)
  if (i.method === 'GET' && (i.path === '/v1/wallet/mp/overview' || i.path.startsWith('/v1/wallet/mp/overview?'))) {
    // Pending top-ups clear only after polls — standing in for wallet.topup.settled.
    if (s.topupClearPolls !== null) {
      s.topupClearPolls += 1;
      if (s.topupClearPolls >= 3) {
        for (const tp of s.topups) if (tp.state === 'pending') { tp.state = 'cleared'; s.clearedMinor += tp.amountMinor; }
        s.topupClearPolls = null;
      }
    }
    return ok({
      clearedMinor: money(s.clearedMinor), heldMinor: money(heldMinor()), spendableMinor: money(spendableMinor()),
      holds: activeHolds(),
      topupPresets: ['₦500', '₦1,000', '₦2,000'],
      topups: s.topups.map(({ label, state }) => ({ label: 'Top-up · ' + label, state })),
    });
  }
  if (i.method === 'POST' && i.path === '/v1/wallet/mp/topups') {
    const label = (i.body as { presetLabel?: string })?.presetLabel ?? '₦500';
    const amountMinor = (parseInt(label.replace(/\D/g, ''), 10) || 500) * 100;
    s.topups.push({ label, amountMinor, state: 'pending' });
    s.topupClearPolls = 0;
    return { status: 202, json: { topups: s.topups.map(({ label: l, state }) => ({ label: 'Top-up · ' + l, state })) } };
  }
  // ── Parked attestation (D07) — contract ack {state, availabilityEpoch, confirmedAt, expiresAt, ttlSeconds} ──
  if (i.method === 'POST' && i.path === '/v1/mp/driver/parked') {
    // The server acknowledges the attestation; the client adopts THIS state, never its own.
    return ok({ state: 'parked_confirmed', availabilityEpoch: 8, confirmedAt: new Date().toISOString(), expiresAt: iso(600_000), ttlSeconds: 600 });
  }
  // ── Jobs projection (D05/D11) — OpenAPI DriverJob schema ──
  if (i.method === 'GET' && i.path === '/v1/mp/driver/jobs') {
    s.jobsPolls += 1;
    const next = { claimId: 'clm_next', slot: 'next', service: 'ride', state: 'queued', fareMinor: NGN(2800), commissionMinor: money(feeMinor(2800_00)), receiptId: 'rcpt_mp_00291', executionRef: null, pickupWindow: { earliestSec: 720, latestSec: 1080, etaVersion: 3 } };
    if (s.jobsPolls >= 7) {
      // Current ended early → promotion re-validates from the driver's actual location.
      return ok({ current: null, next, promotion: 'failed_revalidating' });
    }
    if (s.jobsPolls >= 5) {
      return ok({ current: null, next, promotion: 'pending' });
    }
    return ok({
      current: { claimId: 'clm_cur', slot: 'current', service: 'ride', state: 'in trip', fareMinor: NGN(3200), commissionMinor: money(feeMinor(3200_00)), receiptId: 'rcpt_mp_00287', executionRef: { service: 'ride', id: 'ride_mp_901' }, pickupWindow: null },
      next,
      promotion: 'none',
    });
  }
  return undefined;
}
