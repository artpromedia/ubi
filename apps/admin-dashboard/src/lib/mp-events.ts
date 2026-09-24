/**
 * Marketplace timeline renderers — one entry per outbox event name the
 * ride-service marketplace may write (the closed allowlist in
 * services/ride-service/internal/marketplace/events.go, mirrored by
 * EVENT_NAMES in packages/contracts/src/events.ts). A drift test
 * (__tests__/mp-events.test.ts) reads both files and fails when a name has
 * no renderer here, or a renderer names an event that does not exist.
 *
 * The admin timeline/resolution reads return each event's RAW payload as a
 * JSON string. Nothing here shows that string. Every renderer picks the
 * fields an operator needs and phrases them, so the copy is PII-minimised
 * by construction:
 *
 *   - never a passenger's phone, name or trip-link token (the sealed
 *     envelope and SMS copy are dropped; a link is referenced by its opaque
 *     row id only);
 *   - never coordinates (pickup/dropoff/stop evidence stay out);
 *   - no requester/traveller/booker user ids in the copy (roles are named);
 *   - money only as the server's integer minor units + currency, formatted
 *     by lib/money.ts — no client arithmetic; an amount the event carries
 *     without a currency uses the caller's server-provided currency, or is
 *     shown as "minor units", never guessed.
 *
 * An event with no renderer (a name added after this build) renders as
 * "Unrecognised event" with its field NAMES only — values hidden.
 */
import { formatMinor, formatMinorUnits, isMinorAmount } from "./money";
import { scrubText } from "./redact";

export type EventTone = "info" | "warn" | "ok";

export type EventCategory =
  | "request"
  | "bids"
  | "award"
  | "commission"
  | "queue"
  | "driver"
  | "amendment"
  | "stops"
  | "book_for_later"
  | "preferred_driver"
  | "guest_passenger"
  | "business"
  | "fleet"
  | "execution"
  | "settlement";

export const CATEGORY_LABEL: Record<EventCategory | "unrecognised", string> = {
  request: "Request",
  bids: "Bids",
  award: "Award",
  commission: "Commission",
  queue: "Queue",
  driver: "Driver",
  amendment: "Trip amendment",
  stops: "Stops & waiting",
  book_for_later: "Book for Later",
  preferred_driver: "Preferred driver",
  guest_passenger: "Guest passenger",
  business: "Business trip",
  fleet: "Fleet",
  execution: "Execution",
  settlement: "Settlement",
  unrecognised: "Unrecognised",
};

export type RenderedFact = { label: string; value: string };

export type RenderedTimelineEvent = {
  /** Display time (UTC). */
  at: string;
  /** The server's timestamp, verbatim. */
  atIso: string;
  type: string;
  label: string;
  category: EventCategory | "unrecognised";
  categoryLabel: string;
  tone: EventTone;
  summary: string;
  facts: RenderedFact[];
  /** False when this build has no renderer for the event name. */
  known: boolean;
};

/** Server context for amounts an event carries without a currency. */
export type RenderContext = { currency?: string };

type Payload = Record<string, unknown>;
type Fact = RenderedFact | null;
type Spec = {
  category: EventCategory;
  label: string;
  tone?: EventTone;
  summary: (p: Payload, ctx: RenderContext) => string;
  facts?: (p: Payload, ctx: RenderContext) => Fact[];
};

// ---------------------------------------------------------------------------
// Field readers — each returns undefined for an absent or wrong-typed field,
// so a renderer never prints "undefined" and never trusts a shape.
// ---------------------------------------------------------------------------

const str = (p: Payload, key: string): string | undefined => {
  const v = p[key];
  return typeof v === "string" && v !== "" ? scrubText(v) : undefined;
};
const num = (p: Payload, key: string): number | undefined => {
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
};
const bool = (p: Payload, key: string): boolean | undefined => {
  const v = p[key];
  return typeof v === "boolean" ? v : undefined;
};
const obj = (p: Payload, key: string): Payload | undefined => {
  const v = p[key];
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Payload)
    : undefined;
};

const CODE_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
/** A server reason/state code, humanised ("insufficient_rider_funds" → "insufficient rider funds"). */
const code = (v: unknown): string | undefined => {
  if (typeof v !== "string" || v === "") {
    return undefined;
  }
  return CODE_RE.test(v) ? v.replace(/_/g, " ") : "unrecognised code";
};
const codes = (v: unknown): string | undefined =>
  Array.isArray(v) && v.length > 0
    ? v
        .map(code)
        .filter((c) => c !== undefined)
        .join(", ")
    : undefined;

/** Money field, currency from the payload, else the server context. */
const money = (
  p: Payload,
  key: string,
  ctx: RenderContext,
): string | undefined => {
  const amount = p[key];
  if (!isMinorAmount(amount)) {
    return undefined;
  }
  const currency = typeof p.currency === "string" ? p.currency : ctx.currency;
  return currency ? formatMinor(amount, currency) : formatMinorUnits(amount);
};

/**
 * A money OBJECT field (`{ amountMinor, currency }`, as ride-service's
 * money() helper writes it), falling back to a bare minor amount.
 */
const moneyAt = (
  p: Payload,
  key: string,
  ctx: RenderContext,
): string | undefined => {
  const nested = obj(p, key);
  return nested ? money(nested, "amountMinor", ctx) : money(p, key, ctx);
};

/** The rider's offer, by what the server said about a rematch. */
const choiceOfferText = (rematchAvailable: unknown): string => {
  if (rematchAvailable === true) {
    return "Rider offered a same-fare rematch or a refund";
  }
  if (rematchAvailable === false) {
    return "Rider offered a refund — too late for a rematch";
  }
  return "Rider offered their options on the failed booking";
};

/** "2026-09-23 14:05:09 UTC" from an ISO instant; scrubbed text otherwise. */
export function displayInstant(value: unknown): string | undefined {
  if (typeof value !== "string" || value === "") {
    return undefined;
  }
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) {
    return scrubText(value);
  }
  const iso = at.toISOString();
  return iso.slice(0, 10) + " " + iso.slice(11, 19) + " UTC";
}
const when = (p: Payload, key: string): string | undefined =>
  displayInstant(p[key]);

const duration = (sec: number | undefined): string | undefined => {
  if (sec === undefined || sec < 0) {
    return undefined;
  }
  if (sec < 60) {
    return sec + " s";
  }
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? m + " min" : m + " min " + s + " s";
};

const fact = (label: string, value: string | undefined): Fact =>
  value === undefined ? null : { label, value };

const join = (...parts: (string | undefined | false)[]): string =>
  parts
    .filter((x): x is string => typeof x === "string" && x !== "")
    .join(" · ");

/** "prefix value suffix", or undefined when the value is absent. */
const labelled = (
  prefix: string,
  value: string | undefined,
  suffix = "",
): string | undefined =>
  value === undefined ? undefined : prefix + value + suffix;

const plural = (n: number, one: string, many = one + "s"): string =>
  n + " " + (n === 1 ? one : many);

// ---------------------------------------------------------------------------
// Shared renderers for event families
// ---------------------------------------------------------------------------

const AMENDMENT_KIND: Record<string, string> = {
  route: "Route change",
  stop_waiting: "Paid waiting",
  early_termination: "Early termination",
};

