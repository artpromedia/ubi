/**
 * The marketplace timeline renderers (lib/mp-events.ts), checked against the
 * REAL closed event catalogs — ride-service's outbox allowlist
 * (services/ride-service/internal/marketplace/events.go) and the contract's
 * EVENT_NAMES (packages/contracts/src/events.ts), read from the repo — so an
 * event added without an operator renderer, or a renderer for a name that
 * does not exist, fails here. Payloads mirror what ride-service writes
 * (writeAmendmentEvent, writeStopEvent, writeBookingEvent,
 * writeScheduledEvent, writeBusinessTransition, guest.go, fleet_swaps.go).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PROVISIONAL_EVENT_NAMES,
  RENDERED_EVENT_NAMES,
  TIMELINE_COVERAGE_GAPS,
  hasEventRenderer,
  renderTimelineEvent,
  renderTimelineEvents,
} from "../mp-events";

const repo = resolve(__dirname, "../../../../..");

/** Names in ride-service's `var eventNames = map[string]struct{}{ … }`. */
function goAllowlist(): string[] {
  const src = readFileSync(
    resolve(repo, "services/ride-service/internal/marketplace/events.go"),
    "utf8",
  );
  const start = src.indexOf("var eventNames = map[string]struct{}{");
  const end = src.indexOf("\n}\n", start);
  expect(start).toBeGreaterThan(-1);
  const block = src.slice(start, end);
  return Array.from(block.matchAll(/"([a-z_]+(?:\.[a-z_]+)+)":\s*\{\}/g)).map(
    (m) => m[1] as string,
  );
}

/** Names in the contract's `export const EVENT_NAMES = [ … ] as const`. */
function contractEventNames(): Set<string> {
  const src = readFileSync(
    resolve(repo, "packages/contracts/src/events.ts"),
    "utf8",
  );
  const start = src.indexOf("export const EVENT_NAMES = [");
  const end = src.indexOf("] as const;", start);
  expect(start).toBeGreaterThan(-1);
  return new Set(
    Array.from(
      src.slice(start, end).matchAll(/"([a-z_]+(?:\.[a-z_]+)+)"/g),
    ).map((m) => m[1] as string),
  );
}

const ev = (
  type: string,
  payload: Record<string, unknown>,
  at = "2026-09-23T09:15:00Z",
) =>
  renderTimelineEvent(
    { at, type, detail: JSON.stringify(payload) },
    { currency: "NGN" },
  );

/** Everything an operator can read of a rendered event. */
const visible = (e: ReturnType<typeof renderTimelineEvent>): string =>
  [
    e.label,
    e.summary,
    e.type,
    ...e.facts.flatMap((f) => [f.label, f.value]),
  ].join("\n");

describe("renderer coverage — closed catalogs", () => {
  const allow = goAllowlist();

  it("reads a non-trivial allowlist from ride-service", () => {
    expect(allow.length).toBeGreaterThan(80);
    expect(allow).toContain("mp.amendment.committed");
    expect(allow).toContain("trip_access.issued");
    expect(allow).toContain("business_booking.reserved");
  });

  it("has an explicit renderer for EVERY event ride-service may write", () => {
    const missing = allow.filter((name) => !hasEventRenderer(name));
    expect(missing).toEqual([]);
  });

  it("renders no name ride-service cannot write, and every name is a contract event", () => {
    const allowSet = new Set(allow);
    const contract = contractEventNames();
    // Fleet-calendar names are rendered "if present" (PROVISIONAL): absent
    // from the catalogs is tolerated; present means the forward check above
    // already required their renderer.
    const settled = RENDERED_EVENT_NAMES.filter(
      (n) => !PROVISIONAL_EVENT_NAMES.has(n),
    );
    expect(settled.filter((n) => !allowSet.has(n))).toEqual([]);
    expect(settled.filter((n) => !contract.has(n))).toEqual([]);
    for (const n of PROVISIONAL_EVENT_NAMES) {
      expect(hasEventRenderer(n), n).toBe(true);
      // present in one catalog ⇒ present in both (no half-registered name)
      expect(allowSet.has(n), n).toBe(contract.has(n));
    }
  });

  it("every allowlisted event renders known, labelled copy even with an empty payload", () => {
    for (const name of allow) {
      const e = ev(name, {});
      expect(e.known, name).toBe(true);
      expect(e.label.length, name).toBeGreaterThan(0);
      expect(e.summary, name).not.toContain("undefined");
      expect(e.summary, name).not.toContain("NaN");
      expect(e.summary, name).not.toMatch(/ {2}|· ·|·\s*$|^\s*·| — $/);
      expect(e.categoryLabel, name).not.toBe("Unrecognised");
    }
  });
});

