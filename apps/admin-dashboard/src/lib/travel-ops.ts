/**
 * Travel ops console data layer (contracts/openapi/growth-ops.yaml
 * /v1/ops/travel/*, and the ops-readable itinerary in travel-v2.yaml).
 *
 * Shapes here mirror what travel-service actually answers
 * (services/travel-service/src/ops/ops-travel.ts, src/ops/trips.ts): an
 * exception's money is an object of server {amountMinor, currency} values
 * and its next action a string; provider health is {providers[], …}. Every
 * mapper is pure and fails soft — an unknown kind, action or status renders
 * verbatim and flagged, never crashes the board or gets relabelled.
 *
 * What NO endpoint provides yet is named (TRANSFERS_GAP, ITINERARY_GAPS)
 * rather than approximated: there is no ops-wide airport-transfer list, and
 * the itinerary read has per-order status + charge but no money state,
 * commission or travel margin. There is deliberately no "settle all" here —
 * each order keeps its own ledger, refund rule and audit trail.
 */
import { apiClient } from "./api-client";
import { formatMinorUnits, formatServerMoney, type ServerMoney } from "./money";
import { isBlockedKey, scrubText } from "./redact";

export type ExceptionKind =
  | "pending_ticketing"
  | "unknown_result"
  | "refund_due"
  | "settlement_difference"
  | "provider_uncertain";

export type TravelOpsException = {
  orderId: string;
  supplierRefs?: Record<string, unknown>;
  traveller?: string;
  item?: string;
  kind: ExceptionKind | string;
  state: string;
  since: string;
  money: {
    held?: ServerMoney;
    owed?: ServerMoney;
    difference?: ServerMoney;
  };
  nextAction?: string;
};

export type ProviderHealthRow = {
  supplierId: string;
  kind?: string;
  adapter?: string;
  enabled?: boolean;
  reachable?: boolean;
  liveCallsBlocked?: boolean;
  implemented?: boolean | null;
  operational?: boolean;
  credentialsPresent?: boolean | null;
  reason?: string | null;
  note?: string | null;
  orders?: {
    confirmed: number;
    ticketed: number;
    failed: number;
    unknown: number;
    pending: number;
    total: number;
  };
  successRate?: number | null;
  webhooks?: { total: number; rejected: number };
};

export type ProvidersHealth = {
  providers: ProviderHealthRow[];
  /** Summed across suppliers by the server — it carries no currency. */
  unresolvedSettlementDifferenceMinor?: number;
  generatedAt?: string;
};

/** POST /v1/ops/travel/exceptions/:id/actions — the closed server enum. */
export const EXCEPTION_ACTIONS = [
  "lookup_by_our_ref",
  "escalate",
  "accept_difference",
  "dispute_difference",
  "chase_refund",
] as const;
export type ExceptionAction = (typeof EXCEPTION_ACTIONS)[number];

export type LinkedItem = {
  kind: string;
  orderId?: string;
  transferId?: string;
  reservationId?: string;
  driverSecured?: boolean;
  title: string;
  subtitle?: string;
  status: string;
  charged?: ServerMoney;
  policy?: string | null;
  disruption?: string | null;
  actions?: { key?: string | null; label?: string | null }[];
};

export type TripView = {
  id: string;
  title?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  timezone?: string | null;
  items: LinkedItem[];
};

export const travelOpsApi = {
  exceptions: () =>
    apiClient.get<TravelOpsException[]>("/v1/ops/travel/exceptions"),
  providersHealth: () =>
    apiClient.get<ProvidersHealth>("/v1/ops/travel/providers/health"),
  /** The server takes no idempotency key on these actions (see
   * ACTION_COPY.chase_refund); the key is sent for the audit trail and the
   * board allows one confirmed action in flight at a time. */
  act: (
    orderId: string,
    action: ExceptionAction,
    idempotencyKey: string,
    note?: string,
  ) =>
    apiClient.post<Record<string, unknown>>(
      "/v1/ops/travel/exceptions/" + encodeURIComponent(orderId) + "/actions",
      note ? { action, note } : { action },
      { idempotencyKey },
    ),
  /** Ops-readable itinerary: travel-service lets an ops role read any trip. */
  trip: (tripId: string) =>
    apiClient.get<TripView>("/v1/travel/trips/" + encodeURIComponent(tripId)),
};

