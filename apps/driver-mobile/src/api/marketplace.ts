// Driver-side negotiated-fare marketplace (M08, boards D01–D12).
// Paths follow contracts/openapi/marketplace.yaml; DTO shapes come straight from
// @ubi/contracts/src/marketplace.ts. Presets, fee, net and shortfall arrive
// SERVER-phrased and are rendered verbatim — the client never computes money
// (launch CLAUDE.md #1, M03A rule).
import { api, type Money } from "@ubi/mobile-core";
import type {
  MpBid,
  MpDriverPreferences,
  MpDriverPreferencesPatch,
  MpEarningsBreakdown,
  MpEligibility,
  MpFeedItem,
  MpFeedPage,
  MpPreset,
  MpRatePreview,
  MpRateProfile,
  MpService,
  MpSubmitBid,
  MpWalletHold,
  MpWalletOverview,
} from "@ubi/contracts";

export type {
  MpBid,
  MpDriverPreferences,
  MpDriverPreferencesPatch,
  MpEarningsBreakdown,
  MpEligibility,
  MpFeedItem,
  MpPreset,
  MpRatePreview,
  MpRateProfile,
  MpSubmitBid,
  MpWalletOverview,
};

/**
 * D06 "My offers" view. The server emits holdState in the D06 vocabulary
 * held | release_pending | released, where `released` appears ONLY after the
 * wallet release is financially confirmed (a lost bid renders "release
 * pending" until then — never "released" early). `title`/`holdDetail` are
 * server-composed projections still pending in packages/contracts MpBidSchema
 * + contracts/openapi/marketplace.yaml (Bid schema carries none of the three
 * yet); see followups. Consumers must treat any OTHER value as unknown and
 * render the safe pending state (see holdStateOrSafe in RequestFeedContainer).
 */
export type MpHoldState = "held" | "release_pending" | "released";
export type MpBidDto = MpBid & {
  title?: string;
  holdState?: MpHoldState;
  holdDetail?: string;
};

/** GET /v1/mp/requests/:id/driver-view (D02/D03/D10) per contracts/openapi/marketplace.yaml. */
export type MpDriverView = {
  item: MpFeedItem;
  eligibility: MpEligibility;
  presets: MpPreset[];
  profileLine?: string | null;
  ceilingNotice?: string | null;
  myBid?: MpBidDto | null;
  /** The driver's current work claim id — the mandatory dependsOnClaimId for a next-slot bid. Absent/null unless a current claim exists. */
  currentClaimId?: string | null;
  /** A04.2: a saved preference this request cannot meet, server-phrased. */
  preferenceNotice?: string | null;
};

/** `deferredPrompt` (D07 single deferred banner, server-phrased) is a PROPOSED MpFeedPage addition; fixture-only until contracts carry it. */
export type MpFeedPageDto = MpFeedPage & { deferredPrompt?: string | null };

/** D04 wallet rows. `title`/`releaseCondition` per hold and the top-up projection are PROPOSED server-composed additions (fixture-only; see followups). */
export type MpWalletHoldDto = MpWalletHold & {
  title?: string;
  releaseCondition?: string;
};
export type MpTopupRow = {
  label: string;
  state: "pending" | "cleared" | "failed";
};
export type MpWalletOverviewDto = Omit<MpWalletOverview, "holds"> & {
  holds: MpWalletHoldDto[];
  topupPresets?: string[];
  topups?: MpTopupRow[];
};

export type MpRateProfileSave = {
  cityId: string;
  service: MpService;
  vehicleClass: string;
  perKmMinor: number;
  minimumTripFareMinor: number;
};
export type MpRatePreviewBody = MpRateProfileSave & {
  exampleDistanceMeters: number;
};

/**
 * D05 + D11 jobs timeline — GET /v1/mp/driver/jobs per the OpenAPI DriverJob
 * schema (contracts/openapi/marketplace.yaml). A job card exists ONLY because
 * the server has a durable award.confirmed — the client never promotes a bid
 * on its own. `promotion: 'none'` means no promotion is in flight.
 */
export type MpExecutionRef = { service: MpService; id: string };
export type MpDriverJob = {
  claimId: string;
  slot: "current" | "next";
  service: MpService;
  state: string;
  fareMinor: Money;
  commissionMinor: Money;
  receiptId?: string | null;
  executionRef?: MpExecutionRef | null;
  pickupWindow?: {
    earliestSec: number;
    latestSec: number;
    etaVersion: number;
  } | null;
};
export type MpJobsView = {
  current?: MpDriverJob | null;
  next?: MpDriverJob | null;
  promotion: "none" | "pending" | "failed_revalidating";
};