describe("PII minimisation", () => {
  const PHONE = "+2348031234567";
  const TOKEN = "uta_" + "Zk3v9QxPp2LmT8wYbN4cR7sD1fGhJ6kE0aVuWiXoYzA";

  it("never shows the passenger's phone, name, raw link token or sealed envelope", () => {
    const issued = ev("trip_access.issued", {
      tokenId: "5b1f0d2e-8c33-4d9e-9a1b-7c6d5e4f3a21",
      requestId: "req-1",
      scope: "passenger_trip",
      expiresAt: "2026-09-23T18:00:00Z",
      recipient: { channel: "sms", phone: PHONE },
      smsCopy: "Hi Adaeze, your ride: https://ubi.africa/t/" + TOKEN,
      sealed: { iv: "aaa", ct: TOKEN + "Q", tag: "bbb" },
      firstName: "Adaeze",
      phone: PHONE,
    });
    const text = visible(issued);
    expect(text).not.toContain(PHONE);
    expect(text).not.toContain("8031234567");
    expect(text).not.toContain(TOKEN.slice(4));
    expect(text).not.toContain("Adaeze");
    expect(text).not.toContain("sealed\n");
    expect(issued.summary).toContain("Trip link issued");
    // the link is referenced by its opaque row id tail only
    expect(issued.facts).toContainEqual({
      label: "Link",
      value: "link …5e4f3a21",
    });
  });

  it("scrubs a phone or token that leaks into ANY rendered string field", () => {
    const e = ev("mp.request.closed", { reason: PHONE, requestId: "r" });
    expect(visible(e)).not.toContain(PHONE);
    const e2 = ev("mp.claim.created", { source: TOKEN, driverId: TOKEN });
    // neither the token nor its body survives humanising or display
    expect(visible(e2)).not.toContain(TOKEN.slice(4));
    expect(visible(e2)).not.toContain(TOKEN.slice(4).slice(0, 16));
  });

  it("never shows coordinates or stop-arrival evidence positions", () => {
    const early = ev("mp.trip.terminated_early", {
      endedBy: "rider",
      reason: "passenger_unwell",
      agreedFareMinor: 420_000,
      currency: "NGN",
      dropoff: { lat: 6.4541, lng: 3.3947 },
    });
    expect(visible(early)).not.toMatch(/6\.4541|3\.3947/);
    expect(early.summary).toContain("₦4,200.00");
    const amended = ev("ride.terms_amended", {
      kind: "route",
      fareMinor: 575_000,
      currency: "NGN",
      stopCount: 2,
      dropoff: { lat: 6.5, lng: 3.4 },
    });
    expect(visible(amended)).not.toMatch(/"lat"|6\.5\b|3\.4\b/);
  });

  it("does not name the requester, booker or traveller user ids", () => {
    const e = ev("business_booking.reserved", {
      awardId: "a",
      requestId: "r",
      bookingRef: "BK-1",
      organizationId: "org_77",
      bookerId: "booker-user-uuid",
      travellerId: "traveller-user-uuid",
      reservationId: "res-9",
      costCentreId: "cc_ops",
      amountMinor: 900_000,
      currency: "NGN",
    });
    const text = visible(e);
    expect(text).not.toContain("booker-user-uuid");
    expect(text).not.toContain("traveller-user-uuid");
    expect(text).toContain("org_77");
    expect(text).toContain("cc_ops");
  });

  it("renders an event this build does not know with field names only, values hidden", () => {
    const e = renderTimelineEvent({
      at: "2026-09-23T09:15:00Z",
      type: "mp.future.thing",
      detail: JSON.stringify({ phone: PHONE, secretSauce: "x1" }),
    });
    expect(e.known).toBe(false);
    expect(e.label).toBe("Unrecognised event");
    expect(e.summary).toContain("phone, secretSauce");
    expect(visible(e)).not.toContain(PHONE);
    expect(visible(e)).not.toContain("x1");
  });

  it("never renders the raw JSON payload", () => {
    for (const name of goAllowlist()) {
      const e = ev(name, { requestId: "req-1", zzUnusedField: "leak-me" });
      expect(visible(e), name).not.toContain("leak-me");
      expect(visible(e), name).not.toContain('{"');
    }
  });
});

