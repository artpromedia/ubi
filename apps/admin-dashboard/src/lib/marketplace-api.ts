import { apiClient, newIdempotencyKey } from "./api-client";
import { formatMinor, formatServerMoney } from "./money";
import { renderTimelineEvents, type RenderContext } from "./mp-events";
import { redactDeep } from "./redact";

import type { Money } from "./growth-api";
import type {
  MonitorRow,
  MonitorStat,
  TimelineEvent,
} from "@/components/marketplace/MarketplaceMonitorPage";
import type { PolicyField } from "@/components/marketplace/PolicyEditorPage";

/** Server-side mpRequest states (contracts/state-machines.json). */
export type MpRequestState =
  | "draft"
  | "open"
  | "award_pending"
  | "awarded"
  | "execution"
  | "cancelled"
  | "expired"
  | "no_offers";
export type SearchEnvelope = {
  step: number;
  radiusMeters: number;
  pickupEtaSec: number;
};
export type MpRequestRow = {
  requestId: string;
  state: MpRequestState;
  service: string;
  cityId: string;
  askedMinor?: Money;
  bids?: number;
  reach?: number;
  envelope?: SearchEnvelope;
};
export type MpTimeline = {
  requestId: string;
  policyVersion: number;
  events: { at: string; type: string; detail: string }[];
};

/** Mirrors MarketplacePolicySchema in @ubi/contracts city-config (read-only view; commission is a fixed 1,000 bps literal there). */
export type MarketplaceFareBounds = {
  absoluteFloorMinor: number;
  costFloorMinor: number;
  floorBpsOfSuggested: number;
  ceilingBpsOfSuggested: number;
};
export type MarketplacePolicy = {
  policyVersion: number;
  commissionBps: 1000;
  commissionRounding: "half_up";
  fareBounds: Record<string, MarketplaceFareBounds>;
  searchEnvelope: {
    initialRadiusMeters: number;
    maxRadiusMeters: number;
    initialPickupEtaSec: number;
    maxPickupEtaSec: number;
    expandAfterSec: number;
    minOffersBeforeExpand: number;
    expansionSteps: number;
  };
  stationary: {
    minDwellSec: number;
    maxSpeedMps: number;
    maxLocationAgeSec: number;
    maxAccuracyMeters: number;
    motionCloseSec: number;
  };
  finishingTrip: {
    maxRemainingSec: number;
    completionBufferSec: number;
    uncertaintyBufferSec: number;
    corridorMaxBearingDeltaDeg: number;
  };
  bids: {
    bidExpirySec: number;
    requestExpirySec: number;
    revisionCooldownSec: number;
    maxLiveBidsPerDriver: number;
    maxOpenRequestsPerRequester: number;
  };
  queue: { pickupWindowToleranceSec: number };
  rateProfileBounds: Record<
    string,
    { maxPerKmMinor: number; maxMinimumTripFareMinor: number }
  >;
};
export type CityConfigView = {
  cityId: string;
  version: number;
  currency: string;
  currencyFractionDigits: number;
  /** Absent ⇒ market not configured here: fail closed. */ marketplace?: MarketplacePolicy;
};
export type ConfigHistory = {
  cityId: string;
  versions: {
    version: number;
    activatedAt: string | null;
    authoredBy: string;
    approvedBy: string | null;
    approvers: string[];
    reason: string | null;
  }[];
};
export type ChangeRequest = {
  id: string;
  cityId: string;
  status: string;
  reason: string;
  authorId: string;
  createdAt: string;
  approvals: number;
  approvalsRequired: number;
  replayed: boolean;
};
export type FlagChange = {
  key: string;
  cityId: string | null;
  from: boolean;
  to: boolean;
  by: string;
  replayed: boolean;
};

// ---------------------------------------------------------------------------
// C08 — admin resolution, standing and appeals: types mirroring the new
// ride-service admin read models/commands (services/ride-service/internal/
// marketplace/{standing,resolution}.go). These are admin-only views, so —
// like MpRequestRow/MpTimeline above — they are declared here rather than in
// @ubi/contracts, which carries only the cross-app/cross-service surface.
// ---------------------------------------------------------------------------