/**
 * "I am safely parked" attestation (D07 / RN-02) — POST /v1/mp/driver/parked
 * per contracts/openapi/marketplace.yaml. The server records the attestation
 * and re-evaluates eligibility; the response is the state the SERVER
 * acknowledges and the attestation alone never makes the driver biddable
 * (production telemetry wiring is RN-02 scope; the server keeps rejecting
 * bids with NOT_STATIONARY until its own signals agree).
 */
export type MpParkedAck = {
  state: "parked_confirmed" | "moving" | "stale_location";
  availabilityEpoch: number;
  confirmedAt: string;
  expiresAt: string;
  ttlSeconds: number;
};

/** Feed query: `ignorePreferences` asks for the whole envelope (A04.2 `preferences=ignore`). */
export type MpFeedQuery = { cursor?: string; ignorePreferences?: boolean };
const feedPath = (query: MpFeedQuery = {}) => {
  const params: string[] = [];
  if (query.cursor) params.push("cursor=" + encodeURIComponent(query.cursor));
  if (query.ignorePreferences) params.push("preferences=ignore");
  return "/v1/mp/feed" + (params.length ? "?" + params.join("&") : "");
};

export const marketplaceApi = {
  feed: (query?: MpFeedQuery | string) =>
    api<MpFeedPageDto>(
      "GET",
      feedPath(typeof query === "string" ? { cursor: query } : query),
    ),
  driverView: (requestId: string) =>
    api<MpDriverView>("GET", "/v1/mp/requests/" + requestId + "/driver-view"),
  submitBid: (body: MpSubmitBid) => api<MpBidDto>("POST", "/v1/mp/bids", body),
  reviseBid: (
    bidId: string,
    body: { amountMinor: Money; expectedVersion: number },
  ) => api<MpBidDto>("POST", "/v1/mp/bids/" + bidId + "/revise", body),
  withdrawBid: (bidId: string) =>
    api<MpBidDto>("POST", "/v1/mp/bids/" + bidId + "/withdraw"),
  myBids: () => api<{ bids: MpBidDto[] }>("GET", "/v1/mp/bids/mine"),
  rateProfiles: () =>
    api<{ profiles: MpRateProfile[] }>("GET", "/v1/mp/rate-profiles"),
  // PUT carries an Idempotency-Key per the OpenAPI contract (api() adds it on POST only).
  saveRateProfile: (body: MpRateProfileSave) =>
    api<MpRateProfile>("PUT", "/v1/mp/rate-profiles", body, {
      idempotent: true,
    }),
  ratePreview: (body: MpRatePreviewBody) =>
    api<MpRatePreview>("POST", "/v1/mp/rate-profiles/preview", body),
  // `cityId` names the market whose currency/config applies (contract: optional query param).
  walletOverview: (cityId?: string) =>
    api<MpWalletOverviewDto>(
      "GET",
      "/v1/wallet/mp/overview" +
        (cityId ? "?cityId=" + encodeURIComponent(cityId) : ""),
    ),
  parked: () => api<MpParkedAck>("POST", "/v1/mp/driver/parked"),
  jobs: () => api<MpJobsView>("GET", "/v1/mp/driver/jobs"),
  // A04.2 driver preferences. The PATCH is versioned (expectedVersion) and carries a
  // caller-held Idempotency-Key so a retry after a dropped response replays, never
  // double-writes. Preferences filter the feed and suggest offers; they never bid.
  preferences: () =>
    api<MpDriverPreferences>("GET", "/v1/mp/driver/preferences"),
  patchPreferences: (body: MpDriverPreferencesPatch, idempotencyKey: string) =>
    api<MpDriverPreferences>("PATCH", "/v1/mp/driver/preferences", body, {
      idempotent: true,
      idempotencyKey,
    }),
  // Top-up initiation returns the pending projection; it clears only on the wallet.topup.settled event (never an instant success).
  topup: (presetLabel: string) =>
    api<{ topups: MpTopupRow[] }>("POST", "/v1/wallet/mp/topups", {
      presetLabel,
    }),
};
