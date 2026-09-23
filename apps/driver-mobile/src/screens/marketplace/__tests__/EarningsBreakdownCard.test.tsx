// A04.1 offer earnings breakdown: every line renders from the SERVER field it names, the
// estimates say so, the fleet remittance is an explicit "None", and — the no-client-math
// rule — a breakdown whose numbers do not add up is shown exactly as sent, because the
// card never re-derives commission, net or rate from the gross.
import React from "react";
import { render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "@ubi/mobile-ui";
import { formatMinor } from "@ubi/mobile-core";
import { MpEarningsBreakdownSchema, dynamicTestId } from "@ubi/contracts";
import type { MpEarningsBreakdown } from "../../../api/marketplace";
import { EarningsBreakdownCard } from "../EarningsBreakdownCard";
import { MP_DRIVER_TID } from "../testIds";

const NGN = (amountMinor: number) => ({ amountMinor, currency: "NGN" });

// The wire shape ride-service's driver-view serves for a 45,000 fare, a 1,234 m routed
// pickup, a 5,003 m / 600 s route and two stops with 330 s dwell — every number is what
// the server's own arithmetic yields for those inputs (net per hour = 40,500 × 3,600 /
// (180 + 600 + 330) s, half-up = 131,351), so the "renders as sent" cases below start
// from a consistent breakdown.
const serverBreakdown = (): MpEarningsBreakdown => ({
  grossMinor: NGN(45_000),
  grossBasis: "requested_fare",
  commissionMinor: NGN(4_500),
  commissionBps: 1_000,
  fleetRemittance: {
    status: "none",
    amountMinor: null,
    reason:
      "No fleet arrangement applies to marketplace jobs, so nothing from this fare is remitted to a fleet.",
  },
  estimatedNetMinor: NGN(40_500),
  pickup: {
    distanceMeters: 1_200,
    distanceBasis: "routed",
    durationSec: 180,
    durationBasis: "routed_leg",
    estimate: true,
    paid: false,
    label: "Unpaid pickup · 1.2 km · ~3 min (estimate)",
  },
  route: {
    distanceMeters: 5_003,
    durationSec: 600,
    stopCount: 2,
    stopsWaitingSec: 330,
    estimate: true,
    label: "Paid trip · 5.0 km · ~10 min driving (estimate)",
    waitingLabel: "2 stops · ~6 min expected waiting",
  },
  estimatedNetPerHour: {
    amountMinor: NGN(131_351),
    estimate: true,
    basisSec: 1_110,
    basis:
      "Estimate: net over pickup ~3 min + trip ~10 min + stop waiting ~6 min. Excludes fuel/energy and time between jobs.",
  },
  runningCosts: {
    status: "not_estimated",
    reason:
      "No fuel or energy cost input is disclosed, so running costs are not estimated. Net is before your own fuel, energy and vehicle costs.",
  },
  disclaimer:
    "Net = fare − 10% UBI commission − fleet remittance (none). Pickup time and net per hour are estimates, not guaranteed earnings.",
});

const renderCard = (
  earnings: MpEarningsBreakdown,
  variant: "compact" | "full",
  idSuffix?: string,
) =>
  render(
    <ThemeProvider defaultMode="dark">
      <EarningsBreakdownCard
        earnings={earnings}
        variant={variant}
        idSuffix={idSuffix}
      />
    </ThemeProvider>,
  );

const textOf = (testID: string) => {
  const node = screen.getByTestId(testID);
  const children = node.props.children as unknown;
  return Array.isArray(children) ? children.join("") : String(children);
};

describe("EarningsBreakdownCard", () => {
  it("parses as the contract's breakdown (the fixture is the server's shape)", () => {
    expect(() =>
      MpEarningsBreakdownSchema.parse(serverBreakdown()),
    ).not.toThrow();
  });

  it("renders every full-breakdown line from its server field", () => {
    const e = serverBreakdown();
    renderCard(e, "full");
    expect(textOf(MP_DRIVER_TID.earnings.gross)).toBe(
      formatMinor(e.grossMinor),
    );
    expect(textOf(MP_DRIVER_TID.earnings.commission)).toBe(
      formatMinor(e.commissionMinor),
    );
    expect(textOf(MP_DRIVER_TID.earnings.net)).toBe(
      formatMinor(e.estimatedNetMinor),
    );
    expect(textOf(MP_DRIVER_TID.earnings.perHour)).toBe(
      formatMinor(e.estimatedNetPerHour!.amountMinor),
    );
    // Distance/time lines are the server's own words, verbatim.
    expect(textOf(MP_DRIVER_TID.earnings.pickup)).toBe(e.pickup.label);
    expect(textOf(MP_DRIVER_TID.earnings.route)).toBe(e.route!.label);
    expect(textOf(MP_DRIVER_TID.earnings.waiting)).toBe(e.route!.waitingLabel);
    // 10% is the server's commissionBps, formatted.
    expect(screen.getByText("UBI commission · 10%")).toBeTruthy();
    // Fleet remittance: an explicit None with the server's reason, never a number.
    expect(screen.getByText("None")).toBeTruthy();
    expect(screen.getByText(e.fleetRemittance.reason)).toBeTruthy();
    // Estimates are labelled, with their inputs; no fuel figure is invented.
    expect(screen.getAllByText(/estimate/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(e.estimatedNetPerHour!.basis)).toBeTruthy();
    expect(textOf(MP_DRIVER_TID.earnings.costs)).toBe(e.runningCosts.reason);
    expect(screen.getByText(e.disclaimer)).toBeTruthy();
  });

  it("renders the compact feed lines with per-card test ids", () => {
    const e = serverBreakdown();
    renderCard(e, "compact", "req_1");
    const id = (base: string) => dynamicTestId(base, "req_1");
    expect(textOf(id(MP_DRIVER_TID.earnings.net))).toBe(
      formatMinor(e.estimatedNetMinor),
    );
    expect(textOf(id(MP_DRIVER_TID.earnings.commission))).toBe(
      formatMinor(e.commissionMinor),
    );
    expect(textOf(id(MP_DRIVER_TID.earnings.fleet))).toContain(
      "fleet share none",
    );
    expect(textOf(id(MP_DRIVER_TID.earnings.pickup))).toBe(e.pickup.label);
    expect(textOf(id(MP_DRIVER_TID.earnings.route))).toBe(
      e.route!.label + " · " + e.route!.waitingLabel,
    );
    expect(textOf(id(MP_DRIVER_TID.earnings.perHour))).toBe(
      formatMinor(e.estimatedNetPerHour!.amountMinor),
    );
  });

  it("never re-derives money: an inconsistent breakdown renders exactly as sent", () => {
    // gross − commission would be 999; per-hour over the 1,110 s basis would be something else
    // entirely. The card must show the SERVER's 5 and 7 — proof no client arithmetic ran.
    const e = serverBreakdown();
    e.grossMinor = NGN(1_000);
    e.commissionMinor = NGN(1);
    e.estimatedNetMinor = NGN(5);
    e.estimatedNetPerHour = { ...e.estimatedNetPerHour!, amountMinor: NGN(7) };
    renderCard(e, "full");
    expect(textOf(MP_DRIVER_TID.earnings.net)).toBe(formatMinor(NGN(5)));
    expect(textOf(MP_DRIVER_TID.earnings.commission)).toBe(formatMinor(NGN(1)));
    expect(textOf(MP_DRIVER_TID.earnings.perHour)).toBe(formatMinor(NGN(7)));
    expect(screen.queryByText(formatMinor(NGN(999)))).toBeNull();
  });

  it("shows unknowns honestly: no pickup time means no per-hour figure", () => {
    const e = serverBreakdown();
    e.pickup = {
      distanceMeters: null,
      distanceBasis: "unavailable",
      durationSec: null,
      durationBasis: "unavailable",
      estimate: true,
      paid: false,
      label: "Pickup distance unavailable without a recent location",
    };
    e.estimatedNetPerHour = null;
    e.route = null;
    renderCard(e, "full");
    expect(textOf(MP_DRIVER_TID.earnings.pickup)).toBe(e.pickup.label);
    expect(screen.queryByTestId(MP_DRIVER_TID.earnings.perHour)).toBeNull();
    expect(screen.getByText("Not estimated")).toBeTruthy();
    expect(textOf(MP_DRIVER_TID.earnings.route)).toBe(
      "Route details unavailable",
    );
    expect(screen.queryByTestId(MP_DRIVER_TID.earnings.waiting)).toBeNull();
  });
});
