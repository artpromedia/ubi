import { apiClient, newIdempotencyKey } from './api-client';
import { fmt, type Money } from './growth-api';

import type { MonitorRow, MonitorStat, TimelineEvent } from '@/components/marketplace/MarketplaceMonitorPage';
import type { PolicyField } from '@/components/marketplace/PolicyEditorPage';

/** Server-side mpRequest states (contracts/state-machines.json). */
export type MpRequestState = 'draft' | 'open' | 'award_pending' | 'awarded' | 'execution' | 'cancelled' | 'expired' | 'no_offers';
export type SearchEnvelope = { step: number; radiusMeters: number; pickupEtaSec: number };
export type MpRequestRow = { requestId: string; state: MpRequestState; service: string; cityId: string; askedMinor?: Money; bids?: number; reach?: number; envelope?: SearchEnvelope };
export type MpTimeline = { requestId: string; policyVersion: number; events: { at: string; type: string; detail: string }[] };

/** Mirrors MarketplacePolicySchema in @ubi/contracts city-config (read-only view; commission is a fixed 1,000 bps literal there). */
export type MarketplaceFareBounds = { absoluteFloorMinor: number; costFloorMinor: number; floorBpsOfSuggested: number; ceilingBpsOfSuggested: number };
export type MarketplacePolicy = {
  policyVersion: number;
  commissionBps: 1000;
  commissionRounding: 'half_up';
  fareBounds: Record<string, MarketplaceFareBounds>;
  searchEnvelope: { initialRadiusMeters: number; maxRadiusMeters: number; initialPickupEtaSec: number; maxPickupEtaSec: number; expandAfterSec: number; minOffersBeforeExpand: number; expansionSteps: number };
  stationary: { minDwellSec: number; maxSpeedMps: number; maxLocationAgeSec: number; maxAccuracyMeters: number; motionCloseSec: number };
  finishingTrip: { maxRemainingSec: number; completionBufferSec: number; uncertaintyBufferSec: number; corridorMaxBearingDeltaDeg: number };
  bids: { bidExpirySec: number; requestExpirySec: number; revisionCooldownSec: number; maxLiveBidsPerDriver: number; maxOpenRequestsPerRequester: number };
  queue: { pickupWindowToleranceSec: number };
  rateProfileBounds: Record<string, { maxPerKmMinor: number; maxMinimumTripFareMinor: number }>;
};
export type CityConfigView = { cityId: string; version: number; currency: string; currencyFractionDigits: number; /** Absent ⇒ market not configured here: fail closed. */ marketplace?: MarketplacePolicy };
export type ConfigHistory = { cityId: string; versions: { version: number; activatedAt: string | null; authoredBy: string; approvedBy: string | null; approvers: string[]; reason: string | null }[] };
export type ChangeRequest = { id: string; cityId: string; status: string; reason: string; authorId: string; createdAt: string; approvals: number; approvalsRequired: number; replayed: boolean };
export type FlagChange = { key: string; cityId: string | null; from: boolean; to: boolean; by: string; replayed: boolean };

export const marketplaceApi = {
  requests: (cityId?: string) => apiClient.get<{ rows: MpRequestRow[]; nextCursor?: string }>('/v1/admin/mp/requests' + (cityId ? '?cityId=' + encodeURIComponent(cityId) : '')),
  timeline: (requestId: string) => apiClient.get<MpTimeline>('/v1/admin/mp/requests/' + requestId + '/timeline'),
  cityConfig: (cityId: string) => apiClient.get<CityConfigView>('/v1/config/cities/' + cityId),
  configHistory: (cityId: string) => apiClient.get<ConfigHistory>('/v1/config/cities/' + cityId + '/history'),
  /** Policy edits go through the existing two-person config change-request flow. config-service requires an idempotency-key header (min 8 chars) or it 422s. */
  proposePolicyChange: (cityId: string, patch: Record<string, unknown>, reason: string) =>
    apiClient.post<ChangeRequest>('/v1/config/change-requests', { cityId, patch, reason }, { idempotencyKey: newIdempotencyKey() }),
  /** Kill switch: stops NEW awards only (deny-by-default flag); audited single-actor path in config-service. Requires an idempotency-key header or it 422s. */
  stopAwards: (cityId: string, reason: string) =>
    apiClient.put<FlagChange>('/v1/flags/marketplace_rides', { cityId, enabled: false, reason }, { idempotencyKey: newIdempotencyKey() }),
};

// ---------------------------------------------------------------------------
// Pure mapping helpers (unit-tested): server rows/config → presentational props.
// ---------------------------------------------------------------------------

/** Live states the monitor renders; terminal states (cancelled/expired/draft/…) are filtered out. */
export const toMonitorState = (state: MpRequestState): MonitorRow['state'] | null => {
  switch (state) {
    case 'open': return 'open';
    case 'no_offers': return 'no_bids';
    case 'award_pending': return 'award_pending';
    case 'awarded':
    case 'execution': return 'awarded';
    default: return null;
  }
};

export const envelopeLine = (e?: SearchEnvelope): string =>
  e ? (e.radiusMeters / 1000).toFixed(1) + ' km · ' + Math.round(e.pickupEtaSec / 60) + ' min · step ' + e.step : '—';

export const toMonitorRow = (r: MpRequestRow): MonitorRow | null => {
  const state = toMonitorState(r.state);
  if (state === null) {
    return null;
  }
  return { requestId: r.requestId, route: r.cityId, service: r.service, asked: fmt(r.askedMinor), bids: r.bids ?? 0, reach: r.reach === undefined ? '—' : String(r.reach), envelope: envelopeLine(r.envelope), state };
};