const amendment =
  (verb: string) =>
  (p: Payload, ctx: RenderContext): string => {
    const kind = AMENDMENT_KIND[String(p.kind)] ?? "Trip amendment";
    const prior = money(p, "priorFareMinor", ctx);
    const revised = money(p, "revisedFareMinor", ctx);
    return join(
      kind + " " + verb,
      prior && revised ? "fare " + prior + " → " + revised : undefined,
      p.reason !== undefined ? code(p.reason) : undefined,
    );
  };
const amendmentFacts = (p: Payload, ctx: RenderContext): Fact[] => [
  fact(
    "Incremental commission (linked adjustment, never a second full fee)",
    money(p, "commissionDeltaMinor", ctx),
  ),
  fact("Rider funding top-up", money(p, "riderFundingDeltaMinor", ctx)),
  fact("Agreed fare now", money(p, "agreedFareMinor", ctx)),
  fact("Approved by", code(p.approvedBy)),
  fact(
    "Route / fare revision",
    num(p, "routeRevision") !== undefined
      ? "r" + num(p, "routeRevision") + " / f" + (num(p, "fareRevision") ?? "?")
      : undefined,
  ),
  fact("Proposal expires", when(p, "expiresAt")),
  fact("Compensation", str(p, "compensationId")),
  fact("Amendment", str(p, "amendmentId")),
];

const stopLabel = (p: Payload): string => {
  const order = num(p, "order");
  return order !== undefined ? "Stop " + order : "Stop";
};
const stopFacts = (p: Payload, ctx: RenderContext): Fact[] => [
  fact("Included waiting", duration(num(p, "includedSec"))),
  fact("Paid waiting rate / min", money(p, "perMinMinor", ctx)),
  fact("Authorized waiting cap", money(p, "authorizedCapMinor", ctx)),
  fact("Remaining cap", money(p, "remainingCapMinor", ctx)),
  fact("Accrued waiting", money(p, "accruedMinor", ctx)),
  fact("Excessive after", duration(num(p, "excessiveAfterSec"))),
  fact("Cap revision", num(p, "capRevision")?.toString()),
  fact("Stop", str(p, "stopId")),
];

const scheduledFacts = (p: Payload, ctx: RenderContext): Fact[] => [
  fact(
    "Pickup (local)",
    str(p, "localDate") && str(p, "localTime")
      ? str(p, "localDate") +
          " " +
          str(p, "localTime") +
          (str(p, "timeZone") ? " " + str(p, "timeZone") : "")
      : undefined,
  ),
  fact("Offers publish at", when(p, "publishAt")),
  fact("Occurrence date", str(p, "occurrenceDate")),
  fact("Scheduled request", str(p, "scheduledRequestId")),
  fact("Recurring template", str(p, "templateId")),
  fact("Approved max fare", money(p, "maxFareMinor", ctx)),
  fact("Refreshed min fare", money(p, "refreshedMinMinor", ctx)),
  fact("Refreshed max fare", money(p, "refreshedMaxMinor", ctx)),
];
const scheduled =
  (text: string) =>
  (p: Payload): string =>
    join(
      text,
      p.reason !== undefined ? code(p.reason) : undefined,
      bool(p, "driverSecured") === false ? "no driver secured" : undefined,
    );

const bookingFacts = (p: Payload, ctx: RenderContext): Fact[] => {
  const outcome = obj(p, "financialOutcome");
  return [
    fact("Booking", str(p, "bookingId")),
    fact("Driver", str(p, "driverId")),
    fact("Booking state", code(p.state)),
    fact("Funding state", code(p.fundingState)),
    fact(
      "Pickup window",
      when(p, "windowStart") && when(p, "windowEnd")
        ? when(p, "windowStart") + " – " + when(p, "windowEnd")
        : undefined,
    ),
    fact("Fare", money(p, "fareMinor", ctx)),
    fact(
      "Commission (captured once, at the advance award)",
      money(p, "commissionMinor", ctx),
    ),
    fact(
      "Commission already charged",
      money(p, "commissionAlreadyCharged", ctx),
    ),
    fact("Deadline", when(p, "deadline")),
    fact("Reconfirm deadline", when(p, "reconfirmDeadline")),
    fact("Activation at", when(p, "activationAt")),
    fact("Funding due", when(p, "fundingDueAt")),
    fact(
      "Financial outcome",
      outcome
        ? join(
            outcome.commissionReversed === true
              ? "commission reversed"
              : undefined,
            outcome.riderFundingReleased === true
              ? "rider funding released"
              : undefined,
            outcome.riderCharged === false ? "rider not charged" : undefined,
          ) || undefined
        : undefined,
    ),
    fact("Rematch request", str(p, "rematchRequestId")),
    fact("Risk reasons", codes(p.reasons)),
    fact("Decision deadline", when(p, "decisionDeadline")),
  ];
};
const booking =
  (text: string) =>
  (p: Payload): string =>
    join(text, p.reason !== undefined ? code(p.reason) : undefined);

const templateFacts = (p: Payload): Fact[] => [
  fact("Template", str(p, "templateId")),
  fact(
    "Repeats",
    Array.isArray(p.daysOfWeek) && str(p, "localTime")
      ? (p.daysOfWeek as unknown[]).map(String).join(", ") +
          " at " +
          str(p, "localTime") +
          (str(p, "timeZone") ? " " + str(p, "timeZone") : "")
      : undefined,
  ),
];

const tripLinkRef = (p: Payload): string | undefined => {
  const id = str(p, "tokenId");
  return id ? "link …" + id.slice(-8) : undefined;
};

const businessFacts = (p: Payload, ctx: RenderContext): Fact[] => [
  fact("Organization", str(p, "organizationId")),
  fact("Cost centre", str(p, "costCentreId")),
  fact("Booking ref", str(p, "bookingRef")),
  fact("Budget reservation", str(p, "reservationId")),
  fact("Amount", money(p, "amountMinor", ctx)),
  fact("Reserved", money(p, "reservedMinor", ctx)),
  fact("Ledger entry", str(p, "entryId")),
];

const swapFacts = (p: Payload): Fact[] => [
  fact("Swap", str(p, "swapId")),
  fact("Booking", str(p, "bookingId")),
  fact(
    "Vehicle",
    str(p, "fromVehicleId") && str(p, "toVehicleId")
      ? str(p, "fromVehicleId") + " → " + str(p, "toVehicleId")
      : undefined,
  ),
  fact(
    "Fare",
    bool(p, "fareChanged") === false
      ? "unchanged (commission never re-charged)"
      : undefined,
  ),
  fact("Failure reasons", codes(p.reasons)),
  fact("Expires", when(p, "expiresAt")),
];
const swap = (text: string) => (): string => text;

const occupancyFacts = (p: Payload): Fact[] => [
  fact("Vehicle", str(p, "vehicleId")),
  fact("Kind", code(p.kind)),
  fact("Maintenance", code(p.maintenanceKind)),
  fact(
    "Interval",
    when(p, "startsAt")
      ? when(p, "startsAt") + " – " + (when(p, "endsAt") ?? "open-ended")
      : undefined,
  ),
  fact("Trigger", code(p.trigger)),
  fact("Driver", str(p, "driverId")),
];

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

