// Plain-language copy for the rider-confidence surfaces (A06 A–D, A04 item 3): the preferred
// driver window and its honest outcome, the guest passenger's trip link, service needs, and
// organization billing. Everything here turns SERVER values (states, codes, `details.reason`)
// into words — no amount is computed, and each state keeps its own distinct sentence.
import { ApiError } from "@ubi/mobile-core";
import type {
  MpPreferredDriver,
  MpRequest,
  MpRequestBusiness,
  MpRequestPassenger,
} from "@ubi/contracts";
import {
  errorDetail,
  errorReason,
  isOffline,
  refusalFor,
  whenLabel,
  type Refusal,
  type StatusWord,
} from "./riderCopy";

// ── Preferred driver (A04 item 3) ──────────────────────────────────────────

/** The saved driver's window on the rider's request, and what happens when it ends. */
export function preferredWindowCopy(p: MpPreferredDriver): {
  title: string;
  body: string;
  tone: "info" | "warn";
} {
  const after = p.fallbackToMarket
    ? "If they don’t offer by then, your request opens to every eligible driver under the same fare rules — you agreed to that."
    : "If they don’t offer by then, your request closes free of charge — you chose not to open it to other drivers.";
  switch (p.state) {
    case "exclusive":
      return {
        title: "Asking your saved driver first",
        body:
          p.label +
          " Until " +
          whenLabel(p.windowEndsAt) +
          ". " +
          after +
          " Asking first never guarantees they’re available.",
        tone: "info",
      };
    case "market_open":
      return {
        title: "Now open to all drivers",
        body:
          p.label +
          " Your saved driver didn’t offer in their window, so — as you agreed — every eligible driver can offer now.",
        tone: "info",
      };
    case "closed":
      return {
        title: "Your saved driver’s window has ended",
        body: p.label,
        tone: "warn",
      };
  }
}

/** Why a closed request ended, for the reasons A06/A04 added (null for the others). */
export function closedOutcomeOf(
  r: Pick<MpRequest, "closeReason">,
): { title: string; body: string } | null {
  switch (r.closeReason) {
    case "preferred_driver_unavailable":
      return {
        title: "Your saved driver didn’t offer in time",
        body: "Your request closed without any charge, because you chose not to open it to other drivers. UBI doesn’t say whether they declined or were busy. You can send a new request to every driver.",
      };
    case "passenger_declined":
      return {
        title: "Your passenger declined this trip",
        body: "They declined through their trip link before pickup. Nothing was charged to you and the request is closed.",
      };
    default:
      return null;
  }
}

// ── Book for another adult (A06 part B) ────────────────────────────────────

export const MINORS_COPY =
  "UBI can’t book a ride for a child travelling alone — that needs a separate service UBI doesn’t offer. Book only for an adult who agreed to it.";

/** The passenger's trip link, as the requester sees it (never the link itself). */
export function passengerLinkStatus(p: MpRequestPassenger): StatusWord {
  switch (p.accessStatus) {
    case "active":
      return { label: "Trip link sent · active", tone: "ok" };
    case "revoked":
      return { label: "Trip link withdrawn", tone: "neutral" };
    case "expired":
      return { label: "Trip link expired", tone: "neutral" };
    case "declined":
      return { label: "Passenger declined the trip", tone: "warn" };
  }
}

/** A refused guest booking or link action, in plain words. */
export function guestRefusal(e: unknown): Refusal | null {
  if (isOffline(e)) return null;
  switch (errorReason(e)) {
    case "unaccompanied_minor_not_supported":
      return { title: "Adults only", body: MINORS_COPY };
    case "passenger_attestation_required":
      return {
        title: "Confirm the passenger is an adult",
        body: "Booking for someone else needs your confirmation that they are 18 or over.",
      };
    case "passenger_consent_required":
      return {
        title: "Confirm they agreed",
        body: "Booking for someone else needs your confirmation that they agreed to the ride and to a text from UBI with their trip link.",
      };
    case "trip_link_delivery_unavailable":
      return {
        title: "Can’t send a trip link right now",
        body: "UBI can’t text trip links at the moment, so booking for someone else is paused. Booking for yourself still works. Nothing was booked.",
      };
    case "trip_link_limit":
      return {
        title: "Link already sent 5 times",
        body: "This trip’s link can’t be sent again. If your passenger still can’t open it, contact support.",
      };
    case "passenger_declined":
      return {
        title: "Your passenger declined",
        body: "They declined this trip, so no new link can be sent.",
      };
  }
  return null;
}

