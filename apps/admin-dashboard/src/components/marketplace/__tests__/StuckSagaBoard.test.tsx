import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { classifyError } from "../../../lib/access";
import { ApiError } from "../../../lib/api-client";
import { OWED_WORK_WITHOUT_ADMIN_READ } from "../../../lib/saga-steps";
import { StuckSagaBoard, type StuckSagaBoardProps } from "../StuckSagaBoard";

const noop = () => undefined;
const saga: StuckSagaBoardProps["sagas"][number] = {
  awardId: "award-1",
  requestId: "req-1",
  driverId: "driver-1",
  cityId: "lagos",
  step: "capture",
  attemptState: "pending",
  attempts: 2,
  ageSec: 125,
  updatedAt: "2026-01-01T00:00:00Z",
};
const recovery: StuckSagaBoardProps["recoveries"][number] = {
  id: "rec-1",
  action: "release",
  driverId: "driver-2",
  reservationId: "res-1",
  attempts: 1,
  ageSec: 40,
};
const base: StuckSagaBoardProps = {
  sagasLoading: false,
  sagasError: null,
  sagas: [saga],
  recoveriesLoading: false,
  recoveriesError: null,
  recoveries: [recovery],
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
      <StuckSagaBoard
        {...base}
        sagasError={classifyError(new ApiError(504, null, "timeout"), true)}
        recoveriesError={classifyError(new ApiError(502, null, "bad"), true)}
      />,
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

  it("labels every saga step the rounds 5–7 sagas park at, and flags unknown ones", () => {
    const steps = [
      "",
      "funding",
      "capture",
      "delivery_handoff",
      "finalize",
      "compensating",
      "mystery_step",
    ];
    const html = renderToStaticMarkup(
      <StuckSagaBoard
        {...base}
        sagas={steps.map((step, i) => ({
          ...saga,
          awardId: "award-" + i,
          step,
          attemptState: i === 1 ? "unknown" : "pending",
          lastError:
            i === 3 ? "delivery-service 503 for +2348031234567" : undefined,
        }))}
      />,
    );
    expect(html).toContain("Not started");
    expect(html).toContain("organization budget reserve");
    expect(html).toContain("Commission capture");
    expect(html).toContain("Delivery hand-off");
    expect(html).toContain("Finalize");
    expect(html).toContain("Compensating");
    expect(html).toContain("outcome unknown — the sweep is re-polling");
    // an unknown step is shown verbatim and flagged, never relabelled
    expect(html).toContain("mystery_step");
    expect(html.match(/mp\.admin\.saga\.unknownStep/g)?.length).toBe(1);
    // last errors are scrubbed: no raw phone number reaches the board
    expect(html).not.toContain("+2348031234567");
  });

  it("labels recovery actions and shows amounts as server minor units", () => {
    const html = renderToStaticMarkup(
      <StuckSagaBoard
        {...base}
        recoveries={[
          {
            ...recovery,
            id: "r-1",
            action: "funding_release",
            amountLine: "150,000 minor units",
          },
          { ...recovery, id: "r-2", action: "reserve_replay" },
          { ...recovery, id: "r-3", action: "settle" },
        ]}
      />,
    );
    expect(html).toContain("Rider funding release");
    expect(html).toContain("Reserve replay");
    expect(html).toContain("Completion settlement");
    expect(html).toContain("150,000 minor units");
  });

  it("names owed work that has no admin list endpoint instead of implying it is absent", () => {
    const html = renderToStaticMarkup(<StuckSagaBoard {...base} />);
    expect(html).toContain('data-testid="mp.admin.saga.owedGaps"');
    for (const gap of OWED_WORK_WITHOUT_ADMIN_READ) {
      expect(html).toContain(
        'data-testid="mp.admin.saga.owedGap.' + gap.key + '"',
      );
      expect(html).toContain(gap.missingEndpoint);
    }
  });

  it("shows the step-specific consequence with the preview and blocks a second confirm while applying", () => {
    const html = renderToStaticMarkup(
      <StuckSagaBoard
        {...base}
        active={{
          kind: "reconcile",
          targetId: "award-1",
          phase: "preview",
          message:
            "This award is currently pending at the Delivery hand-off step.",
          note: "Reconciling re-sends the hand-off; no money moves.",
          busy: true,
        }}
      />,
    );
    expect(html).toContain('data-testid="mp.admin.saga.previewNote"');
    expect(html).toContain("no money moves");
    expect(html).toMatch(
      /data-testid="mp\.admin\.saga\.confirm"[^>]*disabled=""/,
    );
    expect(html).toContain("Applying…");
    // no other row can be previewed (re-arming the panel) mid-apply
    expect(html).toMatch(
      /data-testid="mp\.admin\.saga\.previewReconcile\.award-1"[^>]*disabled=""/,
    );
    expect(html).toMatch(
      /data-testid="mp\.admin\.saga\.previewRetry\.rec-1"[^>]*disabled=""/,
    );
    const idle = renderToStaticMarkup(<StuckSagaBoard {...base} />);
    expect(idle).not.toMatch(
      /data-testid="mp\.admin\.saga\.preview(Reconcile|Retry)\.[^"]*"[^>]*disabled=""/,
    );
  });

  it("separates a definite refusal from an ambiguous failure that may only re-send the same key", () => {
    const refused = renderToStaticMarkup(
      <StuckSagaBoard
        {...base}
        active={{
          kind: "retry",
          targetId: "rec-1",
          phase: "error",
          message: "403",
          access: classifyError(new ApiError(403, "forbidden", "no"), true),
        }}
      />,
    );
    expect(refused).toContain('data-testid="ops.access.forbidden"');
    expect(refused).toContain("nothing was applied");
    expect(refused).not.toContain("mp.admin.saga.retrySameKey");

    const ambiguous = renderToStaticMarkup(
      <StuckSagaBoard
        {...base}
        active={{
          kind: "retry",
          targetId: "rec-1",
          phase: "error",
          message: "Failed to fetch",
          access: classifyError(new TypeError("Failed to fetch"), true),
          ambiguous: true,
        }}
      />,
    );
    expect(ambiguous).toContain('data-testid="ops.access.offline"');
    expect(ambiguous).toContain('data-testid="mp.admin.saga.retrySameKey"');
    expect(ambiguous).toContain("same idempotency key");
  });
});
