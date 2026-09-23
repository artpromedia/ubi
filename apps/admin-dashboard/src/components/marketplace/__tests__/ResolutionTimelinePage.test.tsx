import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { classifyError } from "../../../lib/access";
import { ApiError } from "../../../lib/api-client";
import { renderTimelineEvents } from "../../../lib/mp-events";
import {
  ResolutionTimelinePage,
  type ResolutionTimelineProps,
} from "../ResolutionTimelinePage";

const base: ResolutionTimelineProps = {
  loading: false,
  error: null,
  requestId: "req-1",
  requestState: "execution",
  awardLine: "Award award-1 · driver driver-1 · fare ₦5,000.00",
  executionLine: "Execution ride ride-1 · in_progress",
  driverBlocked: false,
  stages: [
    { name: "request", status: "committed", detail: "state: execution" },
    { name: "award", status: "committed", detail: "confirmed" },
    { name: "funding", status: "committed", detail: "inferred funded" },
    { name: "commission", status: "committed", detail: "captured, receipt r1" },
    { name: "execution", status: "view", detail: "in_progress" },
    { name: "settlement", status: "unavailable", detail: "not reached yet" },
    {
      name: "notification",
      status: "unavailable",
      detail: "no admin-reachable read exists",
    },
  ],
  events: renderTimelineEvents(
    [
      {
        at: "2026-09-20T10:00:00Z",
        type: "mp.award.confirmed",
        detail: JSON.stringify({
          awardId: "award-1",
          fareMinor: 500_000,
          commissionMinor: 50_000,
          captureReceipt: "r1",
        }),
      },
      {
        at: "2026-09-20T10:05:00Z",
        type: "mp.amendment.committed",
        detail: JSON.stringify({
          kind: "route",
          priorFareMinor: 500_000,
          revisedFareMinor: 575_000,
          commissionDeltaMinor: 7_500,
          riderFundingDeltaMinor: 75_000,
          agreedFareMinor: 575_000,
          currency: "NGN",
        }),
      },
    ],
    { currency: "NGN" },
  ),
  gaps: ["no payment-service endpoint reachable by admin-dashboard"],
  onExport: () => undefined,
};

describe("ResolutionTimelinePage", () => {
  it("renders a loading state", () => {
    const html = renderToStaticMarkup(
      <ResolutionTimelinePage {...base} loading />,
    );
    expect(html).toContain('data-testid="mp.admin.resolution.loading"');
  });

  it("renders an error state", () => {
    const html = renderToStaticMarkup(
      <ResolutionTimelinePage
        {...base}
        loading={false}
        error={classifyError(new ApiError(502, null, "bad gateway"), true)}
      />,
    );
    expect(html).toContain('data-testid="mp.admin.resolution.error"');
    expect(html).toContain("502 bad gateway");
  });

  it("renders role and device-access refusals distinctly from an empty case", () => {
    const forbidden = renderToStaticMarkup(
      <ResolutionTimelinePage
        {...base}
        error={classifyError(new ApiError(403, "forbidden", "no"), true)}
      />,
    );
    expect(forbidden).toContain('data-testid="ops.access.forbidden"');
    const device = renderToStaticMarkup(
      <ResolutionTimelinePage
        {...base}
        error={classifyError(new ApiError(403, "limited_mode", "no"), true)}
      />,
    );
    expect(device).toContain('data-testid="ops.access.device_unverified"');
    const offline = renderToStaticMarkup(
      <ResolutionTimelinePage
        {...base}
        error={classifyError(new TypeError("Failed to fetch"), true)}
      />,
    );
    expect(offline).toContain('data-testid="ops.access.offline"');
  });

  it("renders every stage with a distinct tone and the named gaps", () => {
    const html = renderToStaticMarkup(<ResolutionTimelinePage {...base} />);
    expect(html).toContain('data-testid="mp.admin.resolution.stages"');
    expect(html).toContain("Committed");
    expect(html).toContain("Unavailable");
    expect(html).toContain('data-testid="mp.admin.resolution.gaps"');
    expect(html).toContain("no payment-service endpoint");
  });

  it("renders an empty-events state distinctly from a populated one", () => {
    const empty = renderToStaticMarkup(
      <ResolutionTimelinePage {...base} events={[]} />,
    );
    expect(empty).toContain('data-testid="mp.admin.resolution.emptyEvents"');
    const populated = renderToStaticMarkup(
      <ResolutionTimelinePage {...base} />,
    );
    expect(populated).toContain("mp.award.confirmed");
    expect(populated).toContain('data-testid="mp.admin.resolution.events"');
  });

  it("renders operator copy with server money — never the raw payload", () => {
    const html = renderToStaticMarkup(<ResolutionTimelinePage {...base} />);
    expect(html).toContain("Award confirmed");
    expect(html).toContain("₦5,000.00");
    expect(html).toContain("₦500.00");
    expect(html).toContain("Route change committed");
    // incremental commission (linked) and the rider funding top-up
    expect(html).toContain("₦75.00");
    expect(html).toContain("₦750.00");
    expect(html).not.toContain("commissionDeltaMinor");
    expect(html).not.toContain("{&quot;");
  });

  it("flags a currently-blocked driver and exposes the export control", () => {
    const html = renderToStaticMarkup(
      <ResolutionTimelinePage {...base} driverBlocked />,
    );
    expect(html).toContain("Driver suspended");
    expect(html).toContain('data-testid="mp.admin.resolution.export"');
  });
});