// ── Service needs (A06 part D) ─────────────────────────────────────────────

/** 409 service_need_unavailable on publish: each requirement and the server's fallback. */
export function serviceNeedRefusal(e: unknown): Refusal | null {
  if (errorReason(e) !== "service_need_unavailable") return null;
  // ride-service ServiceRequirementView: { code, title, availability, detail }.
  const items =
    errorDetail<{ code?: string; title?: string; detail?: string }[]>(
      e,
      "requirements",
    ) ?? [];
  const fallback = errorDetail<string>(e, "fallback");
  const lines = items
    .map((i) => [i.title ?? i.code, i.detail].filter(Boolean).join(": "))
    .filter(Boolean);
  return {
    title: "Not available in this area",
    body:
      (lines.length
        ? lines.join(" ")
        : "A requirement you chose has no verified supply here.") +
      " " +
      (fallback ?? "Nothing was sent to drivers."),
  };
}

// ── Organization billing (A06 part C) ──────────────────────────────────────

/** payment-service BUSINESS_REFUSAL_REASONS (+ ride-service's own) in plain words. */
export const BUSINESS_REASON_TEXT: Record<string, string> = {
  feature_disabled: "Business travel isn’t available in this city.",
  organization_not_active: "This organization isn’t active right now.",
  booker_not_authorized: "You can’t book on this organization.",
  traveller_not_member:
    "The traveller isn’t an active member of this organization.",
  cost_centre_invalid: "That cost centre can’t be used for this trip.",
  service_not_allowed:
    "The organization’s travel policy doesn’t allow this service.",
  class_not_allowed:
    "The organization’s travel policy doesn’t allow this vehicle class.",
  trip_cap_exceeded: "This fare is over the organization’s limit per trip.",
  currency_mismatch: "This trip’s currency isn’t the organization’s currency.",
  no_budget_for_period:
    "There is no budget on this cost centre for this month.",
  budget_insufficient:
    "There isn’t enough budget left on this cost centre for this fare.",
  business_payment_method:
    "A business booking is paid by the organization only.",
  business_passenger_required:
    "Booking a colleague also needs their name and phone for the trip link.",
  business_check_unavailable:
    "The organization’s policy couldn’t be checked right now. Nothing was booked.",
  business_budget_topup_unavailable:
    "The organization’s budget can’t cover a higher fare on this trip.",
};

export const businessReasonText = (reason: string) =>
  BUSINESS_REASON_TEXT[reason] ?? reason.replace(/_/g, " ");

/** A refused business publish, stated plainly (null when it isn't a business refusal). */
export function businessRefusal(e: unknown): Refusal | null {
  if (!(e instanceof ApiError)) return null;
  const reason = errorReason(e);
  if (!reason || !(reason in BUSINESS_REASON_TEXT)) return null;
  const over =
    reason === "no_budget_for_period" || reason === "budget_insufficient";
  return {
    title: over ? "No budget for this trip" : "Outside the travel policy",
    body:
      BUSINESS_REASON_TEXT[reason] +
      (over
        ? " UBI never books a business trip on credit. Pay personally, or ask an admin to add budget."
        : ""),
  };
}

/** Where the organization's funding of a business request stands. */
export function businessFundingText(b: MpRequestBusiness): string {
  const f = b.funding;
  if (!f)
    return "The organization’s budget is reserved only when you choose an offer — never before.";
  switch (f.state) {
    case "reserving":
      return "Reserving the organization’s budget for this trip…";
    case "reserved":
      return "Organization budget reserved for this trip.";
    case "committed":
      return "Charged to the organization’s budget.";
    case "refused":
      return (
        "The organization’s budget refused this trip" +
        (f.refusalReason ? ": " + businessReasonText(f.refusalReason) : ".")
      );
    case "released":
      return "The organization’s budget was released — nothing was charged to it.";
  }
}

/** Any publish refusal from the rider-confidence additions, else the generic mapping. */
export function publishRefusal(e: unknown): Refusal {
  return (
    serviceNeedRefusal(e) ??
    guestRefusal(e) ??
    businessRefusal(e) ??
    (errorReason(e) === "preferred_driver_unavailable"
      ? {
          title: "That driver can’t be asked first right now",
          body: "Your saved driver isn’t taking requests to them first at the moment. Send your request to every driver instead, or try later.",
        }
      : refusalFor(e))
  );
}