// ---------------------------------------------------------------------------
// Exceptions
// ---------------------------------------------------------------------------

export type Tone = "danger" | "warn" | "info" | "neutral";

const KIND: Record<ExceptionKind, { label: string; tone: Tone }> = {
  pending_ticketing: { label: "PNR · NOT TICKETED", tone: "danger" },
  unknown_result: { label: "UNKNOWN · RECONCILING", tone: "warn" },
  provider_uncertain: { label: "PROVIDER UNCERTAIN", tone: "warn" },
  refund_due: { label: "REFUND DUE", tone: "info" },
  settlement_difference: { label: "SETTLEMENT DIFF", tone: "warn" },
};

export const exceptionKind = (
  kind: string,
): { label: string; tone: Tone; known: boolean } => {
  const k = KIND[kind as ExceptionKind];
  return k
    ? { ...k, known: true }
    : { label: kind.toUpperCase(), tone: "neutral", known: false };
};

export type ActionCopy = { label: string; confirm: string };

/** What each action does, stated before the operator confirms it. */
export const ACTION_COPY: Record<ExceptionAction, ActionCopy> = {
  lookup_by_our_ref: {
    label: "Lookup by UBI ref",
    confirm:
      "Reconciles this order with the supplier by OUR reference. It never re-books or re-purchases.",
  },
  escalate: {
    label: "Escalate",
    confirm:
      "Records an escalation on this order's event history. Nothing else changes.",
  },
  accept_difference: {
    label: "Accept difference",
    confirm:
      "Resolves the open settlement difference as accepted (recorded with your operator id).",
  },
  dispute_difference: {
    label: "Dispute difference",
    confirm:
      "Resolves the open settlement difference as disputed (recorded with your operator id).",
  },
  chase_refund: {
    label: "Chase refund",
    confirm:
      "Advances the open refund ONE stage (requested → supplier confirmed → supplier refund pending → refunded to wallet). This action is not idempotent server-side: confirm once.",
  },
};

/** The actions a row offers: those its server `nextAction` names, plus escalate. */
export function allowedActions(e: TravelOpsException): ExceptionAction[] {
  const named = (e.nextAction ?? "")
    .split("|")
    .map((a) => a.trim())
    .filter((a): a is ExceptionAction =>
      (EXCEPTION_ACTIONS as readonly string[]).includes(a),
    );
  return Array.from(new Set<ExceptionAction>([...named, "escalate"]));
}

export type ExceptionRow = {
  key: string;
  orderId: string;
  refs: string;
  item: string;
  kindLabel: string;
  kindTone: Tone;
  kindKnown: boolean;
  state: string;
  since: string;
  money: { label: string; value: string }[];
  waitingOn: string | null;
  actions: ExceptionAction[];
};

const refsLine = (refs?: Record<string, unknown>): string =>
  refs
    ? Object.entries(refs)
        // Supplier refs are PNRs and booking refs; a contact or token key a
        // supplier adapter might add is never shown.
        .filter(([k]) => !isBlockedKey(k))
        .filter(([, v]) => typeof v === "string" || typeof v === "number")
        .map(([k, v]) => k + " " + scrubText(String(v)))
        .join(" · ")
    : "";

