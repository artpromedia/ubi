import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { StuckSagaBoard, type StuckSagaBoardProps } from "../StuckSagaBoard";

const noop = () => undefined;
const base: StuckSagaBoardProps = {
  sagasLoading: false,
  sagasError: null,
  sagas: [
    {
      awardId: "award-1",
      requestId: "req-1",
      driverId: "driver-1",
      cityId: "lagos",
      step: "capture",
      attemptState: "pending",
      attempts: 2,
      ageSec: 125,
      updatedAt: "2026-01-01T00:00:00Z",
    },
  ],
  recoveriesLoading: false,
  recoveriesError: null,
  recoveries: [
    {
      id: "rec-1",
      action: "release",
      driverId: "driver-2",
      reservationId: "res-1",
      attempts: 1,
      ageSec: 40,
    },
  ],
  active: null,
  onPreviewReconcile: noop,
  onConfirmReconcile: noop,
  onPreviewRetry: noop,
  onConfirmRetry: noop,
  onCancel: noop,
};

describe("StuckSagaBoard", () => {
  it("renders loading states for both lists", () => {
    const html = renderToStaticMarkup(
      <StuckSagaBoard {...base} sagasLoading recoveriesLoading />,
    );
    expect(html).toContain("Loading…");
  });

  it("renders empty states for both lists", () => {
    const html = renderToStaticMarkup(
      <StuckSagaBoard {...base} sagas={[]} recoveries={[]} />,
    );
    expect(html).toContain('data-testid="mp.admin.saga.sagasEmpty"');
    expect(html).toContain('data-testid="mp.admin.saga.recoveriesEmpty"');
  });

  it("renders error states for both lists", () => {
    const html = renderToStaticMarkup(
      <StuckSagaBoard {...base} sagasError="timeout" recoveriesError="502" />,
    );
    expect(html).toContain('data-testid="mp.admin.saga.sagasError"');
    expect(html).toContain("timeout");
    expect(html).toContain('data-testid="mp.admin.saga.recoveriesError"');
    expect(html).toContain("502");
  });

  it("lists a stuck saga row with a preview affordance, not a direct apply", () => {
    const html = renderToStaticMarkup(<StuckSagaBoard {...base} />);
    expect(html).toContain('data-testid="mp.admin.saga.sagasTable"');
    expect(html).toContain("award-1");
    expect(html).toContain(
      'data-testid="mp.admin.saga.previewReconcile.award-1"',
    );
    expect(html).not.toContain("Apply now");
  });

  it("shows a preview panel that requires an explicit confirm before applying", () => {
    const html = renderToStaticMarkup(
      <StuckSagaBoard
        {...base}
        active={{
          kind: "reconcile",
          targetId: "award-1",
          phase: "preview",
          message: "This award is currently pending.",
        }}
      />,
    );
    expect(html).toContain('data-testid="mp.admin.saga.preview"');
    expect(html).toContain("nothing has been applied yet");
    expect(html).toContain('data-testid="mp.admin.saga.confirm"');
  });

  it("shows a distinct optimistic-concurrency conflict state", () => {
    const html = renderToStaticMarkup(
      <StuckSagaBoard
        {...base}
        active={{
          kind: "retry",
          targetId: "rec-1",
          phase: "conflict",
          message: "this recovery row changed since you last read it",
        }}
      />,
    );
    expect(html).toContain('data-testid="mp.admin.saga.conflict"');
    expect(html).toContain("Version conflict");
    expect(html).toContain("changed since you last read it");
  });

  it("shows a committed result and a failed/unresolved result distinctly", () => {
    const resolved = renderToStaticMarkup(
      <StuckSagaBoard
        {...base}
        active={{
          kind: "reconcile",
          targetId: "award-1",
          phase: "result",
          outcome: "resolved",
          message: "pending → confirmed",
        }}
      />,
    );
    expect(resolved).toContain('data-testid="mp.admin.saga.result"');
    expect(resolved).toContain("resolved");

    const unresolved = renderToStaticMarkup(
      <StuckSagaBoard
        {...base}
        active={{
          kind: "reconcile",
          targetId: "award-1",
          phase: "result",
          outcome: "unresolved",
          message: "wallet still unknown",
        }}
      />,
    );
    expect(unresolved).toContain("unresolved");
    expect(unresolved).toContain("wallet still unknown");
  });
});
