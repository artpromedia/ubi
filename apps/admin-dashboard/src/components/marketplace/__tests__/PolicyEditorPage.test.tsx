/**
 * Component tests via react-dom/server (no @testing-library dep exists in this
 * repo, so we assert on static markup: fields, invalid states, testids).
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PolicyEditorPage, type PolicyEditorProps } from "../PolicyEditorPage";

const base: PolicyEditorProps = {
  scopeLine: "Marketplace policy · LOS",
  activeVersion: "config v7 · policy v3",
  bounds: [
    {
      label: "ride:go",
      value: "floor ₦1,200 · cost ₦900 · 60%–150%",
      mono: true,
    },
    {
      label: "delivery:moto",
      value: "floor ₦800 · cost ₦600 · 60%–150%",
      mono: true,
    },
  ],
  boundsError: null,
  presets: [{ label: "Bid expiry", value: "2 min" }],
  envelopes: [{ label: "Radius", value: "2.0 → 6.0 km" }],
  previewLine: null,
  audit: [
    { version: "v7", line: "raise moto floor · by ada · approved by chidi" },
  ],
  roleLine: "Publishing requires a second approver.",
  killSwitchScope: "Stops NEW awards only.",
  canPublish: true,
  onSaveDraft: () => undefined,
  onPublish: () => undefined,
  onStopAwards: () => undefined,
};

describe("PolicyEditorPage", () => {
  it("renders the commission row read-only as 10% · 1,000 bps · Fixed with no input", () => {
    const html = renderToStaticMarkup(<PolicyEditorPage {...base} />);
    expect(html).toContain("Marketplace commission");
    expect(html).toContain("10% · 1,000 bps");
    expect(html).toContain("Fixed · not editable");
    expect(html).not.toContain("<input");
  });

  it("renders bounds, presets, envelopes and audit entries", () => {
    const html = renderToStaticMarkup(<PolicyEditorPage {...base} />);
    expect(html).toContain("ride:go");
    expect(html).toContain("delivery:moto");
    expect(html).toContain("Bid expiry");
    expect(html).toContain("2.0 → 6.0 km");
    expect(html).toContain('data-testid="mp.admin.policy.audit"');
    expect(html).toContain("raise moto floor");
  });

  it("enables publish only when canPublish (fail closed on unconfigured floors)", () => {
    const ok = renderToStaticMarkup(<PolicyEditorPage {...base} />);
    expect(ok).toContain('data-testid="mp.admin.policy.publish"');
    expect(ok).not.toMatch(/data-testid="mp\.admin\.policy\.publish" disabled/);

    const blocked = renderToStaticMarkup(
      <PolicyEditorPage
        {...base}
        canPublish={false}
        bounds={[
          { label: "ride:go", value: "Floor unconfigured", invalid: true },
        ]}
        boundsError="1 service:vehicleClass pair(s) have unconfigured floors — publish is blocked (fail closed)."
      />,
    );
    expect(blocked).toMatch(
      /data-testid="mp\.admin\.policy\.publish" disabled/,
    );
    expect(blocked).toContain("border-red-500");
    expect(blocked).toContain("publish is blocked (fail closed)");
  });

  it("renders the kill switch button with its testid and scope note", () => {
    const html = renderToStaticMarkup(<PolicyEditorPage {...base} />);
    expect(html).toContain('data-testid="mp.admin.policy.stopAwards"');
    expect(html).toContain("Stop new awards");
    expect(html).toContain("Stops NEW awards only.");
  });

  it("renders resume awards, city-named kill-switch confirmation, and requires a >=3-char reason (CC-B01)", () => {
    const emptyReasonHtml = renderToStaticMarkup(
      <PolicyEditorPage
        {...base}
        awardsEnabled={false}
        onResumeAwards={() => undefined}
        killSwitchDialog={{
          action: "stop",
          cityId: "LOS",
          reason: "  ",
          onReasonChange: () => undefined,
          onConfirm: () => undefined,
          onCancel: () => undefined,
        }}
      />,
    );
    expect(emptyReasonHtml).toContain(
      'data-testid="mp.admin.policy.resumeAwards"',
    );
    expect(emptyReasonHtml).toContain("Resume new awards");
    expect(emptyReasonHtml).toContain("Awards paused");
    expect(emptyReasonHtml).toContain(
      'data-testid="mp.admin.policy.killSwitchDialog"',
    );
    expect(emptyReasonHtml).toContain(
      "Confirm: stop new marketplace awards in LOS",
    );
    expect(emptyReasonHtml).toMatch(
      /data-testid="mp\.admin\.policy\.killSwitchConfirm" disabled/,
    );

    const validResumeHtml = renderToStaticMarkup(
      <PolicyEditorPage
        {...base}
        awardsEnabled={false}
        onResumeAwards={() => undefined}
        killSwitchDialog={{
          action: "resume",
          cityId: "LOS",
          reason: "Incident mitigated and dispatch verified",
          onReasonChange: () => undefined,
          onConfirm: () => undefined,
          onCancel: () => undefined,
        }}
      />,
    );
    expect(validResumeHtml).toContain(
      "Confirm: resume new marketplace awards in LOS",
    );
    expect(validResumeHtml).not.toMatch(
      /data-testid="mp\.admin\.policy\.killSwitchConfirm" disabled/,
    );
  });

  it("renders pending change requests with dual-approval counts and approve/reject actions (CC-B01)", () => {
    const html = renderToStaticMarkup(
      <PolicyEditorPage
        {...base}
        pendingRequests={[
          {
            id: "cr_los_01",
            cityId: "LOS",
            reason: "Adjust peak envelope radius",
            authorId: "usr_author",
            approvals: 1,
            approvalsRequired: 2,
            approvers: ["usr_approver_one"],
            createdAt: "2026-11-09T12:00:00.000Z",
          },
        ]}
        onApproveRequest={() => undefined}
        onRejectRequest={() => undefined}
        decisionDialog={{
          mode: "reject",
          requestId: "cr_los_01",
          cityId: "LOS",
          text: "",
          onTextChange: () => undefined,
          onConfirm: () => undefined,
          onCancel: () => undefined,
        }}
      />,
    );
    expect(html).toContain('data-testid="mp.admin.policy.pendingRequests"');
    expect(html).toContain("cr_los_01");
    expect(html).toContain("approvals 1/2 (usr_approver_one)");
    expect(html).toContain(
      'data-testid="mp.admin.policy.cr.approve.cr_los_01"',
    );
    expect(html).toContain('data-testid="mp.admin.policy.cr.reject.cr_los_01"');
    // Reject requires a >=3-char reason before Confirm rejection enables.
    expect(html).toMatch(
      /data-testid="mp\.admin\.policy\.decisionConfirm" disabled/,
    );
  });
});