export type PendingSagaView = {
  awardId: string;
  requestId: string;
  driverId: string;
  cityId: string;
  step: string;
  attemptState: string;
  attempts: number;
  lastError?: string;
  ageSec: number;
  nextRetryAt?: string;
  createdAt: string;
  updatedAt: string;
};
export type PendingSagasPage = {
  rows: PendingSagaView[];
  nextCursor?: string;
};
export type ReconcileAwardResult = {
  awardId: string;
  dryRun: boolean;
  beforeState: string;
  afterState: string;
  outcome: "preview" | "resolved" | "unresolved";
  detail?: string;
  updatedAt: string;
};

export type RecoveryView = {
  id: string;
  action: string;
  driverId: string;
  bidId?: string;
  reservationId: string;
  amountMinor?: number;
  attempts: number;
  lastError?: string;
  ageSec: number;
  nextRetryAt: string;
  resolvedAt?: string;
  createdAt: string;
};
export type RecoveriesPage = { rows: RecoveryView[]; nextCursor?: string };
export type RetryRecoveryResult = {
  row: RecoveryView;
  outcome: "preview" | "resolved" | "deferred" | "already_resolved";
  detail?: string;
};

export type CancellationView = {
  rideId: string;
  awardId?: string;
  requestId?: string;
  cityId: string;
  driverId?: string;
  riderId: string;
  state: string;
  reasonCode?: string;
  at: string;
};
export type CancellationsPage = {
  rows: CancellationView[];
  nextCursor?: string;
};

/** Mirrors standingReasonCodes in ride-service's standing.go — the closed
 * set a proposal or a decision must cite. Kept here, not invented per form,
 * so the operator UI and the server's fail-closed validation never drift. */
export const STANDING_REASON_CODES = [
  "repeated_cancellation",
  "no_show_pattern",
  "fraud_suspected",
  "safety_complaint",
  "policy_violation",
  "appeal_reviewed",
  "performance_recovered",
  "other",
] as const;

export type StandingActionView = {
  id: string;
  driverId: string;
  cityId: string;
  actionType: "warning" | "suspension" | "reinstatement";
  reasonCode: string;
  reasonNote?: string;
  status:
    | "pending_approval"
    | "active"
    | "rejected"
    | "appealed"
    | "appeal_upheld"
    | "appeal_denied";
  proposedBy: string;
  proposedAt: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionReason?: string;
  appealedBy?: string;
  appealedAt?: string;
  appealNote?: string;
  appealDecidedBy?: string;
  appealDecidedAt?: string;
  appealReason?: string;
  requiresApproval: boolean;
  updatedAt: string;
};
export type StandingActionsPage = {
  rows: StandingActionView[];
  nextCursor?: string;
};
export type DriverStandingView = {
  driverId: string;
  cityId: string;
  windowDays: number;
  totalRides: number;
  completions: number;
  driverCancellations: number;
  riderCancellations: number;
  noShows: number;
  cancellationRate: number;
  blocked: boolean;
  activeAction?: StandingActionView;
  history: StandingActionView[];
};
export type DriverStandingRow = {
  driverId: string;
  cityId: string;
  windowDays: number;
  totalRides: number;
  completions: number;
  driverCancellations: number;
  noShows: number;
  cancellationRate: number;
};
export type DriverStandingListPage = {
  rows: DriverStandingRow[];
  total: number;
  limit: number;
  offset: number;
  windowDays: number;
  minRides: number;
};

export type ResolutionStage = {
  name: string;
  status: "view" | "proposed" | "committed" | "failed" | "unavailable";
  detail: string;
  at?: string;
};
export type ResolutionAwardView = {
  awardId: string;
  state: string;
  driverId: string;
  fareMinor: Money;
  commissionMinor: Money;
  captureReceiptId?: string;
  failReason?: string;
  sagaStep?: string;
  sagaState?: string;
  sagaAttempts?: number;
  captured: boolean;
  updatedAt: string;
};
export type ResolutionExecutionView = {
  rideId: string;
  state: string;
  active: boolean;
  cancelledByRole?: string;
  cancelReasonCode?: string;
  completedAt?: string;
  cancelledAt?: string;
};
export type ResolutionView = {
  requestId: string;
  cityId: string;
  requestState: string;
  closeReason?: string;
  award?: ResolutionAwardView;
  execution?: ResolutionExecutionView;
  recoveries: RecoveryView[];
  stages: ResolutionStage[];
  events: { at: string; type: string; detail: string }[];
  driverBlocked?: boolean;
  gaps: string[];
};