export function toExceptionRows(list: TravelOpsException[]): ExceptionRow[] {
  return list.map((e, i) => {
    const kind = exceptionKind(e.kind);
    const actions = allowedActions(e);
    const money: { label: string; value: string }[] = [];
    if (e.money?.held) {
      money.push({ label: "Held", value: formatServerMoney(e.money.held) });
    }
    if (e.money?.owed) {
      money.push({ label: "Owed", value: formatServerMoney(e.money.owed) });
    }
    if (e.money?.difference) {
      money.push({
        label: "Difference",
        value: formatServerMoney(e.money.difference),
      });
    }
    const named = actions.filter((a) => a !== "escalate");
    return {
      key: e.orderId + ":" + e.kind + ":" + i,
      orderId: e.orderId,
      refs: refsLine(e.supplierRefs),
      item: e.item ?? "—",
      kindLabel: kind.label,
      kindTone: kind.tone,
      kindKnown: kind.known,
      state: e.state,
      since: e.since,
      money,
      // A next action that is not a command ("await supplier callback") is
      // what the order is waiting on — shown, not offered as a button.
      waitingOn:
        named.length === 0 && e.nextAction ? scrubText(e.nextAction) : null,
      actions,
    };
  });
}

// ---------------------------------------------------------------------------
// Provider health
// ---------------------------------------------------------------------------

export type ProviderCard = {
  supplierId: string;
  status: string;
  tone: "ok" | "warn" | "neutral";
  lines: string[];
};

function providerStatus(p: ProviderHealthRow): {
  status: string;
  tone: ProviderCard["tone"];
} {
  if (p.enabled === false) {
    return { status: "Disabled", tone: "neutral" };
  }
  if (p.operational) {
    return { status: "Operational", tone: "ok" };
  }
  return {
    status: p.liveCallsBlocked ? "Live calls blocked" : "Not operational",
    tone: "warn",
  };
}

export function toProviderCards(health?: ProvidersHealth): ProviderCard[] {
  return (health?.providers ?? []).map((p) => {
    const { status, tone } = providerStatus(p);
    const lines: string[] = [];
    if (p.kind || p.adapter) {
      lines.push([p.kind, p.adapter].filter(Boolean).join(" · "));
    }
    lines.push(
      p.successRate === null || p.successRate === undefined
        ? "success rate: no orders yet"
        : "success rate " +
            Math.round(p.successRate * 100) +
            "% of " +
            (p.orders?.total ?? 0) +
            " orders",
    );
    if (p.orders && (p.orders.unknown > 0 || p.orders.pending > 0)) {
      lines.push(
        p.orders.unknown + " unknown · " + p.orders.pending + " pending",
      );
    }
    if (p.webhooks && p.webhooks.rejected > 0) {
      lines.push(p.webhooks.rejected + " webhooks rejected (bad signature)");
    }
    if (p.reason) {
      lines.push("reason: " + p.reason.replace(/_/g, " "));
    }
    return {
      supplierId: p.supplierId,
      status,
      tone,
      lines,
    };
  });
}

/** The server sums differences across suppliers without a currency. */
export const settlementDifferenceLine = (health?: ProvidersHealth): string =>
  health?.unresolvedSettlementDifferenceMinor === undefined
    ? "—"
    : formatMinorUnits(health.unresolvedSettlementDifferenceMinor) +
      " (all suppliers; the read carries no currency)";

// ---------------------------------------------------------------------------
// Itinerary (joined orders — separate outcomes, separate money)
// ---------------------------------------------------------------------------

const TRANSFER_STATUS: Record<string, string> = {
  pending_unassigned: "Pending — no driver yet",
  requested: "Requested — no driver secured",
  awarded: "Driver secured (requester-approved award)",
  failed: "Not booked — no driver",
  cancelled: "Cancelled",
};

const ORDER_STATUS: Record<string, string> = {
  supplier_pending: "Supplier pending",
  confirmed: "Confirmed",
  ticketed: "Ticketed",
  completed: "Completed",
  not_booked: "Not booked — released",
  cancelled: "Cancelled",
  refunded: "Refunded",
  not_reserved: "Not reserved (legacy link — never sent to drivers)",
};