const SPECS: Record<string, Spec> = {
  // ── Request lifecycle ──
  "mp.request.published": {
    category: "request",
    label: "Request published",
    summary: (p, ctx) =>
      join(
        "Published " +
          (str(p, "service") ?? "request") +
          (str(p, "vehicleClass") ? "/" + str(p, "vehicleClass") : ""),
        money(p, "requestedMinor", ctx)
          ? "asking " + money(p, "requestedMinor", ctx)
          : undefined,
        str(p, "bookingKind")
          ? str(p, "bookingKind") + " booking — no driver secured yet"
          : undefined,
        num(p, "stopCount")
          ? plural(num(p, "stopCount") ?? 0, "stop")
          : undefined,
      ),
    facts: (p) => [
      fact("Revision", num(p, "revision")?.toString()),
      fact("Expires", when(p, "expiresAt")),
      fact(
        "Pickup window",
        when(p, "pickupWindowStart") && when(p, "pickupWindowEnd")
          ? when(p, "pickupWindowStart") + " – " + when(p, "pickupWindowEnd")
          : undefined,
      ),
      fact("Scheduled request", str(p, "scheduledRequestId")),
      fact("Route revision", num(p, "routeRevision")?.toString()),
    ],
  },
  "mp.request.revised": {
    category: "request",
    label: "Request revised",
    summary: (p, ctx) => {
      const env = obj(p, "envelope");
      if (p.envelopeOnly === true && env) {
        return join(
          "Search envelope widened to step " + String(env.step ?? "?"),
          typeof env.radiusMeters === "number"
            ? (env.radiusMeters / 1000).toFixed(1) + " km"
            : undefined,
          typeof env.pickupEtaSec === "number"
            ? duration(env.pickupEtaSec) + " pickup ETA"
            : undefined,
        );
      }
      return join(
        "Requester revised to revision " + String(num(p, "revision") ?? "?"),
        money(p, "requestedMinor", ctx)
          ? "asking " + money(p, "requestedMinor", ctx)
          : undefined,
        bool(p, "routeChanged") ? "route changed" : undefined,
        num(p, "invalidatedBids")
          ? plural(num(p, "invalidatedBids") ?? 0, "live bid") +
              " invalidated (holds released)"
          : undefined,
      );
    },
    facts: (p) => [
      fact("Stops", num(p, "stopCount")?.toString()),
      fact("Route revision", num(p, "routeRevision")?.toString()),
    ],
  },
  "mp.request.closed": {
    category: "request",
    label: "Request closed",
    summary: (p) =>
      join(
        "Closed",
        code(p.reason),
        num(p, "invalidatedBids")
          ? plural(num(p, "invalidatedBids") ?? 0, "live bid") + " invalidated"
          : undefined,
      ),
    facts: (p) => [fact("Advance booking", str(p, "bookingId"))],
  },
  "mp.request.reopened": {
    category: "request",
    label: "Request reopened",
    summary: (p) =>
      join("Reopened to the market after a failed award", code(p.reason)),
    facts: (p) => [fact("Failed award", str(p, "awardId"))],
  },

  // ── Bids ──
  "mp.bid.submitted": {
    category: "bids",
    label: "Bid submitted",
    summary: (p, ctx) =>
      join(
        labelled("Driver bid ", money(p, "amountMinor", ctx)) ??
          "Driver bid submitted",
        labelled("commission reserved ", money(p, "commissionMinor", ctx)),
      ),
    facts: (p) => [
      fact("Driver", str(p, "driverId")),
      fact("Bid", str(p, "bidId")),
      fact("Expires", when(p, "expiresAt")),
      fact("Slot", code(p.slot)),
    ],
  },
  "mp.bid.revised": {
    category: "bids",
    label: "Bid revised",
    summary: (p, ctx) =>
      join(
        labelled("Bid revised to ", money(p, "amountMinor", ctx)) ??
          "Bid revised",
        labelled("commission reserve ", money(p, "commissionMinor", ctx)),
      ),
    facts: (p) => [
      fact("Bid", str(p, "bidId")),
      fact("Bid version", num(p, "bidVersion")?.toString()),
    ],
  },
  "mp.bid.withdrawn": {
    category: "bids",
    label: "Bid withdrawn",
    summary: () => "Driver withdrew the bid; its commission hold is released",
    facts: (p) => [
      fact("Driver", str(p, "driverId")),
      fact("Bid", str(p, "bidId")),
    ],
  },
  "mp.bid.expired": {
    category: "bids",
    label: "Bid expired",
    summary: () => "Bid expired; its commission hold is released",
    facts: (p) => [
      fact("Driver", str(p, "driverId")),
      fact("Bid", str(p, "bidId")),
    ],
  },
  "mp.bid.invalidated": {
    category: "bids",
    label: "Bid invalidated",
    summary: (p) => join("Bid invalidated", code(p.reason)),
    facts: (p) => [
      fact("Driver", str(p, "driverId")),
      fact("Bid", str(p, "bidId")),
    ],
  },
  "mp.bid.lost": {
    category: "bids",
    label: "Bid lost",
    summary: () => "Another offer was selected; this bid's hold is released",
    facts: (p) => [
      fact("Driver", str(p, "driverId")),
      fact("Bid", str(p, "bidId")),
    ],
  },
  "mp.bid.won": {
    category: "bids",
    label: "Bid won",
    summary: () => "Requester selected this offer",
    facts: (p) => [
      fact("Driver", str(p, "driverId")),
      fact("Award", str(p, "awardId")),
    ],
  },

  // ── Award ──
  "mp.award.pending": {
    category: "award",
    label: "Award pending",
    summary: (p, ctx) =>
      join(
        "Award saga started",
        labelled("fare ", money(p, "fareMinor", ctx)),
        labelled(
          "commission ",
          money(p, "commissionMinor", ctx),
          " (captured once, at selection)",
        ),
      ),
    facts: (p) => [
      fact("Award", str(p, "awardId")),
      fact("Driver", str(p, "driverId")),
      fact("Slot", code(p.slot)),
    ],
  },
  "mp.award.confirmed": {
    category: "award",
    label: "Award confirmed",
    summary: (p, ctx) =>
      join(
        "Award confirmed",
        labelled("fare ", money(p, "fareMinor", ctx)),
        labelled("commission ", money(p, "commissionMinor", ctx), " captured"),
      ),
    facts: (p) => [
      fact("Award", str(p, "awardId")),
      fact("Driver", str(p, "driverId")),
      fact("Capture receipt", str(p, "captureReceipt")),
      fact(
        "Execution",
        str(p, "executionService") && str(p, "executionId")
          ? str(p, "executionService") + " " + str(p, "executionId")
          : undefined,
      ),
    ],
  },
  "mp.award.failed": {
    category: "award",
    label: "Award failed",
    summary: (p) =>
      join(
        "Award compensated",
        code(p.reason),
        p.reversed === true && "captured fee reversed (linked entry)",
        p.reversed === false && "fee was never captured",
      ),
    facts: (p) => [
      fact("Award", str(p, "awardId")),
      fact("Driver", str(p, "driverId")),
    ],
  },
  "mp.award.cancelled": {
    category: "award",
    label: "Award cancelled",
    summary: (p, ctx) =>
      join(
        "Award cancelled",
        code(p.reason),
        p.feeReversed === true &&
          (labelled(
            "commission ",
            money(p, "commissionMinor", ctx),
            " reversed (linked entry)",
          ) ??
            "commission reversed (linked entry)"),
      ),
    facts: (p) => [
      fact("Award", str(p, "awardId")),
      fact("Driver", str(p, "driverId")),
      fact("Advance booking", str(p, "bookingId")),
    ],
  },

  // ── Commission ledger names (payment-side; registered for parity) ──
  "mp.commission.reserved": {
    category: "commission",
    label: "Commission reserved",
    summary: (p, ctx) =>
      join(
        "Commission hold reserved",
        money(p, "commissionMinor", ctx) ?? money(p, "amountMinor", ctx),
      ),
  },
  "mp.commission.adjusted": {
    category: "commission",
    label: "Commission adjusted",
    summary: (p, ctx) =>
      join(
        "Commission hold adjusted (linked)",
        money(p, "commissionMinor", ctx) ?? money(p, "amountMinor", ctx),
      ),
  },
  "mp.commission.released": {
    category: "commission",
    label: "Commission released",
    summary: (p, ctx) =>
      join(
        "Commission hold released",
        money(p, "commissionMinor", ctx) ?? money(p, "amountMinor", ctx),
      ),
  },
  "mp.commission.captured": {
    category: "commission",
    label: "Commission captured",
    summary: (p, ctx) =>
      join(
        "Commission captured once",
        money(p, "commissionMinor", ctx) ?? money(p, "amountMinor", ctx),
      ),
  },
  "mp.commission.reversed": {
    category: "commission",
    label: "Commission reversed",
    summary: (p, ctx) =>
      join(
        "Commission reversed (linked entry)",
        money(p, "commissionMinor", ctx) ?? money(p, "amountMinor", ctx),
      ),
  },
  "mp.settlement.posted": {
    category: "settlement",
    label: "Settlement posted",
    summary: (p, ctx) =>
      join("Settlement posted", money(p, "amountMinor", ctx)),
  },

  // ── Queue / claims ──
  "mp.claim.created": {
    category: "queue",
    label: "Slot claimed",
    summary: (p) =>
      join(
        "Driver slot claimed",
        code(p.slot),
        str(p, "source") ? code(p.source) : undefined,
      ),
    facts: (p) => [
      fact("Driver", str(p, "driverId")),
      fact("Claim", str(p, "claimId")),
    ],
  },
  "mp.claim.promoted": {
    category: "queue",
    label: "Queued job promoted",
    summary: () => "Queued job promoted to current (no second commission)",
    facts: (p) => [
      fact("Driver", str(p, "driverId")),
      fact(
        "Execution",
        str(p, "executionService") && str(p, "executionId")
          ? str(p, "executionService") + " " + str(p, "executionId")
          : undefined,
      ),
    ],
  },
  "mp.claim.released": {
    category: "queue",
    label: "Slot released",
    summary: (p) =>
      join("Driver slot released", code(p.reason) ?? code(p.outcome)),
    facts: (p) => [
      fact("Driver", str(p, "driverId")),
      fact("Claim", str(p, "claimId")),
    ],
  },
  "mp.queue.eta_updated": {
    category: "queue",
    label: "Queue ETA updated",
    summary: (p) => {
      const w = obj(p, "pickupWindow");
      return w &&
        typeof w.earliestSec === "number" &&
        typeof w.latestSec === "number"
        ? "Pickup window " +
            duration(w.earliestSec) +
            " – " +
            duration(w.latestSec)
        : "Pickup window updated";
    },
  },
  "mp.queue.window_missed": {
    category: "queue",
    label: "Queue window missed",
    tone: "warn",
    summary: (p) =>
      join(
        "Consented pickup window missed",
        p.feeFreeCancel === true ? "requester may cancel fee-free" : undefined,
      ),
  },

  // ── Driver-owned records ──
  "mp.rate_profile.saved": {
    category: "driver",
    label: "Rate profile saved",
    summary: (p, ctx) =>
      join(
        "Rate profile v" + String(num(p, "version") ?? "?"),
        money(p, "perKmMinor", ctx)
          ? money(p, "perKmMinor", ctx) + "/km"
          : undefined,
        money(p, "minTripMinor", ctx)
          ? "min " + money(p, "minTripMinor", ctx)
          : undefined,
      ),
  },
  "mp.driver_preferences.saved": {
    category: "driver",
    label: "Driver preferences saved",
    summary: (p) =>
      join(
        "Preferences v" + String(num(p, "version") ?? "?"),
        codes(p.changed) ? "changed: " + codes(p.changed) : undefined,
      ),
  },

  // ── Trip amendments (A02) ──
  "mp.amendment.proposed": {
    category: "amendment",
    label: "Amendment proposed",
    tone: "info",
    summary: amendment(
      "proposed — the original agreement stays in force until accepted",
    ),
    facts: amendmentFacts,
  },
  "mp.amendment.awaiting_approvals": {
    category: "amendment",
    label: "Amendment awaiting approvals",
    tone: "info",
    summary: amendment("awaiting approvals"),
    facts: amendmentFacts,
  },
  "mp.amendment.approved": {
    category: "amendment",
    label: "Amendment approved",
    tone: "info",
    summary: amendment("approved"),
    facts: amendmentFacts,
  },
  "mp.amendment.committed": {
    category: "amendment",
    label: "Amendment committed",
    tone: "ok",
    summary: amendment("committed"),
    facts: amendmentFacts,
  },
  "mp.amendment.rejected": {
    category: "amendment",
    label: "Amendment rejected",
    tone: "warn",
    summary: amendment("rejected — the original agreement stands"),
    facts: amendmentFacts,
  },
  "mp.amendment.expired": {
    category: "amendment",
    label: "Amendment expired",
    tone: "warn",
    summary: amendment("expired — the original agreement stands"),
    facts: amendmentFacts,
  },
  "mp.amendment.failed": {
    category: "amendment",
    label: "Amendment failed",
    tone: "warn",
    summary: amendment("failed"),
    facts: amendmentFacts,
  },
  "mp.amendment.compensated": {
    category: "amendment",
    label: "Amendment compensated",
    tone: "warn",
    summary: amendment("compensated — any top-up and linked commission undone"),
    facts: amendmentFacts,
  },
  "mp.trip.terminated_early": {
    category: "amendment",
    label: "Trip ended early",
    tone: "warn",
    summary: (p, ctx) =>
      join(
        "Trip ended early by the " + (code(p.endedBy) ?? "party"),
        code(p.reason),
        money(p, "agreedFareMinor", ctx)
          ? "agreed fare " + money(p, "agreedFareMinor", ctx)
          : undefined,
      ),
    facts: (p) => [
      fact("Amendment", str(p, "amendmentId")),
      fact("Execution", str(p, "executionId")),
    ],
  },
  "ride.terms_amended": {
    category: "execution",
    label: "Ride terms amended",
    summary: (p, ctx) =>
      join(
        (AMENDMENT_KIND[String(p.kind)] ?? "Amendment") +
          " applied to the ride",
        money(p, "fareMinor", ctx)
          ? "fare " + money(p, "fareMinor", ctx)
          : undefined,
        num(p, "stopCount") !== undefined
          ? plural(num(p, "stopCount") ?? 0, "stop")
          : undefined,
      ),
    facts: (p) => [
      fact("Ride", str(p, "rideId")),
      fact(
        "Route / fare revision",
        num(p, "routeRevision") !== undefined
          ? "r" +
              num(p, "routeRevision") +
              " / f" +
              (num(p, "fareRevision") ?? "?")
          : undefined,
      ),
    ],
  },

  // ── Stops & paid waiting (A02) ──
  "mp.stop.arrived": {
    category: "stops",
    label: "Arrived at stop",
    summary: (p) =>
      join(
        stopLabel(p) + ": arrival confirmed",
        num(p, "distanceMeters") !== undefined
          ? num(p, "distanceMeters") + " m from the stop"
          : undefined,
      ),
    facts: stopFacts,
  },
  "mp.stop.arrival_disputed": {
    category: "stops",
    label: "Stop arrival disputed",
    tone: "warn",
    summary: (p) =>
      join(
        stopLabel(p) +
          ": arrival not geofence-confirmed — paid waiting does not start",
        code(p.reason),
      ),
    facts: stopFacts,
  },
  "mp.stop.waiting_started": {
    category: "stops",
    label: "Waiting started",
    summary: (p) =>
      join(
        stopLabel(p) + ": waiting started",
        duration(num(p, "includedSec"))
          ? duration(num(p, "includedSec")) + " included"
          : undefined,
      ),
    facts: stopFacts,
  },
  "mp.stop.allowance_consumed": {
    category: "stops",
    label: "Included waiting used",
    summary: (p) => stopLabel(p) + ": included waiting allowance used",
    facts: stopFacts,
  },
  "mp.stop.paid_waiting_accruing": {
    category: "stops",
    label: "Paid waiting accruing",
    summary: (p, ctx) =>
      join(
        stopLabel(p) + ": paid waiting accruing",
        money(p, "perMinMinor", ctx)
          ? money(p, "perMinMinor", ctx) + "/min"
          : undefined,
      ),
    facts: stopFacts,
  },
  "mp.stop.waiting_approval_required": {
    category: "stops",
    label: "Waiting needs rider approval",
    tone: "warn",
    summary: (p, ctx) =>
      join(
        stopLabel(p) +
          ": authorized waiting cap reached — rider approval required",
        money(p, "authorizedCapMinor", ctx)
          ? "cap " + money(p, "authorizedCapMinor", ctx)
          : undefined,
      ),
    facts: stopFacts,
  },
  "mp.stop.waiting_approved": {
    category: "stops",
    label: "Extra waiting approved",
    summary: (p, ctx) =>
      join(
        stopLabel(p) + ": rider approved more paid waiting",
        money(p, "authorizedCapMinor", ctx)
          ? "cap now " + money(p, "authorizedCapMinor", ctx)
          : undefined,
      ),
    facts: stopFacts,
  },
  "mp.stop.excessive_waiting": {
    category: "stops",
    label: "Excessive waiting",
    tone: "warn",
    summary: (p) =>
      join(
        stopLabel(p) + ": excessive waiting",
        duration(num(p, "waitedSec"))
          ? "waited " + duration(num(p, "waitedSec"))
          : undefined,
      ),
    facts: stopFacts,
  },
  "mp.stop.departed": {
    category: "stops",
    label: "Departed stop",
    summary: (p, ctx) =>
      join(
        stopLabel(p) + ": departed",
        duration(num(p, "waitedSec"))
          ? "waited " + duration(num(p, "waitedSec"))
          : undefined,
        duration(num(p, "paidSec"))
          ? duration(num(p, "paidSec")) + " paid"
          : undefined,
        money(p, "waitingFeeMinor", ctx)
          ? "waiting fee " + money(p, "waitingFeeMinor", ctx)
          : undefined,
      ),
    facts: stopFacts,
  },
  "mp.stop.skipped": {
    category: "stops",
    label: "Stop skipped",
    tone: "warn",
    summary: (p, ctx) =>
      join(
        stopLabel(p) + ": skipped",
        code(p.reason),
        money(p, "waitingFeeMinor", ctx)
          ? "waiting fee " + money(p, "waitingFeeMinor", ctx)
          : undefined,
      ),
    facts: stopFacts,
  },

  // ── Execution ride lifecycle (reused move names) ──
  "ride.requested": {
    category: "execution",
    label: "Execution ride created",
    summary: () => "Execution ride created inside the award transaction",
    facts: (p) => [
      fact("Ride", str(p, "rideId")),
      fact("Award", str(p, "awardId")),
    ],
  },
  "ride.assigned": {
    category: "execution",
    label: "Execution ride assigned",
    summary: (p, ctx) =>
      join(
        "Ride assigned to the awarded driver",
        money(p, "fareMinor", ctx)
          ? "fare " + money(p, "fareMinor", ctx)
          : undefined,
      ),
    facts: (p) => [
      fact("Ride", str(p, "rideId")),
      fact("Driver", str(p, "driverId")),
    ],
  },
  "ride.cancelled_by_driver": {
    category: "execution",
    label: "Ride cancelled (driver)",
    tone: "warn",
    summary: (p) =>
      join(
        "Ride ended in cancelled_by_driver",
        code(p.reasonCode),
        p.repair === true ? "stranded-ride repair by an operator" : undefined,
      ),
    facts: (p) => [
      fact("Ride", str(p, "rideId")),
      fact("Award", str(p, "awardId")),
    ],
  },
  "ride.cancelled_by_rider": {
    category: "execution",
    label: "Ride cancelled (rider side)",
    tone: "warn",
    summary: (p, ctx) =>
      join(
        "Ride ended in cancelled_by_rider",
        code(p.reason),
        isMinorAmount(p.feeMinor)
          ? "fee " + money(p, "feeMinor", ctx)
          : undefined,
      ),
    facts: (p) => [
      fact("Ride", str(p, "rideId")),
      fact("Award", str(p, "awardId")),
    ],
  },

  // ── Book for Later (A03) ──
  "mp.scheduled_request.created": {
    category: "book_for_later",
    label: "Scheduled",
    summary: scheduled("Scheduled request stored — no driver secured"),
    facts: scheduledFacts,
  },
  "mp.scheduled_request.reminder": {
    category: "book_for_later",
    label: "Scheduled reminder",
    summary: scheduled("Reminder sent — still no driver secured"),
    facts: scheduledFacts,
  },
  "mp.scheduled_request.needs_approval": {
    category: "book_for_later",
    label: "Needs rider approval",
    tone: "warn",
    summary: scheduled(
      "Publication paused — terms changed, rider approval needed",
    ),
    facts: scheduledFacts,
  },
  "mp.scheduled_request.reapproved": {
    category: "book_for_later",
    label: "Rider re-approved",
    summary: scheduled("Rider re-approved the refreshed terms"),
    facts: scheduledFacts,
  },
  "mp.scheduled_request.published": {
    category: "book_for_later",
    label: "Scheduled publication",
    summary: (p, ctx) =>
      join(
        "Published to drivers at its lead time",
        str(p, "bookingKind") ? code(p.bookingKind) + " booking" : undefined,
        money(p, "requestedMinor", ctx)
          ? "asking " + money(p, "requestedMinor", ctx)
          : undefined,
      ),
    facts: (p, ctx) => [
      fact("Request", str(p, "requestId")),
      fact(
        "Server fare bounds",
        money(p, "minMinor", ctx) && money(p, "maxMinor", ctx)
          ? money(p, "minMinor", ctx) + " – " + money(p, "maxMinor", ctx)
          : undefined,
      ),
      ...scheduledFacts(p, ctx),
    ],
  },
  "mp.scheduled_request.unfulfilled": {
    category: "book_for_later",
    label: "Scheduled request unfulfilled",
    tone: "warn",
    summary: scheduled("Closed unfulfilled"),
    facts: scheduledFacts,
  },
  "mp.scheduled_request.cancelled": {
    category: "book_for_later",
    label: "Scheduled request cancelled",
    tone: "warn",
    summary: scheduled("Cancelled"),
    facts: scheduledFacts,
  },
  "mp.scheduled_request.skipped": {
    category: "book_for_later",
    label: "Occurrence skipped",
    tone: "warn",
    summary: scheduled("Occurrence skipped"),
    facts: scheduledFacts,
  },
  "mp.scheduled_request.expired": {
    category: "book_for_later",
    label: "Scheduled request expired",
    tone: "warn",
    summary: scheduled("Expired"),
    facts: scheduledFacts,
  },
  "mp.recurring_occurrence.generated": {
    category: "book_for_later",
    label: "Recurring occurrence generated",
    summary: (p) =>
      join(
        "Occurrence generated from a recurring template",
        str(p, "occurrenceDate"),
        "no driver secured",
      ),
    facts: scheduledFacts,
  },
  "mp.advance_booking.held": {
    category: "book_for_later",
    label: "Advance booking held",
    summary: (p, ctx) =>
      join(
        "Driver's calendar held for the advance booking",
        money(p, "fareMinor", ctx)
          ? "fare " + money(p, "fareMinor", ctx)
          : undefined,
        "not yet secured",
      ),
    facts: bookingFacts,
  },
  "mp.advance_booking.confirmed": {
    category: "book_for_later",
    label: "Advance booking confirmed",
    tone: "ok",
    summary: (p) =>
      join(
        "Advance booking confirmed — driver reserved",
        bool(p, "fullySecured") === false
          ? "rider funding still due"
          : "fully secured",
      ),
    facts: bookingFacts,
  },
  "mp.advance_booking.payment_pending": {
    category: "book_for_later",
    label: "Advance booking payment pending",
    tone: "warn",
    summary: () => "Driver reserved; rider funding due before the deadline",
    facts: bookingFacts,
  },
  "mp.advance_booking.funding_secured": {
    category: "book_for_later",
    label: "Advance funding secured",
    tone: "ok",
    summary: (p, ctx) =>
      join("Rider funding secured", money(p, "fareMinor", ctx)),
    facts: bookingFacts,
  },
  "mp.advance_booking.funding_refused": {
    category: "book_for_later",
    label: "Advance funding refused",
    tone: "warn",
    summary: (p) =>
      join(
        "Rider funding refused",
        code(p.code),
        "released at no charge if not fixed by the deadline",
      ),
    facts: bookingFacts,
  },
  "mp.advance_booking.reminder": {
    category: "book_for_later",
    label: "Advance booking reminder",
    summary: (p) =>
      join(
        "Reminder sent",
        duration(num(p, "offsetSec"))
          ? duration(num(p, "offsetSec")) + " before pickup"
          : undefined,
      ),
    facts: bookingFacts,
  },
  "mp.advance_booking.reconfirm_requested": {
    category: "book_for_later",
    label: "Reconfirmation requested",
    summary: () => "Driver asked to reconfirm the advance booking",
    facts: bookingFacts,
  },
  "mp.advance_booking.reconfirmed": {
    category: "book_for_later",
    label: "Driver reconfirmed",
    tone: "ok",
    summary: () => "Driver reconfirmed the advance booking",
    facts: bookingFacts,
  },
  "mp.advance_booking.activated": {
    category: "book_for_later",
    label: "Advance booking activated",
    tone: "ok",
    summary: (p) =>
      join(
        "Activated into the driver's live slots",
        code(p.slot),
        p.commissionChargedAgain === false ? "no second commission" : undefined,
      ),
    facts: bookingFacts,
  },
  "mp.advance_booking.completed": {
    category: "book_for_later",
    label: "Advance booking completed",
    tone: "ok",
    summary: () => "Advance booking completed",
    facts: bookingFacts,
  },
  "mp.advance_booking.failed": {
    category: "book_for_later",
    label: "Advance booking failed",
    tone: "warn",
    summary: (p) =>
      join(
        booking("Advance booking failed")(p),
        p.rematchAvailable === true
          ? "rematch offered to the rider"
          : undefined,
      ),
    facts: bookingFacts,
  },
  // The rider's proactive offer on a booking that failed before activation:
  // a same-fare rematch only when the server said rematchAvailable, else the
  // refund alone. It offers; nothing is republished without the rider.
  "mp.advance_booking.choice_offered": {
    category: "book_for_later",
    label: "Rider offered a choice",
    tone: "warn",
    summary: (p, ctx) =>
      join(
        choiceOfferText(p.rematchAvailable),
        labelled("rematch at ", moneyAt(p, "sameFareMinor", ctx)),
        code(p.reason),
      ),
    facts: (p, ctx) => {
      const refund = obj(p, "refund");
      return [
        ...bookingFacts(p, ctx),
        fact("Options", codes(p.options)),
        fact("Same-fare rematch", moneyAt(p, "sameFareMinor", ctx)),
        fact("Rematch by", when(p, "rematchBy")),
        fact(
          "Refund",
          refund
            ? join(
                refund.riderCharged === false ? "rider not charged" : undefined,
                refund.riderFundingReleased === true
                  ? "funding released"
                  : undefined,
              ) || undefined
            : undefined,
        ),
      ];
    },
  },
  "mp.advance_booking.cancelled": {
    category: "book_for_later",
    label: "Advance booking cancelled",
    tone: "warn",
    summary: booking("Advance booking cancelled"),
    facts: bookingFacts,
  },
  "mp.advance_booking.released": {
    category: "book_for_later",
    label: "Advance booking released",
    tone: "warn",
    summary: booking("Driver's calendar hold released"),
    facts: bookingFacts,
  },
  "mp.advance_booking.rematch_requested": {
    category: "book_for_later",
    label: "Rematch requested",
    summary: (p, ctx) =>
      join(
        "Rider asked for a rematch",
        money(p, "requestedMinor", ctx)
          ? "asking " + money(p, "requestedMinor", ctx)
          : undefined,
      ),
    facts: bookingFacts,
  },
  "mp.advance_booking.rematch_declined": {
    category: "book_for_later",
    label: "Rematch declined",
    tone: "warn",
    summary: (p) =>
      join(
        "Rider chose cancel and release",
        p.riderCharged === false ? "rider not charged" : undefined,
        p.riderFundingReleased === true ? "funding released" : undefined,
      ),
    facts: bookingFacts,
  },
  "mp.advance_booking.risk_changed": {
    category: "fleet",
    label: "Booking risk changed",
    tone: "warn",
    summary: (p) =>
      join("Booking risk now " + (code(p.risk) ?? "unknown"), codes(p.reasons)),
    facts: bookingFacts,
  },
  "mp.recurring_template.created": {
    category: "book_for_later",
    label: "Recurring series created",
    summary: () =>
      "Recurring series created — no occurrence is confirmed by the series itself",
    facts: templateFacts,
  },
  "mp.recurring_template.paused": {
    category: "book_for_later",
    label: "Recurring series paused",
    tone: "warn",
    summary: () => "Recurring series paused",
    facts: templateFacts,
  },
  "mp.recurring_template.resumed": {
    category: "book_for_later",
    label: "Recurring series resumed",
    summary: () => "Recurring series resumed",
    facts: templateFacts,
  },
  "mp.recurring_template.cancelled": {
    category: "book_for_later",
    label: "Recurring series cancelled",
    tone: "warn",
    summary: () => "Recurring series cancelled",
    facts: templateFacts,
  },
  "mp.recurring_template.ended": {
    category: "book_for_later",
    label: "Recurring series ended",
    summary: () => "Recurring series reached its end",
    facts: templateFacts,
  },

  // ── Preferred / saved drivers (A04) ──
  "mp.request.preferred_driver_invited": {
    category: "preferred_driver",
    label: "Preferred driver invited",
    summary: (p) =>
      join(
        "Saved driver invited first",
        duration(num(p, "windowSec"))
          ? duration(num(p, "windowSec")) + " exclusive window"
          : undefined,
      ),
    facts: (p) => [
      fact("Invited driver", str(p, "driverId")),
      fact("Window ends", when(p, "windowEndsAt")),
    ],
  },
  "mp.request.preferred_driver_declined": {
    category: "preferred_driver",
    label: "Preferred driver declined",
    tone: "warn",
    summary: () =>
      "Invited driver declined (free; not counted against standing)",
    facts: (p) => [fact("Driver", str(p, "driverId"))],
  },
  "mp.request.opened_to_market": {
    category: "preferred_driver",
    label: "Opened to the market",
    summary: (p) =>
      join(
        "Preferred driver did not offer — opened to all drivers with the rider's consent",
        code(p.reason),
      ),
    facts: (p) => [fact("New expiry", when(p, "expiresAt"))],
  },
  "mp.favourite_driver.saved": {
    category: "preferred_driver",
    label: "Driver saved",
    summary: () => "Rider saved the driver of a completed trip",
    facts: (p) => [
      fact("Saved driver", str(p, "savedDriverId")),
      fact("Source award", str(p, "sourceAwardId")),
    ],
  },
  "mp.favourite_driver.removed": {
    category: "preferred_driver",
    label: "Saved driver removed",
    summary: () => "Rider removed a saved driver",
    facts: (p) => [fact("Driver", str(p, "savedDriverId"))],
  },

  // ── Guest passenger (A06 part B) — never the phone, name or raw token ──
  "trip_access.issued": {
    category: "guest_passenger",
    label: "Passenger trip link issued",
    summary: (p) =>
      join(
        "Trip link issued to the named passenger by SMS",
        code(p.scope) ? "scope " + code(p.scope) : undefined,
        "phone, name and token are sealed for notification-service only",
      ),
    facts: (p) => [
      fact("Link", tripLinkRef(p)),
      fact("Expires", when(p, "expiresAt")),
    ],
  },
  "trip_access.revoked": {
    category: "guest_passenger",
    label: "Passenger trip link revoked",
    tone: "warn",
    // reason: requester_revoked | reissued (guest.go TripAccess* constants).
    summary: (p) =>
      p.reason === "reissued"
        ? "Trip link replaced — the old link stops working and a new one was issued"
        : join("Trip link revoked", code(p.reason)),
    facts: (p) => [fact("Link", tripLinkRef(p))],
  },
  "trip_access.declined": {
    category: "guest_passenger",
    label: "Passenger declined",
    tone: "warn",
    summary: (p, ctx) =>
      join(
        "Passenger declined the trip before pickup via their link",
        isMinorAmount(p.feeMinor)
          ? "fee " + money(p, "feeMinor", ctx)
          : undefined,
      ),
    facts: (p) => [fact("Link", tripLinkRef(p))],
  },

  // ── Business trips (A06 part C) — organization budget, never the driver's ──
  "business_booking.reserved": {
    category: "business",
    label: "Business budget reserved",
    tone: "ok",
    summary: (p, ctx) =>
      join(
        "Organization budget reserved the awarded fare",
        money(p, "amountMinor", ctx),
      ),
    facts: businessFacts,
  },
  "business_booking.refused": {
    category: "business",
    label: "Business budget refused",
    tone: "warn",
    summary: (p, ctx) =>
      join(
        "Organization refused the reservation — no transport promised, nothing on credit",
        code(p.reason),
        money(p, "amountMinor", ctx),
      ),
    facts: businessFacts,
  },
  "business_booking.committed": {
    category: "business",
    label: "Business budget committed",
    tone: "ok",
    summary: (p, ctx) =>
      join(
        "Actual total committed from the organization budget",
        money(p, "amountMinor", ctx),
        money(p, "reservedMinor", ctx)
          ? "of " + money(p, "reservedMinor", ctx) + " reserved"
          : undefined,
      ),
    facts: businessFacts,
  },
  // A raised total (an amendment) needed more organization budget: the
  // reservation was raised BEFORE the raised total committed.
  "business_booking.reserve_increased": {
    category: "business",
    label: "Business budget raised",
    tone: "ok",
    summary: (p, ctx) =>
      join(
        "Organization reservation raised before a higher total committed",
        moneyAt(p, "previousReserved", ctx) && moneyAt(p, "reserved", ctx)
          ? moneyAt(p, "previousReserved", ctx) +
              " → " +
              moneyAt(p, "reserved", ctx)
          : undefined,
        code(p.reason),
      ),
    facts: (p, ctx) => [
      ...businessFacts(p, ctx),
      fact("Increase", moneyAt(p, "increase", ctx)),
      fact("Previously reserved", moneyAt(p, "previousReserved", ctx)),
      fact("Now reserved", moneyAt(p, "reserved", ctx)),
      fact("Amendment", str(p, "reasonRef")),
    ],
  },
  "business_booking.released": {
    category: "business",
    label: "Business budget released",
    tone: "warn",
    summary: (p, ctx) =>
      join(
        "Reservation released",
        str(p, "party") ? "by the " + code(p.party) : undefined,
        code(p.reason),
        money(p, "amountMinor", ctx),
      ),
    facts: businessFacts,
  },

  // ── Fleet calendar (A05): vehicle swaps and the occupancy ledger ──
  "mp.vehicle_swap.proposed": {
    category: "fleet",
    label: "Vehicle swap proposed",
    summary: swap("Fleet proposed a vehicle swap on the booking"),
    facts: swapFacts,
  },
  "mp.vehicle_swap.driver_accepted": {
    category: "fleet",
    label: "Swap accepted by driver",
    summary: swap("Driver accepted the vehicle swap"),
    facts: swapFacts,
  },
  "mp.vehicle_swap.driver_declined": {
    category: "fleet",
    label: "Swap declined by driver",
    tone: "warn",
    summary: swap("Driver declined the vehicle swap"),
    facts: swapFacts,
  },
  "mp.vehicle_swap.revalidation_failed": {
    category: "fleet",
    label: "Swap revalidation failed",
    tone: "warn",
    summary: (p) => join("New vehicle failed revalidation", codes(p.reasons)),
    facts: swapFacts,
  },
  "mp.vehicle_swap.rider_consent_requested": {
    category: "fleet",
    label: "Swap needs rider consent",
    summary: swap("Rider asked to confirm the new vehicle (or cancel free)"),
    facts: swapFacts,
  },
  "mp.vehicle_swap.applied": {
    category: "fleet",
    label: "Vehicle swap applied",
    tone: "ok",
    summary: swap(
      "Vehicle swap applied — fare unchanged, commission not re-charged",
    ),
    facts: swapFacts,
  },
  "mp.vehicle_swap.rider_declined": {
    category: "fleet",
    label: "Swap declined by rider",
    tone: "warn",
    summary: swap("Rider declined the new vehicle"),
    facts: swapFacts,
  },
  "mp.vehicle_swap.expired": {
    category: "fleet",
    label: "Vehicle swap expired",
    tone: "warn",
    summary: swap("Vehicle swap expired — original vehicle kept"),
    facts: swapFacts,
  },
  "mp.vehicle_swap.cancelled": {
    category: "fleet",
    label: "Vehicle swap cancelled",
    tone: "warn",
    summary: swap("Vehicle swap cancelled — original vehicle kept"),
    facts: swapFacts,
  },
  "vehicle_occupancy.recorded": {
    category: "fleet",
    label: "Vehicle occupancy recorded",
    summary: (p) => join("Vehicle occupied", code(p.kind)),
    facts: occupancyFacts,
  },
  "vehicle_occupancy.released": {
    category: "fleet",
    label: "Vehicle occupancy released",
    summary: (p) => join("Vehicle occupancy released", code(p.kind)),
    facts: occupancyFacts,
  },
  "vehicle_occupancy.moved": {
    category: "fleet",
    label: "Vehicle occupancy moved",
    summary: () =>
      "Booking occupancy moved to another vehicle by an applied swap",
    facts: occupancyFacts,
  },
  "vehicle_occupancy.offroad_use_flagged": {
    category: "fleet",
    label: "Off-road vehicle used",
    tone: "warn",
    summary: (p) =>
      join(
        "Vehicle reported off-road was used during the claimed breakdown",
        code(p.trigger),
      ),
    facts: occupancyFacts,
  },
};