export const monitorStats = (rows: MonitorRow[]): MonitorStat[] => {
  const count = (s: MonitorRow['state']) => rows.filter((r) => r.state === s).length;
  const noBids = count('no_bids');
  return [
    { label: 'Open requests', value: String(count('open') + noBids), detail: noBids + ' without bids', tone: noBids > 0 ? 'warn' : 'ok' },
    { label: 'Award pending', value: String(count('award_pending')), detail: 'never times out while a debit may commit' },
    { label: 'Awarded / in execution', value: String(count('awarded')), tone: 'ok' },
    { label: 'Live rows', value: String(rows.length), detail: 'terminal states hidden' },
  ];
};

const EVENT_WARN = /fail|expir|withdraw|cancel|closed|invalid|revers|no_offers|lost/;
const EVENT_OK = /confirm|award|captur|won|released|complete/;
export const eventTone = (type: string): TimelineEvent['tone'] => {
  if (EVENT_WARN.test(type)) {
    return 'warn';
  }
  return EVENT_OK.test(type) ? 'ok' : 'info';
};

export const toTimelineEvents = (t: MpTimeline): TimelineEvent[] =>
  t.events.map((e) => ({ at: e.at.length >= 19 ? e.at.slice(11, 19) : e.at, type: e.type, tone: eventTone(e.type), detail: e.detail }));

const money = (amountMinor: number, currency: string): string => fmt({ amountMinor, currency });
const pct = (bps: number): string => (bps / 100).toLocaleString('en-NG') + '%';
const secs = (s: number): string => (s % 60 === 0 && s >= 60 ? s / 60 + ' min' : s + ' s');

/**
 * Fare-bound fields for the editor. Fail closed: a city without a marketplace
 * block, or with an empty/incomplete fareBounds record, renders invalid fields
 * and must not be publishable (market_not_configured on the server side).
 */
export const boundsFields = (config?: CityConfigView): { fields: PolicyField[]; error: string | null } => {
  const mp = config?.marketplace;
  if (config === undefined || mp === undefined || Object.keys(mp.fareBounds).length === 0) {
    return {
      fields: [{ label: 'Fare bounds', value: 'Not configured — market closed', invalid: true }],
      error: 'No marketplace fare bounds are configured for this city. The market fails closed (market_not_configured) and publishing is blocked.',
    };
  }
  const fields = Object.entries(mp.fareBounds).map(([pair, b]) => {
    const invalid = !(b.absoluteFloorMinor > 0 && b.ceilingBpsOfSuggested >= 10_000);
    return {
      label: pair,
      value: invalid ? 'Floor unconfigured' : 'floor ' + money(b.absoluteFloorMinor, config.currency) + ' · cost ' + money(b.costFloorMinor, config.currency) + ' · ' + pct(b.floorBpsOfSuggested) + '–' + pct(b.ceilingBpsOfSuggested),
      mono: true,
      invalid,
    };
  });
  const bad = fields.filter((f) => f.invalid).length;
  return { fields, error: bad > 0 ? bad + ' service:vehicleClass pair(s) have unconfigured floors — publish is blocked (fail closed).' : null };
};

export const presetFields = (mp?: MarketplacePolicy): PolicyField[] =>
  mp
    ? [
        { label: 'Bid expiry', value: secs(mp.bids.bidExpirySec) },
        { label: 'Request expiry', value: secs(mp.bids.requestExpirySec) },
        { label: 'Revision cooldown', value: secs(mp.bids.revisionCooldownSec) },
        { label: 'Max live bids / driver', value: String(mp.bids.maxLiveBidsPerDriver) },
        { label: 'Max open requests / requester', value: String(mp.bids.maxOpenRequestsPerRequester) },
      ]
    : [{ label: 'Bid presets', value: 'Not configured', invalid: true }];

export const envelopeFields = (mp?: MarketplacePolicy): PolicyField[] =>
  mp
    ? [
        { label: 'Radius', value: (mp.searchEnvelope.initialRadiusMeters / 1000).toFixed(1) + ' → ' + (mp.searchEnvelope.maxRadiusMeters / 1000).toFixed(1) + ' km' },
        { label: 'Pickup ETA', value: secs(mp.searchEnvelope.initialPickupEtaSec) + ' → ' + secs(mp.searchEnvelope.maxPickupEtaSec) },
        { label: 'Expand after', value: secs(mp.searchEnvelope.expandAfterSec) + ' · <' + mp.searchEnvelope.minOffersBeforeExpand + ' offers · ' + mp.searchEnvelope.expansionSteps + ' steps' },
        { label: 'Stationary dwell', value: secs(mp.stationary.minDwellSec) + ' · ≤' + mp.stationary.maxSpeedMps + ' m/s' },
        { label: 'Finishing-trip corridor', value: '≤' + secs(mp.finishingTrip.maxRemainingSec) + ' left · ≤' + mp.finishingTrip.corridorMaxBearingDeltaDeg + '°' },
        { label: 'Queue window tolerance', value: secs(mp.queue.pickupWindowToleranceSec) },
      ]
    : [{ label: 'Search & queue envelopes', value: 'Not configured', invalid: true }];

/** Publish gate — fail closed: any invalid field blocks publish. */
export const canPublishPolicy = (config?: CityConfigView): boolean => {
  if (config?.marketplace === undefined) {
    return false;
  }
  const { fields, error } = boundsFields(config);
  return error === null && fields.every((f) => !f.invalid);
};
