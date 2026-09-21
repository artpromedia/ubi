import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  DriverStandingBoard,
  type DriverStandingBoardProps,
} from "../DriverStandingBoard";

const noop = () => undefined;
const pendingAction = {
  id: "action-1",
  driverId: "driver-1",
  actionType: "suspension" as const,
  reasonCode: "repeated_cancellation",
  reasonNote: "3 cancels this week",
  status: "pending_approval",
  proposedBy: "op-a",
  requiresApproval: true,
};
const appealedAction = {
  ...pendingAction,
  id: "action-2",
  status: "appealed",
  appealedBy: "op-b",
};

const base: DriverStandingBoardProps = {
  operatorId: "op-b",
  cancellationsLoading: false,
  cancellationsError: null,
  cancellations: [
    {
      rideId: "ride-1",
      driverId: "driver-1",
      riderId: "rider-1",
      state: "cancelled_by_driver",
      reasonCode: "vehicle_issue",
      at: "2026-01-01T00:00:00Z",
    },
  ],
  flaggedLoading: false,
  flaggedError: null,
  flagged: [
    {
      driverId: "driver-1",
      cityId: "lagos",
      totalRides: 10,
      driverCancellations: 4,
      noShows: 1,
      cancellationRatePct: "50%",
    },
  ],
  reasonCodes: ["repeated_cancellation", "other"],
  selectedDriverId: "driver-1",
  driverDetailLoading: false,
  driverDetailError: null,
  driverDetail: {
    driverId: "driver-1",
    totalRides: 10,
    completions: 5,
    driverCancellations: 4,
    noShows: 1,
    cancellationRatePct: "50%",
    blocked: true,
    history: [pendingAction],
  },
  proposeForm: { actionType: "warning", reasonCode: "", reasonNote: "" },
  actionMessage: null,
  onSelectDriver: noop,
  onProposeFormChange: noop,
  onSubmitPropose: noop,
  onDecide: noop,
  onFileAppeal: noop,
  onDecideAppeal: noop,
};

describe("DriverStandingBoard", () => {
  it("renders loading/empty/error states for the cancellations and flagged-drivers lists", () => {
    const loading = renderToStaticMarkup(
      <DriverStandingBoard
        {...base}
        cancellationsLoading
        flaggedLoading
        selectedDriverId={null}
      />,
    );
    expect(loading).toContain("Loading…");

    const empty = renderToStaticMarkup(
      <DriverStandingBoard
        {...base}
        cancellations={[]}
        flagged={[]}
        selectedDriverId={null}
      />,
    );
    expect(empty).toContain(
      'data-testid="mp.admin.standing.cancellationsEmpty"',
    );
    expect(empty).toContain('data-testid="mp.admin.standing.flaggedEmpty"');

    const error = renderToStaticMarkup(
      <DriverStandingBoard
        {...base}
        cancellationsError="timeout"
        flaggedError="502"
        selectedDriverId={null}
      />,
    );
    expect(error).toContain(
      'data-testid="mp.admin.standing.cancellationsError"',
    );
    expect(error).toContain('data-testid="mp.admin.standing.flaggedError"');
  });

  it("shows the driver's currently-suspended state and cancellation rate", () => {
    const html = renderToStaticMarkup(<DriverStandingBoard {...base} />);
    expect(html).toContain("Currently suspended");
    expect(html).toContain("50%");
  });

  it("blocks the proposer from approving their own pending suspension (maker-checker)", () => {
    const html = renderToStaticMarkup(
      <DriverStandingBoard {...base} operatorId="op-a" />,
    );
    expect(html).toContain(
      'data-testid="mp.admin.standing.selfApprovalBlocked.action-1"',
    );
    expect(html).not.toContain(
      'data-testid="mp.admin.standing.approve.action-1"',
    );
  });

  it("lets a distinct operator approve or reject a pending suspension", () => {
    const html = renderToStaticMarkup(
      <DriverStandingBoard {...base} operatorId="op-b" />,
    );
    expect(html).not.toContain("selfApprovalBlocked");
    expect(html).toContain('data-testid="mp.admin.standing.approve.action-1"');
    expect(html).toContain('data-testid="mp.admin.standing.reject.action-1"');
    // The reason input is required — the confirm button starts disabled.
    expect(html).toMatch(
      /data-testid="mp\.admin\.standing\.approve\.action-1"[^>]*disabled/,
    );
  });

  it("blocks the appeal filer from deciding their own appeal (maker-checker)", () => {
    const html = renderToStaticMarkup(
      <DriverStandingBoard
        {...base}
        operatorId="op-b"
        driverDetail={{ ...base.driverDetail!, history: [appealedAction] }}
      />,
    );
    expect(html).toContain(
      'data-testid="mp.admin.standing.selfAppealBlocked.action-2"',
    );
    expect(html).not.toContain(
      'data-testid="mp.admin.standing.uphold.action-2"',
    );
  });

  it("lets a distinct reviewer uphold or deny an appeal", () => {
    const html = renderToStaticMarkup(
      <DriverStandingBoard
        {...base}
        operatorId="op-c"
        driverDetail={{ ...base.driverDetail!, history: [appealedAction] }}
      />,
    );
    expect(html).toContain('data-testid="mp.admin.standing.uphold.action-2"');
    expect(html).toContain('data-testid="mp.admin.standing.deny.action-2"');
  });

  it("shows a success and an error action message distinctly", () => {
    const ok = renderToStaticMarkup(
      <DriverStandingBoard
        {...base}
        actionMessage={{ tone: "ok", text: "Approved." }}
      />,
    );
    expect(ok).toContain('data-testid="mp.admin.standing.message"');
    expect(ok).toContain("Approved.");

    const err = renderToStaticMarkup(
      <DriverStandingBoard
        {...base}
        actionMessage={{ tone: "err", text: "forbidden" }}
      />,
    );
    expect(err).toContain("forbidden");
  });
});