/**
 * What the per-request timeline read cannot show today, named rather than
 * implied: ride-service's outboxTimelineEvents selects `name LIKE 'mp.%'`, so
 * the guest-link (trip_access.*), business-budget (business_booking.*) and
 * execution-ride (ride.*) rows written for a request never reach it — the
 * renderers above are ready for them the moment the read includes them.
 */
export const TIMELINE_COVERAGE_GAPS: readonly string[] = [
  "The request timeline read returns mp.* events only: this request's trip_access.* (guest passenger link issued/revoked/declined), business_booking.* (organization budget reserve/commit/release) and ride.* (execution ride) events are not included — business funding appears as the business_funding stage instead. Needs ride-service's timeline read widened to those families.",
];

/**
 * Renderers written "if present": the fleet availability calendar's booking
 * risk, vehicle swap and occupancy events (A05) were being registered in the
 * catalogs concurrently with this console. The drift test tolerates these
 * names being ABSENT from the catalogs (so either landing order is safe);
 * once present, the forward check still requires a renderer for each.
 */
export const PROVISIONAL_EVENT_NAMES: ReadonlySet<string> = new Set([
  "mp.advance_booking.risk_changed",
  "mp.advance_booking.rematch_declined",
  "mp.vehicle_swap.proposed",
  "mp.vehicle_swap.driver_accepted",
  "mp.vehicle_swap.driver_declined",
  "mp.vehicle_swap.revalidation_failed",
  "mp.vehicle_swap.rider_consent_requested",
  "mp.vehicle_swap.applied",
  "mp.vehicle_swap.rider_declined",
  "mp.vehicle_swap.expired",
  "mp.vehicle_swap.cancelled",
  "vehicle_occupancy.recorded",
  "vehicle_occupancy.released",
  "vehicle_occupancy.moved",
  "vehicle_occupancy.offroad_use_flagged",
]);

