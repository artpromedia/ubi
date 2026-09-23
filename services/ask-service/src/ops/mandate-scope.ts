/**
 * Mandate scope for unattended marketplace actions (recheck A03 / P02, rule #18).
 *
 * A mandate is a user's standing authorisation for exactly ONE action with hard
 * limits. This module answers two questions, deterministically and from storage
 * alone:
 *
 *   1. Which authority does a grant carry? `authorityFromGrant` reads it off the
 *      PERSISTED grant row: an `assurance = 'mandate'` grant is bound to the
 *      mandate recorded on it at mint (`action_grants.mandate_id`). A caller may
 *      restate that id, but a missing, substituted or smuggled one is refused —
 *      authority is never optional caller metadata.
 *
 *   2. Does the mandate authorise THESE facts? `mandateScopeRefusal` checks, in
 *      order: status (paused / revoked / expired), expiry, the permitted action
 *      for the service, currency, the per-run cap, categories (vehicle classes),
 *      providers and every constraint the mandate carries (city, vehicle class,
 *      time window, pickup/dropoff area, route). A dimension the server cannot
 *      verify against the authoritative request is refused, never assumed.
 *
 * The marketplace actions are NEW mandate actions (`marketplace.ride.select`,
 * `marketplace.delivery.select`, user-service mandates/schemas.ts). A travel
 * mandate — `airport_pickup.reserve`, `flight.rebook_on_cancel`,
 * `scheduled_ride.book` — authorises nothing here: its action is not the one the
 * service requires, and that is checked on every action, not assumed.
 *
 * The period cap and run count are NOT decided here from a read: they are
 * reserved atomically by the canonical allowance function at the commit
 * boundary (./mandate-allowance.ts). `periodHeadroomRefusal` is only an early,
 * advisory read so a mandate that is already exhausted does not mint a grant.
 */
import { ContractError } from "@ubi/contracts";

import type { AskTx } from "./types";

export type MarketplaceService = "ride" | "delivery";

/** The one mandate action that authorises unattended selection per service. */
export const MARKETPLACE_MANDATE_ACTIONS: Readonly<
  Record<MarketplaceService, string>
> = {
  ride: "marketplace.ride.select",
  delivery: "marketplace.delivery.select",
};

// ---------------------------------------------------------------------------
// Authority — derived from the stored grant
// ---------------------------------------------------------------------------

export type GrantAuthority =
  | { readonly kind: "attended" }
  | { readonly kind: "mandate"; readonly mandateId: string };

export interface GrantBinding {
  readonly assurance: string;
  readonly mandateId: string | null;
}

/**
 * The authority a grant carries, read from the grant row. `claimedMandateId` is
 * what a caller said; it is never the source of authority — at most a
 * restatement that must agree with storage.
 */
export function authorityFromGrant(
  grant: GrantBinding,
  claimedMandateId?: string,
): GrantAuthority {
  if (grant.assurance === "mandate") {
    if (grant.mandateId === null || grant.mandateId.length === 0) {
      // A mandate grant with no recorded mandate has no revocable source of
      // authority; nothing may run under it.
      throw new ContractError(
        "forbidden",
        "this authorization is not bound to a mandate",
        { reason: "mandate_binding_missing" },
      );
    }
    if (
      claimedMandateId !== undefined &&
      claimedMandateId !== grant.mandateId
    ) {
      throw new ContractError(
        "forbidden",
        "the mandate does not match this authorization",
        { reason: "mandate_mismatch" },
      );
    }
    return { kind: "mandate", mandateId: grant.mandateId };
  }
  if (grant.mandateId !== null) {
    throw new ContractError(
      "forbidden",
      "this authorization's mandate binding is inconsistent",
      { reason: "mandate_binding_inconsistent" },
    );
  }
  if (claimedMandateId !== undefined) {
    // An attended grant cannot be upgraded to mandate authority (or vice
    // versa) by naming a mandate at execution time.
    throw new ContractError(
      "forbidden",
      "the mandate does not match this authorization",
      { reason: "mandate_mismatch" },
    );
  }
  return { kind: "attended" };
}