describe("money — server amounts only", () => {
  it("formats amendment money from the server's minor-unit fields and names the linked commission", () => {
    const e = ev("mp.amendment.approved", {
      amendmentId: "am-1",
      kind: "stop_waiting",
      state: "approved",
      priorFareMinor: 600_000,
      revisedFareMinor: 612_345,
      commissionDeltaMinor: 1_235,
      riderFundingDeltaMinor: 12_345,
      currency: "NGN",
      approvedBy: "rider",
    });
    expect(e.summary).toBe(
      "Paid waiting approved · fare ₦6,000.00 → ₦6,123.45",
    );
    expect(e.facts).toContainEqual({
      label:
        "Incremental commission (linked adjustment, never a second full fee)",
      value: "₦12.35",
    });
    expect(e.facts).toContainEqual({
      label: "Rider funding top-up",
      value: "₦123.45",
    });
  });

  it("uses the payload's own currency over the context, and never assumes one", () => {
    const kes = renderTimelineEvent(
      {
        at: "2026-09-23T09:15:00Z",
        type: "business_booking.committed",
        detail: JSON.stringify({
          amountMinor: 250_050,
          reservedMinor: 300_000,
          currency: "KES",
        }),
      },
      { currency: "NGN" },
    );
    expect(kes.summary).toContain("KSh 2,500.50");
    expect(kes.summary).toContain("KSh 3,000.00");
    expect(kes.summary).not.toContain("₦");

    const noCurrency = renderTimelineEvent({
      at: "2026-09-23T09:15:00Z",
      type: "mp.bid.submitted",
      detail: JSON.stringify({ amountMinor: 500_000, commissionMinor: 50_000 }),
    });
    expect(noCurrency.summary).toContain("500,000 minor units");
    expect(noCurrency.summary).toContain("50,000 minor units");
    expect(noCurrency.summary).not.toContain("₦");
  });

  it("refuses to format a non-integer or non-numeric amount instead of rounding it", () => {
    const e = ev("business_booking.reserved", {
      amountMinor: 12.5,
      currency: "NGN",
    });
    expect(e.summary).not.toContain("12.5");
    expect(e.summary).not.toMatch(/₦0\.13|₦0\.12/);
    const s = ev("business_booking.reserved", {
      amountMinor: "900000",
      currency: "NGN",
    });
    expect(s.summary).not.toContain("900000");
  });

  it("states business reserve / commit / release / refusal with server amounts", () => {
    expect(
      ev("business_booking.reserved", { amountMinor: 900_000, currency: "NGN" })
        .summary,
    ).toContain("₦9,000.00");
    const released = ev("business_booking.released", {
      party: "traveller",
      reason: "passenger_declined",
      amountMinor: 900_000,
      currency: "NGN",
    });
    expect(released.summary).toContain("by the traveller");
    expect(released.summary).toContain("passenger declined");
    const refused = ev("business_booking.refused", {
      reason: "budget_insufficient",
      amountMinor: 900_000,
      currency: "NGN",
    });
    expect(refused.summary).toContain("no transport promised");
    expect(refused.summary).toContain("budget insufficient");
  });
});