/** Every event name this build renders explicitly. */
export const RENDERED_EVENT_NAMES: readonly string[] = Object.keys(SPECS);

export const hasEventRenderer = (name: string): boolean =>
  Object.prototype.hasOwnProperty.call(SPECS, name);

const WARN_RE =
  /fail|expir|withdraw|cancel|closed|invalid|revers|no_offers|lost|declin|refus|skip|disput|missed|revoked|excessive|terminated/;
const OK_RE =
  /confirm|award|captur|won|released|complete|committed|secured|applied|reserved/;
function toneFor(type: string): EventTone {
  if (WARN_RE.test(type)) {
    return "warn";
  }
  return OK_RE.test(type) ? "ok" : "info";
}

function parsePayload(detail: string): Payload | null {
  const trimmed = detail.trim();
  if (!trimmed.startsWith("{")) {
    return null;
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
      ? (parsed as Payload)
      : null;
  } catch {
    return null;
  }
}

/**
 * One raw timeline row ({at, type, detail = raw payload JSON}) → PII-minimised
 * copy. Pure; safe on any input.
 */
export function renderTimelineEvent(
  event: { at: string; type: string; detail: string },
  ctx: RenderContext = {},
): RenderedTimelineEvent {
  const spec = SPECS[event.type];
  const at = displayInstant(event.at) ?? scrubText(event.at);
  const payload = parsePayload(event.detail);
  if (spec === undefined) {
    const fields = payload ? Object.keys(payload).sort() : [];
    return {
      at,
      atIso: event.at,
      type: scrubText(event.type),
      label: "Unrecognised event",
      category: "unrecognised",
      categoryLabel: CATEGORY_LABEL.unrecognised,
      tone: toneFor(event.type),
      summary:
        fields.length > 0
          ? "No renderer in this build — payload fields: " +
            fields.map((f) => scrubText(f)).join(", ") +
            " (values hidden)"
          : "No renderer in this build (payload hidden)",
      facts: [],
      known: false,
    };
  }
  const p = payload ?? {};
  const facts = (spec.facts?.(p, ctx) ?? []).filter(
    (f): f is RenderedFact => f !== null && f.value !== "",
  );
  return {
    at,
    atIso: event.at,
    type: event.type,
    label: spec.label,
    category: spec.category,
    categoryLabel: CATEGORY_LABEL[spec.category],
    tone: spec.tone ?? toneFor(event.type),
    summary:
      payload === null
        ? spec.label + " (payload unreadable)"
        : scrubText(spec.summary(p, ctx)),
    facts: facts.map((f) => ({ label: f.label, value: scrubText(f.value) })),
    known: true,
  };
}

export const renderTimelineEvents = (
  events: readonly { at: string; type: string; detail: string }[],
  ctx: RenderContext = {},
): RenderedTimelineEvent[] => events.map((e) => renderTimelineEvent(e, ctx));