/** Builds a `?a=b&c=d` query string, dropping undefined/empty values. */
function toQuery(params: Record<string, string | number | undefined>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(
      ([k, v]) => encodeURIComponent(k) + "=" + encodeURIComponent(String(v)),
    );
  return parts.length > 0 ? "?" + parts.join("&") : "";
}

export const marketplaceApi = {
  requests: (cityId?: string) =>
    apiClient.get<{ rows: MpRequestRow[]; nextCursor?: string }>(
      "/v1/admin/mp/requests" +
        (cityId ? "?cityId=" + encodeURIComponent(cityId) : ""),
    ),
  timeline: (requestId: string) =>
    apiClient.get<MpTimeline>(
      "/v1/admin/mp/requests/" + requestId + "/timeline",
    ),
  resolution: (requestId: string) =>
    apiClient.get<ResolutionView>(
      "/v1/admin/mp/requests/" + requestId + "/resolution",
    ),
  repairStrandedRides: (
    body: { dryRun: boolean; rideIds?: string[]; limit?: number },
    idempotencyKey?: string,
  ) =>
    apiClient.post<unknown>(
      "/v1/admin/mp/repairs/stranded-rides",
      body,
      idempotencyKey ? { idempotencyKey } : undefined,
    ),

  pendingSagas: (cityId?: string, cursor?: string) =>
    apiClient.get<PendingSagasPage>(
      "/v1/admin/mp/pending-sagas" + toQuery({ cityId, cursor }),
    ),
  /** An apply sends the key minted when its preview was shown, so a
   * double-click or a retried confirm replays ONE reconcile server-side. */
  reconcileAward: (
    awardId: string,
    body: { dryRun: boolean; expectedUpdatedAt?: string },
    idempotencyKey?: string,
  ) =>
    apiClient.post<ReconcileAwardResult>(
      "/v1/admin/mp/awards/" + awardId + "/reconcile",
      body,
      body.dryRun
        ? undefined
        : { idempotencyKey: idempotencyKey ?? newIdempotencyKey() },
    ),

  recoveries: (action?: string, cursor?: string) =>
    apiClient.get<RecoveriesPage>(
      "/v1/admin/mp/recoveries" + toQuery({ action, cursor }),
    ),
  retryRecovery: (
    id: string,
    body: { dryRun: boolean; expectedAttempts?: number },
    idempotencyKey?: string,
  ) =>
    apiClient.post<RetryRecoveryResult>(
      "/v1/admin/mp/recoveries/" + id + "/retry",
      body,
      body.dryRun
        ? undefined
        : { idempotencyKey: idempotencyKey ?? newIdempotencyKey() },
    ),

  cancellations: (cityId?: string, driverId?: string, cursor?: string) =>
    apiClient.get<CancellationsPage>(
      "/v1/admin/mp/cancellations" + toQuery({ cityId, driverId, cursor }),
    ),

  driverStandingList: (
    cityId?: string,
    windowDays?: number,
    minRides?: number,
  ) =>
    apiClient.get<DriverStandingListPage>(
      "/v1/admin/mp/drivers/standing" +
        toQuery({ cityId, windowDays, minRides }),
    ),
  driverStanding: (driverId: string, windowDays?: number) =>
    apiClient.get<DriverStandingView>(
      "/v1/admin/mp/drivers/" +
        driverId +
        "/standing" +
        toQuery({ windowDays }),
    ),
  proposeStandingAction: (
    driverId: string,
    body: {
      actionType: "warning" | "suspension" | "reinstatement";
      reasonCode: string;
      reasonNote?: string;
      cityId: string;
    },
  ) =>
    apiClient.post<StandingActionView>(
      "/v1/admin/mp/drivers/" + driverId + "/standing-actions",
      body,
      { idempotencyKey: newIdempotencyKey() },
    ),
  standingActionsQueue: (status?: string, cursor?: string) =>
    apiClient.get<StandingActionsPage>(
      "/v1/admin/mp/standing-actions" + toQuery({ status, cursor }),
    ),
  decideStandingAction: (
    id: string,
    body: { approve: boolean; reason: string },
  ) =>
    apiClient.post<StandingActionView>(
      "/v1/admin/mp/standing-actions/" + id + "/decide",
      body,
      { idempotencyKey: newIdempotencyKey() },
    ),
  fileAppeal: (id: string, body: { note: string }) =>
    apiClient.post<StandingActionView>(
      "/v1/admin/mp/standing-actions/" + id + "/appeal",
      body,
      { idempotencyKey: newIdempotencyKey() },
    ),
  decideAppeal: (id: string, body: { uphold: boolean; reason: string }) =>
    apiClient.post<StandingActionView>(
      "/v1/admin/mp/standing-actions/" + id + "/appeal-decision",
      body,
      { idempotencyKey: newIdempotencyKey() },
    ),
  cityConfig: (cityId: string) =>
    apiClient.get<CityConfigView>("/v1/config/cities/" + cityId),
  configHistory: (cityId: string) =>
    apiClient.get<ConfigHistory>("/v1/config/cities/" + cityId + "/history"),
  /** Policy edits go through the existing two-person config change-request flow. config-service requires an idempotency-key header (min 8 chars) or it 422s. */
  proposePolicyChange: (
    cityId: string,
    patch: Record<string, unknown>,
    reason: string,
  ) =>
    apiClient.post<ChangeRequest>(
      "/v1/config/change-requests",
      { cityId, patch, reason },
      { idempotencyKey: newIdempotencyKey() },
    ),
  /** Kill switch: stops NEW awards only (deny-by-default flag); audited single-actor path in config-service. Requires an idempotency-key header or it 422s. */
  stopAwards: (cityId: string, reason: string) =>
    apiClient.put<FlagChange>(
      "/v1/flags/marketplace_rides",
      { cityId, enabled: false, reason },
      { idempotencyKey: newIdempotencyKey() },
    ),
};