describe("round 2–7 families render meaningful copy", () => {
  it("trip amendments: proposed keeps the original agreement; rejected/expired say it stands", () => {
    expect(ev("mp.amendment.proposed", { kind: "route" }).summary).toContain(
      "original agreement stays in force",
    );
    expect(ev("mp.amendment.rejected", { kind: "route" }).summary).toContain(
      "original agreement stands",
    );
    expect(
      ev("mp.amendment.expired", { kind: "early_termination" }).summary,
    ).toContain("Early termination expired");
    expect(
      ev("mp.amendment.failed", {
        kind: "route",
        reason: "insufficient_rider_funds",
      }).summary,
    ).toContain("insufficient rider funds");
    const committed = ev("mp.amendment.committed", {
      kind: "route",
      agreedFareMinor: 700_000,
      currency: "NGN",
    });
    expect(committed.facts).toContainEqual({
      label: "Agreed fare now",
      value: "₦7,000.00",
    });
  });

  it("stops and paid waiting", () => {
    const started = ev("mp.stop.waiting_started", {
      order: 2,
      includedSec: 300,
      perMinMinor: 5_000,
      authorizedCapMinor: 50_000,
      currency: "NGN",
    });
    expect(started.summary).toBe("Stop 2: waiting started · 5 min included");
    expect(started.facts).toContainEqual({
      label: "Paid waiting rate / min",
      value: "₦50.00",
    });
    const departed = ev("mp.stop.departed", {
      order: 1,
      waitedSec: 540,
      paidSec: 240,
      waitingFeeMinor: 20_000,
      currency: "NGN",
    });
    expect(departed.summary).toBe(
      "Stop 1: departed · waited 9 min · 4 min paid · waiting fee ₦200.00",
    );
    expect(
      ev("mp.stop.arrival_disputed", {
        order: 1,
        reason: "not_at_stop",
        distanceMeters: 480,
      }).summary,
    ).toContain("paid waiting does not start");
    expect(
      ev("mp.stop.waiting_approval_required", {
        order: 1,
        authorizedCapMinor: 50_000,
        currency: "NGN",
      }).tone,
    ).toBe("warn");
  });

  it("Book for Later: scheduled publication, needs approval, advance lifecycle, recurring", () => {
    const published = ev("mp.scheduled_request.published", {
      requestId: "req-9",
      bookingKind: "scheduled",
      requestedMinor: 800_000,
      minMinor: 600_000,
      maxMinor: 1_200_000,
      currency: "NGN",
    });
    expect(published.summary).toContain(
      "Published to drivers at its lead time",
    );
    expect(published.facts).toContainEqual({
      label: "Server fare bounds",
      value: "₦6,000.00 – ₦12,000.00",
    });
    expect(
      ev("mp.scheduled_request.needs_approval", {
        reason: "fare_bounds_changed",
        driverSecured: false,
      }).summary,
    ).toContain("rider approval needed");
    expect(
      ev("mp.advance_booking.reconfirm_requested", {
        deadline: "2026-09-24T06:00:00Z",
      }).facts,
    ).toContainEqual({ label: "Deadline", value: "2026-09-24 06:00:00 UTC" });
    expect(
      ev("mp.advance_booking.activated", {
        slot: "current",
        commissionChargedAgain: false,
      }).summary,
    ).toContain("no second commission");
    const failed = ev("mp.advance_booking.failed", {
      reason: "driver_withdrew",
      rematchAvailable: true,
      financialOutcome: {
        commissionReversed: true,
        riderFundingReleased: true,
        riderCharged: false,
      },
    });
    expect(failed.summary).toContain("rematch offered");
    expect(failed.facts).toContainEqual({
      label: "Financial outcome",
      value: "commission reversed · rider funding released · rider not charged",
    });
    expect(
      ev("mp.advance_booking.rematch_requested", {
        requestedMinor: 900_000,
        currency: "NGN",
      }).summary,
    ).toContain("₦9,000.00");
    expect(
      ev("mp.recurring_occurrence.generated", { occurrenceDate: "2026-10-01" })
        .summary,
    ).toContain("no driver secured");
  });

  it("preferred driver invite / decline / opened to market", () => {
    expect(
      ev("mp.request.preferred_driver_invited", {
        driverId: "drv-1",
        windowSec: 120,
      }).summary,
    ).toContain("2 min exclusive window");
    expect(
      ev("mp.request.preferred_driver_declined", { driverId: "drv-1" }).summary,
    ).toContain("not counted against standing");
    expect(
      ev("mp.request.opened_to_market", {
        reason: "preferred_driver_unavailable",
      }).summary,
    ).toContain("rider's consent");
  });

  it("guest passenger: revoke vs reissue vs decline", () => {
    expect(
      ev("trip_access.revoked", { reason: "requester_revoked" }).summary,
    ).toBe("Trip link revoked · requester revoked");
    expect(ev("trip_access.revoked", { reason: "reissued" }).summary).toContain(
      "new one was issued",
    );
    const declined = ev("trip_access.declined", {
      feeMinor: 0,
      currency: "NGN",
    });
    expect(declined.summary).toContain("fee ₦0.00");
  });

  it("vehicle swap and booking risk (if present in the catalog)", () => {
    expect(
      ev("mp.vehicle_swap.applied", { fareChanged: false }).summary,
    ).toContain("commission not re-charged");
    expect(
      ev("mp.advance_booking.risk_changed", {
        risk: "at_risk",
        reasons: ["off_road", "document_expiry"],
      }).summary,
    ).toBe("Booking risk now at risk · off road, document expiry");
  });

  it("keeps order and time, and a garbled detail is labelled, not shown", () => {
    const out = renderTimelineEvents([
      {
        at: "2026-09-23T09:00:00Z",
        type: "mp.request.published",
        detail: "not json {",
      },
      { at: "2026-09-23T09:01:00Z", type: "mp.bid.won", detail: "{}" },
    ]);
    expect(out.map((e) => e.at)).toEqual([
      "2026-09-23 09:00:00 UTC",
      "2026-09-23 09:01:00 UTC",
    ]);
    expect(out[0]?.summary).toBe("Request published (payload unreadable)");
  });

  it("names the timeline read's coverage gap for non-mp.* families", () => {
    expect(TIMELINE_COVERAGE_GAPS.join(" ")).toContain("trip_access.*");
    expect(TIMELINE_COVERAGE_GAPS.join(" ")).toContain("business_booking.*");
  });
});
