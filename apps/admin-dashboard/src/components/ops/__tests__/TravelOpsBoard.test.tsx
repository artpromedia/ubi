/**
 * Travel ops board: the exceptions/provider-health shapes travel-service
 * really answers (src/ops/ops-travel.ts), the ops-readable itinerary
 * (src/ops/trips.ts getLinked), and the named gaps. Payload fixtures mirror
 * those server functions field for field.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { classifyError } from "../../../lib/access";
import { ApiError } from "../../../lib/api-client";
import {
  ITINERARY_GAPS,
  TRANSFERS_GAP,
  allowedActions,
  settlementDifferenceLine,
  toExceptionRows,
  toItineraryRows,
  toProviderCards,
  type ProvidersHealth,
  type TravelOpsException,
  type TripView,
} from "../../../lib/travel-ops";
import { TravelOpsBoard, type TravelOpsBoardProps } from "../TravelOpsBoard";

const exceptions: TravelOpsException[] = [
  {
    orderId: "ord-unknown",
    supplierRefs: { pnr: "ABC123" },
    item: "flight",
    kind: "unknown_result",
    state: "unknown_reconciling",
    since: "2026-09-23T08:00:00.000Z",
    money: { held: { amountMinor: 8_640_000, currency: "NGN" } },
    nextAction: "lookup_by_our_ref",
  },
  {
    orderId: "ord-pending",
    supplierRefs: {},
    item: "stay",
    kind: "provider_uncertain",
    state: "supplier_pending",
    since: "2026-09-23T08:10:00.000Z",
    money: { held: { amountMinor: 18_000_000, currency: "NGN" } },
    nextAction: "await supplier callback",
  },
  {
    orderId: "ord-refund",
    item: "refund",
    kind: "refund_due",
    state: "requested",
    since: "2026-09-23T07:00:00.000Z",
    money: { owed: { amountMinor: 250_050, currency: "NGN" } },
    nextAction: "chase_refund",
  },
  {
    orderId: "ord-settle",
    item: "settlement",
    kind: "settlement_difference",
    state: "unresolved",
    since: "2026-09-22T07:00:00.000Z",
    money: { difference: { amountMinor: -12_345, currency: "NGN" } },
    nextAction: "accept_difference | dispute_difference",
  },
  {
    orderId: "ord-future",
    item: "flight",
    kind: "brand_new_kind",
    state: "x",
    since: "2026-09-22T07:00:00.000Z",
    money: {},
  },
];

const health: ProvidersHealth = {
  providers: [
    {
      supplierId: "duffel",
      kind: "flight",
      adapter: "duffel",
      enabled: true,
      reachable: true,
      liveCallsBlocked: false,
      operational: true,
      orders: {
        confirmed: 7,
        ticketed: 10,
        failed: 2,
        unknown: 1,
        pending: 0,
        total: 20,
      },
      successRate: 0.85,
      webhooks: { total: 40, rejected: 3 },
    },
    {
      supplierId: "liteapi",
      kind: "stay",
      adapter: "liteapi",
      enabled: true,
      reachable: false,
      liveCallsBlocked: true,
      operational: false,
      reason: "credentials_missing",
      orders: {
        confirmed: 0,
        ticketed: 0,
        failed: 0,
        unknown: 0,
        pending: 0,
        total: 0,
      },
      successRate: null,
      webhooks: { total: 0, rejected: 0 },
    },
  ],
  unresolvedSettlementDifferenceMinor: -12_345,
  generatedAt: "2026-09-23T09:00:00.000Z",
};

const trip: TripView = {
  id: "trip-1",
  title: "Lagos → Abuja",
  startDate: "2026-10-01",
  endDate: "2026-10-03",
  items: [
    {
      kind: "flight",
      orderId: "FL-90212",
      title: "Flight",
      subtitle: "PNR ABC123",
      status: "ticketed",
      charged: { amountMinor: 8_640_000, currency: "NGN" },
      policy: null,
      disruption: null,
      actions: [],
    },
    {
      kind: "stay",
      orderId: "ST-44810",
      title: "Stay",
      status: "confirmed",
      charged: { amountMinor: 18_000_000, currency: "NGN" },
    },
    {
      kind: "airport_transfer",
      transferId: "tr-1",
      title: "Ride from airport",
      subtitle: "Requested — no driver secured yet",
      status: "requested",
      driverSecured: false,
      policy: "No driver yet.",
      disruption: "Your flight moved. Keep the new time or cancel?",
      actions: [{ key: "keep", label: "Keep" }],
    },
    {
      kind: "airport_transfer",
      transferId: "tr-2",
      title: "Ride to airport",
      status: "failed",
      driverSecured: false,
      policy: "No driver accepted in time. Nothing was charged for the ride.",
      disruption: null,
    },
  ],
};

const noop = () => undefined;
const base: TravelOpsBoardProps = {
  offline: false,
  exceptions: {
    loading: false,
    error: null,
    rows: toExceptionRows(exceptions),
  },
  providers: {
    loading: false,
    error: null,
    cards: toProviderCards(health),
    settlementLine: settlementDifferenceLine(health),
    generatedAt: health.generatedAt,
  },
  pendingAction: null,
  actionResult: null,
  onRequestAction: noop,
  onConfirmAction: noop,
  onCancelAction: noop,
  trip: {
    lookedUp: "trip-1",
    loading: false,
    error: null,
    title: trip.title ?? null,
    dates: "2026-10-01 → 2026-10-03",
    rows: toItineraryRows(trip),
  },
  onLookupTrip: noop,
};

describe("travel ops mappers — real server shapes", () => {
  it("formats exception money from the server's minor units and currency", () => {
    const rows = toExceptionRows(exceptions);
    expect(rows[0]?.money).toEqual([{ label: "Held", value: "₦86,400.00" }]);
    expect(rows[2]?.money).toEqual([{ label: "Owed", value: "₦2,500.50" }]);
    expect(rows[3]?.money).toEqual([
      { label: "Difference", value: "−₦123.45" },
    ]);
    expect(rows[0]?.refs).toBe("pnr ABC123");
  });

  it("offers only server-named actions (plus escalate) and shows waits as waits", () => {
    const [unknownResult, , , settlement] = exceptions as [
      TravelOpsException,
      TravelOpsException,
      TravelOpsException,
      TravelOpsException,
    ];
    expect(allowedActions(unknownResult)).toEqual([
      "lookup_by_our_ref",
      "escalate",
    ]);
    expect(allowedActions(settlement)).toEqual([
      "accept_difference",
      "dispute_difference",
      "escalate",
    ]);
    const rows = toExceptionRows(exceptions);
    expect(rows[1]?.actions).toEqual(["escalate"]);
    expect(rows[1]?.waitingOn).toBe("await supplier callback");
  });

  it("never shows a contact or token key a supplier adapter adds to refs", () => {
    const [row] = toExceptionRows([
      {
        ...(exceptions[0] as TravelOpsException),
        supplierRefs: {
          pnr: "ABC123",
          contactEmail: "ada@example.com",
          passengerPhone: "+2348031234567",
          accessToken: "tok-1",
        },
      },
    ]);
    expect(row?.refs).toBe("pnr ABC123");
  });

  it("labels provider_uncertain and keeps an unknown kind verbatim instead of crashing", () => {
    const rows = toExceptionRows(exceptions);
    expect(rows[1]?.kindLabel).toBe("PROVIDER UNCERTAIN");
    expect(rows[4]?.kindLabel).toBe("BRAND_NEW_KIND");
    expect(rows[4]?.kindKnown).toBe(false);
  });

  it("reads provider health as the server's {providers[]} object", () => {
    const cards = toProviderCards(health);
    expect(cards[0]).toMatchObject({
      supplierId: "duffel",
      status: "Operational",
      tone: "ok",
    });
    expect(cards[0]?.lines).toContain("success rate 85% of 20 orders");
    expect(cards[0]?.lines).toContain("3 webhooks rejected (bad signature)");
    expect(cards[1]).toMatchObject({
      status: "Live calls blocked",
      tone: "warn",
    });
    expect(cards[1]?.lines).toContain("reason: credentials missing");
    expect(settlementDifferenceLine(health)).toBe(
      "−12,345 minor units (all suppliers; the read carries no currency)",
    );
  });

  it("joins itinerary items with their OWN status and charge — transfers carry no charge", () => {
    const rows = toItineraryRows(trip);
    expect(rows.map((r) => r.money)).toEqual([
      "₦86,400.00",
      "₦180,000.00",
      "—",
      "—",
    ]);
    expect(rows[0]?.fulfilment).toBe("Ticketed");
    expect(rows[1]?.fulfilment).toBe("Confirmed");
    expect(
      toItineraryRows({
        id: "t",
        items: [{ kind: "flight", title: "Flight", status: "confirmed" }],
      })[0]?.fulfilment,
    ).toBe("Confirmed — not ticketed yet (a PNR is not a ticket)");
    expect(rows[2]?.fulfilment).toBe("Requested — no driver secured");
    expect(rows[2]?.actionRequired).toBe(
      "Your flight moved. Keep the new time or cancel?",
    );
    expect(rows[3]?.fulfilment).toBe("Not booked — no driver");
    expect(rows[3]?.actionRequired).toContain(
      "Outcome: No driver accepted in time",
    );
    expect(rows[2]?.moneyNote).toContain("ride-service");
  });
});

describe("TravelOpsBoard", () => {
  it("renders exceptions, provider health and the itinerary without crashing on real shapes", () => {
    const html = renderToStaticMarkup(<TravelOpsBoard {...base} />);
    expect(html).toContain('data-testid="ops.travel.exceptions"');
    expect(html.match(/data-testid="ops\.travel\.exception"/g)?.length).toBe(5);
    expect(html.match(/data-testid="ops\.travel\.provider"/g)?.length).toBe(2);
    expect(html).toContain("₦86,400.00");
    expect(html).toContain('data-testid="ops.travel.itineraryTable"');
    expect(
      html.match(/data-testid="ops\.travel\.itineraryTransfer"/g)?.length,
    ).toBe(2);
    expect(
      html.match(/data-testid="ops\.travel\.itineraryOrder"/g)?.length,
    ).toBe(2);
  });

  it("has no settle-all control anywhere — each order keeps its own ledger", () => {
    const html = renderToStaticMarkup(<TravelOpsBoard {...base} />);
    expect(html.toLowerCase()).not.toMatch(
      /settle[ -]?all|settle-all|settleall/,
    );
    expect(html).not.toMatch(/data-testid="[^"]*settle/i);
    expect(html).toContain("no combined settlement");
  });

  it("never sums the itinerary's money into a total", () => {
    const html = renderToStaticMarkup(<TravelOpsBoard {...base} />);
    // 86,400 + 180,000 = 266,400 must not appear.
    expect(html).not.toContain("266,400");
    expect(html.toLowerCase()).not.toContain("total");
  });

  it("names the missing endpoints for ops-wide transfers, money state and commission vs margin", () => {
    const html = renderToStaticMarkup(<TravelOpsBoard {...base} />);
    expect(html).toContain('data-testid="ops.travel.transfersGap"');
    expect(html).toContain(TRANSFERS_GAP.missingEndpoint);
    for (const [i, gap] of ITINERARY_GAPS.entries()) {
      expect(html).toContain('data-testid="ops.travel.itineraryGap.' + i + '"');
      expect(html).toContain(gap.title);
    }
    expect(html).toContain("GET /admin/v1/itineraries/:id?expand=orders");
  });

  it("previews an action with what it does before it can be confirmed, once", () => {
    const html = renderToStaticMarkup(
      <TravelOpsBoard
        {...base}
        pendingAction={{
          orderId: "ord-refund",
          action: "chase_refund",
          busy: true,
        }}
      />,
    );
    expect(html).toContain('data-testid="ops.travel.confirm"');
    expect(html).toContain("Advances the open refund ONE stage");
    expect(html).toMatch(
      /data-testid="ops\.travel\.confirmApply"[^>]*disabled=""/,
    );
    // row buttons are locked while one action is pending
    expect(html).toMatch(
      /<button[^>]*disabled=""[^>]*data-testid="ops\.travel\.action\.lookup_by_our_ref"/,
    );
  });

  it("renders loading, empty, error, forbidden, device and offline states distinctly", () => {
    const loading = renderToStaticMarkup(
      <TravelOpsBoard
        {...base}
        exceptions={{ loading: true, error: null, rows: [] }}
      />,
    );
    expect(loading).toContain("Loading exceptions…");
    const empty = renderToStaticMarkup(
      <TravelOpsBoard
        {...base}
        exceptions={{ loading: false, error: null, rows: [] }}
      />,
    );
    expect(empty).toContain('data-testid="ops.travel.empty"');
    const forbidden = renderToStaticMarkup(
      <TravelOpsBoard
        {...base}
        exceptions={{
          loading: false,
          error: classifyError(new ApiError(403, "forbidden", "no"), true),
          rows: [],
        }}
      />,
    );
    expect(forbidden).toContain('data-testid="ops.access.forbidden"');
    const device = renderToStaticMarkup(
      <TravelOpsBoard
        {...base}
        providers={{
          ...base.providers,
          error: classifyError(new ApiError(403, "limited_mode", "no"), true),
        }}
      />,
    );
    expect(device).toContain('data-testid="ops.access.device_unverified"');
    const offline = renderToStaticMarkup(<TravelOpsBoard {...base} offline />);
    expect(offline).toContain('data-testid="ops.access.offline"');
    const tripMissing = renderToStaticMarkup(
      <TravelOpsBoard
        {...base}
        trip={{
          ...base.trip,
          rows: [],
          error: classifyError(
            new ApiError(404, "not_found", "no such trip"),
            true,
          ),
        }}
      />,
    );
    expect(tripMissing).toContain('data-testid="ops.access.not_found"');
  });
});