// ---------------------------------------------------------------------------
// Pure mapping helpers (unit-tested): server rows/config → presentational props.
// ---------------------------------------------------------------------------

/** Live states the monitor renders; terminal states (cancelled/expired/draft/…) are filtered out. */
export const toMonitorState = (
  state: MpRequestState,
): MonitorRow["state"] | null => {
  switch (state) {
    case "open":
      return "open";
    case "no_offers":
      return "no_bids";
    case "award_pending":
      return "award_pending";
    case "awarded":
    case "execution":
      return "awarded";
    default:
      return null;
  }
};

export const envelopeLine = (e?: SearchEnvelope): string =>
  e
    ? (e.radiusMeters / 1000).toFixed(1) +
      " km · " +
      Math.round(e.pickupEtaSec / 60) +
      " min · step " +
      e.step
    : "—";

export const toMonitorRow = (r: MpRequestRow): MonitorRow | null => {
  const state = toMonitorState(r.state);
  if (state === null) {
    return null;
  }
  return {
    requestId: r.requestId,
    route: r.cityId,
    service: r.service,
    // The server's amount in ITS currency, decimal placed by string — never
    // growth-api's fmt (which divides, rounds and always prints ₦).
    asked: formatServerMoney(r.askedMinor),
    bids: r.bids ?? 0,
    reach: r.reach === undefined ? "—" : String(r.reach),
    envelope: envelopeLine(r.envelope),
    state,
  };
};

export const monitorStats = (rows: MonitorRow[]): MonitorStat[] => {
  const count = (s: MonitorRow["state"]) =>
    rows.filter((r) => r.state === s).length;
  const noBids = count("no_bids");
  return [
    {
      label: "Open requests",
      value: String(count("open") + noBids),
      detail: noBids + " without bids",
      tone: noBids > 0 ? "warn" : "ok",
    },
    {
      label: "Award pending",
      value: String(count("award_pending")),
      detail: "never times out while a debit may commit",
    },
    {
      label: "Awarded / in execution",
      value: String(count("awarded")),
      tone: "ok",
    },
    {
      label: "Live rows",
      value: String(rows.length),
      detail: "terminal states hidden",
    },
  ];
};

