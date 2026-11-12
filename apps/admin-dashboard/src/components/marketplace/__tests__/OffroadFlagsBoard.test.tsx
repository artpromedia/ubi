import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { type OffroadUseFlagView } from "@/lib/marketplace-api";
import { OffroadFlagsBoard } from "../OffroadFlagsBoard";

const SAMPLE_FLAGS: OffroadUseFlagView[] = [
  {
    flagId: "flag-offroad-001",
    vehicleId: "veh-lag-101",
    driverId: "drv-lag-202",
    cityId: "lagos",
    blockId: "blk-offroad-55",
    trigger: "driver_online",
    subjectRef: "sess-99",
    flaggedAt: "2026-11-11T08:15:00Z",
  },
  {
    flagId: "flag-offroad-002",
    vehicleId: "veh-lag-102",
    driverId: "drv-lag-203",
    cityId: "lagos",
    blockId: "blk-offroad-56",
    trigger: "trip_started",
    subjectRef: "ride-88",
    flaggedAt: "2026-11-11T08:45:00Z",
    decision: "warn_fleet",
    decidedBy: "admin-ops-1",
    decidedAt: "2026-11-11T09:00:00Z",
    decisionReason: "Fleet notified of unauthorized driver movement",
  },
];

describe("OffroadFlagsBoard (P2-02)", () => {
  it("renders loading and empty states cleanly", () => {
    const loadingHtml = renderToStaticMarkup(<OffroadFlagsBoard loading />);
    expect(loadingHtml).toContain('data-testid="admin.offroadFlags.board"');
    expect(loadingHtml).toContain('data-testid="admin.offroadFlags.loading"');

    const emptyHtml = renderToStaticMarkup(<OffroadFlagsBoard flags={[]} />);
    expect(emptyHtml).toContain('data-testid="admin.offroadFlags.empty"');
  });

  it("renders off-road abuse flag rows and decision controls with required reason", () => {
    const html = renderToStaticMarkup(
      <OffroadFlagsBoard
        flags={SAMPLE_FLAGS}
        selectedFlagId="flag-offroad-001"
        activeDecision={{
          flagId: "flag-offroad-001",
          decision: "escalate_to_standing",
        }}
        reason=""
      />,
    );

    expect(html).toContain('data-testid="admin.offroadFlags.row"');
    expect(html).toContain("flag-offroad-001");
    expect(html).toContain("Driver went online during off-road block");
    expect(html).toContain("Trip started during off-road block");
    expect(html).toContain('data-testid="admin.offroadFlags.detail"');
    expect(html).toContain('data-testid="admin.offroadFlags.action.dismiss"');
    expect(html).toContain(
      'data-testid="admin.offroadFlags.action.warn_fleet"',
    );
    expect(html).toContain(
      'data-testid="admin.offroadFlags.action.escalate_to_standing"',
    );
    expect(html).toContain('data-testid="admin.offroadFlags.reason"');
    expect(html).toContain(
      'data-testid="admin.offroadFlags.submit" disabled=""',
    );
  });

  it("enables decision submission once an operator reason (>= 3 chars) is provided", () => {
    const html = renderToStaticMarkup(
      <OffroadFlagsBoard
        flags={SAMPLE_FLAGS}
        selectedFlagId="flag-offroad-001"
        activeDecision={{
          flagId: "flag-offroad-001",
          decision: "warn_fleet",
        }}
        reason="Confirmed workshop test drive without clearing off-road block"
      />,
    );

    expect(html).toContain('data-testid="admin.offroadFlags.submit"');
    expect(html).not.toContain(
      'data-testid="admin.offroadFlags.submit" disabled=""',
    );
  });
});
