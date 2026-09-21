import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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
  events: [{ at: "10:00:00", type: "mp.award.confirmed", detail: "{}" }],
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
        error="502 bad gateway"
      />,
    );
    expect(html).toContain('data-testid="mp.admin.resolution.error"');
    expect(html).toContain("502 bad gateway");
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
  });

  it("flags a currently-blocked driver and exposes the export control", () => {
    const html = renderToStaticMarkup(
      <ResolutionTimelinePage {...base} driverBlocked />,
    );
    expect(html).toContain("Driver suspended");
    expect(html).toContain('data-testid="mp.admin.resolution.export"');
  });
});