const EVENT_WARN =
  /fail|expir|withdraw|cancel|closed|invalid|revers|no_offers|lost/;
const EVENT_OK = /confirm|award|captur|won|released|complete/;
export const eventTone = (type: string): TimelineEvent["tone"] => {
  if (EVENT_WARN.test(type)) {
    return "warn";
  }
  return EVENT_OK.test(type) ? "ok" : "info";
};

/** Monitor rows: the raw payload is replaced by the PII-minimised operator
 * copy from lib/mp-events.ts (never shown as JSON). `ctx.currency` is the
 * request's own server currency, for amounts an event carries without one. */
export const toTimelineEvents = (
  t: MpTimeline,
  ctx: RenderContext = {},
): TimelineEvent[] =>
  renderTimelineEvents(t.events, ctx).map((e, i) => {
    const at = t.events[i]?.at ?? "";
    return {
      at: at.length >= 19 ? at.slice(11, 19) : at,
      type: e.type,
      tone: e.known ? e.tone : eventTone(e.type),
      detail: e.label + " — " + e.summary,
    };
  });

const money = (amountMinor: number, currency: string): string =>
  formatMinor(amountMinor, currency);
const pct = (bps: number): string => (bps / 100).toLocaleString("en-NG") + "%";
const secs = (s: number): string =>
  s % 60 === 0 && s >= 60 ? s / 60 + " min" : s + " s";

/**
 * Fare-bound fields for the editor. Fail closed: a city without a marketplace
 * block, or with an empty/incomplete fareBounds record, renders invalid fields
 * and must not be publishable (market_not_configured on the server side).
 */
export const boundsFields = (
  config?: CityConfigView,
): { fields: PolicyField[]; error: string | null } => {
  const mp = config?.marketplace;
  if (
    config === undefined ||
    mp === undefined ||
    Object.keys(mp.fareBounds).length === 0
  ) {
    return {
      fields: [
        {
          label: "Fare bounds",
          value: "Not configured — market closed",
          invalid: true,
        },
      ],
      error:
        "No marketplace fare bounds are configured for this city. The market fails closed (market_not_configured) and publishing is blocked.",
    };
  }
  const fields = Object.entries(mp.fareBounds).map(([pair, b]) => {
    const invalid = !(
      b.absoluteFloorMinor > 0 && b.ceilingBpsOfSuggested >= 10_000
    );
    return {
      label: pair,
      value: invalid
        ? "Floor unconfigured"
        : "floor " +
          money(b.absoluteFloorMinor, config.currency) +
          " · cost " +
          money(b.costFloorMinor, config.currency) +
          " · " +
          pct(b.floorBpsOfSuggested) +
          "–" +
          pct(b.ceilingBpsOfSuggested),
      mono: true,
      invalid,
    };
  });
  const bad = fields.filter((f) => f.invalid).length;
  return {
    fields,
    error:
      bad > 0
        ? bad +
          " service:vehicleClass pair(s) have unconfigured floors — publish is blocked (fail closed)."
        : null,
  };
};

export const presetFields = (mp?: MarketplacePolicy): PolicyField[] =>
  mp
    ? [
        { label: "Bid expiry", value: secs(mp.bids.bidExpirySec) },
        { label: "Request expiry", value: secs(mp.bids.requestExpirySec) },
        {
          label: "Revision cooldown",
          value: secs(mp.bids.revisionCooldownSec),
        },
        {
          label: "Max live bids / driver",
          value: String(mp.bids.maxLiveBidsPerDriver),
        },
        {
          label: "Max open requests / requester",
          value: String(mp.bids.maxOpenRequestsPerRequester),
        },
      ]
    : [{ label: "Bid presets", value: "Not configured", invalid: true }];