// ---------------------------------------------------------------------------
// Scope — does the mandate authorise these facts?
// ---------------------------------------------------------------------------

/** The mandate columns the scope check reads (a `mandates` row). */
export interface MandateRow {
  readonly id: string;
  readonly userId: string;
  readonly action: string;
  readonly status: string;
  readonly expiresAt: Date;
  readonly currency: string;
  readonly perRunCapMinor: bigint;
  readonly periodCapMinor: bigint;
  readonly periodRuns: number;
  readonly categories: readonly string[];
  readonly providers: readonly string[];
  readonly constraints: unknown;
}

export type MandateStage = "authorize" | "prepare" | "select" | "cancel";

/**
 * Server-derived facts about the action being taken. Every field comes from the
 * grant scope (bound into the grant's terms), the authoritative marketplace
 * request/offer, the session city, or the database — never from model output.
 */
export interface MandateFacts {
  readonly actorId: string;
  readonly stage: MandateStage;
  readonly service: MarketplaceService;
  readonly cityId: string;
  /** The city's IANA zone for time windows; null when it is unknown. */
  readonly cityTimezone: string | null;
  readonly currency: string;
  /** The vehicle class being booked; null when the scope allows any. */
  readonly vehicleClass: string | null;
  /** The per-run amount to hold against the cap; null when nothing is spent. */
  readonly amountMinor: number | null;
  /**
   * A verifiable provider identity for the offer. The marketplace discloses no
   * driver or fleet id before award, so this is null today — and a mandate that
   * restricts providers therefore cannot authorise an unattended selection.
   */
  readonly providerRef: string | null;
  readonly at: Date;
}

export interface MandateRefusal {
  readonly code: "forbidden" | "not_found";
  readonly reason: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, string | number>>;
}

/** A refusal raised by the mandate scope, carrying its reason code. */
export class MandateRefusedError extends ContractError {
  constructor(readonly refusal: MandateRefusal) {
    super(refusal.code, refusal.message, {
      reason: refusal.reason,
      ...refusal.details,
    });
    this.name = "MandateRefusedError";
  }
}

/** Constraint keys whose values the server can check (user-service schemas). */
const TYPED_KEYS = new Set([
  "city",
  "vehicle_class",
  "time_window",
  "pickup_area",
  "dropoff_area",
  "route",
]);

interface Constraint {
  readonly key: string;
  readonly mode: string;
  readonly values: readonly string[] | null;
}

/** The modes user-service accepts (mandates/schemas.ts CONSTRAINT_MODES). */
const KNOWN_MODES = new Set(["always_ask", "ask", "allow"]);

/**
 * Reads the mandate's constraints. `null` means "malformed": the scope check
 * then refuses rather than guess what the user meant. Only the legacy EMPTY
 * value (`{}` / null) carries no constraints; any other non-array, and any
 * entry with a mode the server does not know, is malformed — an unknown mode
 * is never read as permission.
 */
function readConstraints(value: unknown): Constraint[] | null {
  if (!Array.isArray(value)) {
    const empty =
      value === null ||
      value === undefined ||
      (typeof value === "object" && Object.keys(value).length === 0);
    return empty ? [] : null;
  }
  const out: Constraint[] = [];
  for (const entry of value as unknown[]) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      return null;
    }
    const { key, mode, values } = entry as {
      key?: unknown;
      mode?: unknown;
      values?: unknown;
    };
    if (
      typeof key !== "string" ||
      typeof mode !== "string" ||
      !KNOWN_MODES.has(mode)
    ) {
      return null;
    }
    if (
      values !== undefined &&
      values !== null &&
      !(
        Array.isArray(values) &&
        (values as unknown[]).every((v) => typeof v === "string")
      )
    ) {
      return null;
    }
    out.push({
      key,
      mode,
      values:
        Array.isArray(values) && values.length > 0
          ? (values as string[])
          : null,
    });
  }
  return out;
}

function minutesOf(hhmm: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
  if (match === null) {
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes past local midnight in `timeZone`, or null if the zone is unknown. */
function localMinutes(at: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(at);
    const hour = Number(parts.find((p) => p.type === "hour")?.value);
    const minute = Number(parts.find((p) => p.type === "minute")?.value);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      return null;
    }
    return hour * 60 + minute;
  } catch {
    return null;
  }
}