const KIND_LABEL: Record<string, string> = {
  flight: "Flight",
  stay: "Stay",
  airport_transfer: "Airport transfer",
  ride_reservation: "Legacy ride link",
  return_flight_placeholder: "Return flight (placeholder)",
};

export type ItineraryRow = {
  key: string;
  ref: string;
  kind: string;
  title: string;
  fulfilment: string;
  /** The item's OWN charge as the server states it — never a total. */
  money: string;
  moneyNote: string | null;
  actionRequired: string | null;
  isTransfer: boolean;
};

function fulfilmentOf(item: LinkedItem): string {
  if (item.kind === "airport_transfer") {
    return TRANSFER_STATUS[item.status] ?? item.status;
  }
  if (item.kind === "flight" && item.status === "confirmed") {
    return "Confirmed — not ticketed yet (a PNR is not a ticket)";
  }
  return ORDER_STATUS[item.status] ?? item.status;
}

function moneyNoteOf(item: LinkedItem): string | null {
  if (item.kind === "airport_transfer") {
    return "No charge on the itinerary — the ride's money is ride-service's (commission only at a requester-approved award).";
  }
  if (item.kind === "ride_reservation") {
    return "Never a marketplace request; nothing held or charged.";
  }
  return item.charged ? "Charged on this order (its own ledger)" : null;
}

function actionRequiredOf(item: LinkedItem): string | null {
  if (item.disruption) {
    return scrubText(item.disruption);
  }
  // For a failed transfer the notice IS the outcome ride-service reported.
  if (
    item.kind === "airport_transfer" &&
    item.status === "failed" &&
    item.policy
  ) {
    return "Outcome: " + scrubText(item.policy);
  }
  return null;
}

export function toItineraryRows(trip?: TripView): ItineraryRow[] {
  return (trip?.items ?? []).map((item, i) => ({
    key: (item.orderId ?? item.transferId ?? item.reservationId ?? "") + i,
    ref: item.orderId ?? item.transferId ?? item.reservationId ?? "—",
    kind: KIND_LABEL[item.kind] ?? item.kind,
    title: scrubText(item.title),
    fulfilment: fulfilmentOf(item),
    money: item.charged ? formatServerMoney(item.charged) : "—",
    moneyNote: moneyNoteOf(item),
    actionRequired: actionRequiredOf(item),
    isTransfer: item.kind === "airport_transfer",
  }));
}

export type NamedGap = {
  title: string;
  detail: string;
  missingEndpoint: string;
};

/** Airport transfers have no ops-wide read: /v1/reservations lists only the
 * CALLER's own transfers (travel-service listTransfers filters by user id). */
export const TRANSFERS_GAP: NamedGap = {
  title: "Airport transfers needing action — not available yet",
  detail:
    "No travel-ops endpoint lists transfers across travellers (action_required, failed with outcome, requested with no driver). GET /v1/reservations answers only the caller's own transfers. A single itinerary's transfers ARE shown below via the trip lookup.",
  missingEndpoint:
    "GET /v1/ops/travel/transfers?state=action_required,failed (travel-service)",
};

/** What the itinerary read does not carry — named, never derived client-side. */
export const ITINERARY_GAPS: readonly NamedGap[] = [
  {
    title: "Per-order money state (authorized / captured / no hold)",
    detail:
      "The trip read gives each order's fulfilment and its charge only. The ledger state per order is not exposed to admin, and this console will not infer it.",
    missingEndpoint: "GET /admin/v1/itineraries/:id?expand=orders",
  },
  {
    title: "Ride commission and travel margin (separately)",
    detail:
      "Neither the driver's 10% commission on a transfer's award nor the disclosed travel margin is on any admin read. They must stay separate figures; this console will not compute either.",
    missingEndpoint: "GET /admin/v1/itineraries/:id?expand=orders",
  },
];