export const envelopeFields = (mp?: MarketplacePolicy): PolicyField[] =>
  mp
    ? [
        {
          label: "Radius",
          value:
            (mp.searchEnvelope.initialRadiusMeters / 1000).toFixed(1) +
            " → " +
            (mp.searchEnvelope.maxRadiusMeters / 1000).toFixed(1) +
            " km",
        },
        {
          label: "Pickup ETA",
          value:
            secs(mp.searchEnvelope.initialPickupEtaSec) +
            " → " +
            secs(mp.searchEnvelope.maxPickupEtaSec),
        },
        {
          label: "Expand after",
          value:
            secs(mp.searchEnvelope.expandAfterSec) +
            " · <" +
            mp.searchEnvelope.minOffersBeforeExpand +
            " offers · " +
            mp.searchEnvelope.expansionSteps +
            " steps",
        },
        {
          label: "Stationary dwell",
          value:
            secs(mp.stationary.minDwellSec) +
            " · ≤" +
            mp.stationary.maxSpeedMps +
            " m/s",
        },
        {
          label: "Finishing-trip corridor",
          value:
            "≤" +
            secs(mp.finishingTrip.maxRemainingSec) +
            " left · ≤" +
            mp.finishingTrip.corridorMaxBearingDeltaDeg +
            "°",
        },
        {
          label: "Queue window tolerance",
          value: secs(mp.queue.pickupWindowToleranceSec),
        },
      ]
    : [
        {
          label: "Search & queue envelopes",
          value: "Not configured",
          invalid: true,
        },
      ];

/** Publish gate — fail closed: any invalid field blocks publish. */
export const canPublishPolicy = (config?: CityConfigView): boolean => {
  if (config?.marketplace === undefined) {
    return false;
  }
  const { fields, error } = boundsFields(config);
  return error === null && fields.every((f) => !f.invalid);
};

// ---------------------------------------------------------------------------
// C08 pure formatting helpers (unit-tested): server rows → presentational tone.
// ---------------------------------------------------------------------------

/** Human-friendly age from a row's ageSec — "3m 12s", "2h 04m", "5d". */
export const ageLine = (ageSec: number): string => {
  if (ageSec < 60) return ageSec + "s";
  if (ageSec < 3600) {
    return Math.floor(ageSec / 60) + "m " + (ageSec % 60) + "s";
  }
  if (ageSec < 86_400) {
    const h = Math.floor(ageSec / 3600);
    const m = Math.floor((ageSec % 3600) / 60);
    return h + "h " + String(m).padStart(2, "0") + "m";
  }
  return Math.floor(ageSec / 86_400) + "d";
};

export type Tone = "view" | "proposed" | "committed" | "failed" | "unavailable";

/** Maps a resolution-stage / command-outcome status to a rendering tone. */
export const outcomeTone = (status: string): Tone => {
  switch (status) {
    case "committed":
    case "resolved":
    case "active":
    case "confirmed":
      return "committed";
    case "proposed":
    case "pending_approval":
    case "deferred":
    case "appealed":
      return "proposed";
    case "failed":
    case "rejected":
    case "appeal_denied":
      return "failed";
    case "unavailable":
      return "unavailable";
    default:
      return "view";
  }
};

export const pctRate = (rate: number): string =>
  (rate * 100).toLocaleString("en-NG", { maximumFractionDigits: 1 }) + "%";

/** Redacts a resolution/standing view to a plain-text export with no PII
 * beyond opaque ids (no coordinates, no PIN vault fields, no raw tokens, no
 * phone numbers). This is the one seam every export from these boards goes
 * through: blocked keys are replaced at any depth, and a string that is
 * itself JSON (the timeline's raw outbox payload) is parsed and redacted
 * too, so a sealed trip-link envelope can never ride out inside a string. */
export const redactedExport = (data: unknown): string =>
  JSON.stringify(redactDeep(data), null, 2);

/** The Cases export: the resolution view with its events replaced by their
 * rendered operator copy (no raw payloads at all), then redacted. */
export const redactedCaseExport = (
  view: ResolutionView,
  ctx: RenderContext = {},
): string =>
  redactedExport({
    ...view,
    events: renderTimelineEvents(view.events, ctx).map((e) => ({
      at: e.atIso,
      type: e.type,
      label: e.label,
      summary: e.summary,
      facts: e.facts,
    })),
  });