/** True when `minutes` falls in `HH:MM-HH:MM` (end exclusive; may wrap midnight). */
function inWindow(minutes: number, window: string): boolean | null {
  const [from, to] = window.split("-");
  const start = from === undefined ? null : minutesOf(from);
  const end = to === undefined ? null : minutesOf(to);
  if (start === null || end === null || start === end) {
    return null;
  }
  return start < end
    ? minutes >= start && minutes < end
    : minutes >= start || minutes < end;
}

type Observation =
  | { readonly kind: "unverifiable" }
  | { readonly kind: "match"; readonly matches: boolean };

/** Observes one typed dimension against the constraint's permitted values. */
function observe(
  key: string,
  values: readonly string[],
  facts: MandateFacts,
): Observation {
  switch (key) {
    case "city":
      return { kind: "match", matches: values.includes(facts.cityId) };
    case "vehicle_class":
      return facts.vehicleClass === null
        ? { kind: "unverifiable" }
        : { kind: "match", matches: values.includes(facts.vehicleClass) };
    case "time_window": {
      const minutes =
        facts.cityTimezone === null
          ? null
          : localMinutes(facts.at, facts.cityTimezone);
      if (minutes === null) {
        return { kind: "unverifiable" };
      }
      let matched = false;
      for (const window of values) {
        const hit = inWindow(minutes, window);
        if (hit === null) {
          return { kind: "unverifiable" };
        }
        matched = matched || hit;
      }
      return { kind: "match", matches: matched };
    }
    default:
      // pickup_area / dropoff_area / route: the authoritative marketplace
      // request the assistant sees carries no geometry to check them against.
      return { kind: "unverifiable" };
  }
}

function refusal(
  reason: string,
  message: string,
  details?: Readonly<Record<string, string | number>>,
): MandateRefusal {
  return { code: "forbidden", reason, message, details };
}

function constraintRefusal(
  facts: MandateFacts,
  mandate: MandateRow,
): MandateRefusal | null {
  const constraints = readConstraints(mandate.constraints);
  if (constraints === null) {
    return refusal(
      "mandate_constraint_unverifiable",
      "this mandate's constraints cannot be read; confirm this one yourself",
    );
  }
  for (const constraint of constraints) {
    const asks = constraint.mode === "ask" || constraint.mode === "always_ask";
    if (!TYPED_KEYS.has(constraint.key)) {
      // A free-form condition the marketplace cannot observe: an `allow`
      // grants nothing to check; an `ask` must go to the human.
      if (asks) {
        return refusal(
          "mandate_constraint_ask",
          "this mandate asks you to confirm this kind of booking yourself",
          { key: constraint.key },
        );
      }
      continue;
    }
    if (constraint.values === null) {
      if (asks) {
        return refusal(
          "mandate_constraint_ask",
          "this mandate asks you to confirm this kind of booking yourself",
          { key: constraint.key },
        );
      }
      continue;
    }
    const seen = observe(constraint.key, constraint.values, facts);
    if (seen.kind === "unverifiable") {
      return refusal(
        "mandate_constraint_unverifiable",
        "a mandate constraint cannot be checked for this booking",
        { key: constraint.key },
      );
    }
    if (!seen.matches) {
      return asks
        ? refusal(
            "mandate_constraint_ask",
            "this booking is outside what the mandate allows without asking you",
            { key: constraint.key },
          )
        : refusal(
            "mandate_constraint_violation",
            "this booking is outside the mandate's limits",
            { key: constraint.key },
          );
    }
  }
  return null;
}

/**
 * Null when the mandate authorises `facts`; otherwise the first refusal. Pure:
 * the caller loads the row (under a lock at the commit boundary) and decides
 * what to do with the answer.
 */
export function mandateScopeRefusal(
  mandate: MandateRow | null,
  facts: MandateFacts,
): MandateRefusal | null {
  if (mandate === null || mandate.userId !== facts.actorId) {
    return {
      code: "not_found",
      reason: "mandate_not_found",
      message: "no such mandate",
    };
  }
  if (mandate.status !== "active") {
    return refusal(
      `mandate_${mandate.status}`,
      `this mandate is ${mandate.status} and cannot authorise an action`,
    );
  }
  if (mandate.expiresAt.getTime() <= facts.at.getTime()) {
    return refusal("mandate_expired", "this mandate has expired");
  }
  const required = MARKETPLACE_MANDATE_ACTIONS[facts.service];
  if (mandate.action !== required) {
    // A travel mandate (or the other service's) is never marketplace authority.
    return refusal(
      "mandate_action_not_permitted",
      "this mandate does not authorise marketplace selection for this service",
      { mandateAction: mandate.action, requiredAction: required },
    );
  }
  if (facts.stage === "cancel") {
    // Cancelling releases a request and spends nothing: a live, owned mandate
    // of the right action is all it needs.
    return null;
  }
  if (mandate.currency !== facts.currency) {
    return refusal(
      "mandate_currency_mismatch",
      "this mandate does not cover that currency",
    );
  }
  if (
    facts.amountMinor !== null &&
    facts.amountMinor > Number(mandate.perRunCapMinor)
  ) {
    return refusal(
      "mandate_cap_exceeded",
      "the amount exceeds the mandate's per-run cap",
      { perRunCapMinor: Number(mandate.perRunCapMinor) },
    );
  }
  // Categories are the vehicle classes the mandate may book. The contract
  // requires at least one; an empty list permits none, and a scope that allows
  // "any class" is wider than any list.
  if (
    facts.vehicleClass === null ||
    !mandate.categories.includes(facts.vehicleClass)
  ) {
    return refusal(
      "mandate_category_not_permitted",
      "this mandate does not cover that vehicle class",
    );
  }
  if (
    mandate.providers.length > 0 &&
    (facts.providerRef === null ||
      !mandate.providers.includes(facts.providerRef))
  ) {
    return refusal(
      facts.providerRef === null
        ? "mandate_provider_unverifiable"
        : "mandate_provider_not_permitted",
      "this mandate is limited to providers that cannot be confirmed for this offer",
    );
  }
  return constraintRefusal(facts, mandate);
}

/** Throws the refusal, if any. */
export function assertMandateScope(
  mandate: MandateRow | null,
  facts: MandateFacts,
): void {
  const refused = mandateScopeRefusal(mandate, facts);
  if (refused !== null) {
    throw new MandateRefusedError(refused);
  }
}

/** UTC first-of-month — the allowance period, as user-service defines it. */
export function periodStartOf(at: Date): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
}

/**
 * An EARLY, advisory read of the period headroom so an exhausted mandate does
 * not mint a grant or publish a request. It decides nothing binding: the
 * reservation at the commit boundary re-checks atomically.
 */
export async function periodHeadroomRefusal(
  tx: AskTx,
  mandate: MandateRow,
  amountMinor: number,
  at: Date,
): Promise<MandateRefusal | null> {
  const allowance = await tx.mandateAllowance.findUnique({
    where: {
      mandateId_periodStart: {
        mandateId: mandate.id,
        periodStart: periodStartOf(at),
      },
    },
  });
  const runsUsed = allowance?.runsUsed ?? 0;
  const amountUsed = Number(allowance?.amountUsedMinor ?? 0n);
  if (
    runsUsed + 1 > mandate.periodRuns ||
    amountUsed + amountMinor > Number(mandate.periodCapMinor)
  ) {
    return refusal(
      "mandate_allowance_exhausted",
      "this mandate's allowance for the period is used up",
      {
        periodRuns: mandate.periodRuns,
        periodCapMinor: Number(mandate.periodCapMinor),
      },
    );
  }
  return null;
}

/** The IANA zone of a city, for time-window constraints. */
export async function cityTimezone(
  tx: AskTx,
  cityId: string,
): Promise<string | null> {
  const city = await tx.city.findUnique({
    where: { id: cityId },
    select: { timezone: true },
  });
  return city?.timezone ?? null;
}
