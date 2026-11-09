"use client";
import React from "react";

/** A03 + A07 + CC-B01 — presentational component wired by src/app/(admin)/marketplace/policies/page.tsx.
 * Commission is rendered read-only at 10% (not grantable to any role). Unconfigured floor inputs
 * block production publish (fail closed). Publish requires a second approver. The kill switch stops
 * NEW publications/awards only — existing bids/holds/awards resolve; it never reverts active jobs,
 * and flipping or resuming requires explicit city confirmation and a non-empty operator reason. */
export type PolicyField = {
  label: string;
  value: string;
  mono?: boolean;
  invalid?: boolean;
};
export type AuditEntry = { version: string; line: string };
export type PendingChangeRequestItem = {
  id: string;
  cityId: string;
  reason: string;
  authorId: string;
  approvals: number;
  approvalsRequired: number;
  approvers: string[];
  createdAt: string;
};
export type KillSwitchDialogProps = {
  action: "stop" | "resume";
  cityId: string;
  reason: string;
  busy?: boolean;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};
export type ChangeRequestDecisionDialogProps = {
  mode: "approve" | "reject";
  requestId: string;
  cityId: string;
  text: string;
  busy?: boolean;
  onTextChange: (text: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
};
export type PolicyEditorProps = {
  scopeLine: string;
  activeVersion: string;
  bounds: PolicyField[];
  boundsError: string | null;
  presets: PolicyField[];
  envelopes: PolicyField[]; // A07: radius/ETA/expansion/dwell/corridor/tolerance
  previewLine: string | null; // simulation result against recorded traffic
  audit: AuditEntry[];
  roleLine: string;
  killSwitchScope: string;
  canPublish: boolean;
  onSaveDraft: () => void;
  onPublish: () => void;
  onStopAwards: () => void;
  onResumeAwards?: () => void;
  awardsEnabled?: boolean | null;
  killSwitchDialog?: KillSwitchDialogProps | null;
  pendingRequests?: PendingChangeRequestItem[];
  onApproveRequest?: (requestId: string) => void;
  onRejectRequest?: (requestId: string) => void;
  decisionDialog?: ChangeRequestDecisionDialogProps | null;
};

function FieldGrid({ fields }: { fields: PolicyField[] }) {
  return (
    <div className="flex gap-3">
      {fields.map((f) => (
        <div key={f.label} className="min-w-0 flex-1">
          <div className="mb-1 text-xs text-neutral-500">{f.label}</div>
          <div
            className={
              "flex h-9 items-center truncate rounded-lg border px-3 text-sm font-semibold " +
              (f.invalid
                ? "border-red-500 bg-red-50 text-red-700"
                : "border-neutral-200 bg-white text-neutral-900") +
              (f.mono ? " font-mono text-xs font-normal" : "")
            }
          >
            {f.value}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PolicyEditorPage(p: PolicyEditorProps) {
  const killReasonValid =
    (p.killSwitchDialog?.reason.trim().length ?? 0) >= 3 &&
    !p.killSwitchDialog?.busy;
  const decisionValid =
    p.decisionDialog !== undefined &&
    p.decisionDialog !== null &&
    !p.decisionDialog.busy &&
    (p.decisionDialog.mode === "approve" ||
      p.decisionDialog.text.trim().length >= 3);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="flex-1 font-semibold text-lg text-neutral-900">
          {p.scopeLine} — {p.activeVersion}{" "}
          <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-green-700">
            Active
          </span>
          {p.awardsEnabled !== undefined && p.awardsEnabled !== null ? (
            <span
              data-testid="mp.admin.policy.awardsFlagBadge"
              className={
                "ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide " +
                (p.awardsEnabled
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-100 text-amber-800")
              }
            >
              {p.awardsEnabled ? "Awards enabled" : "Awards paused"}
            </span>
          ) : null}
        </h1>
        {p.onResumeAwards ? (
          <button
            type="button"
            data-testid="mp.admin.policy.resumeAwards"
            className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800"
            onClick={p.onResumeAwards}
          >
            Resume new awards
          </button>
        ) : null}
        <button
          type="button"
          data-testid="mp.admin.policy.stopAwards"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
          onClick={p.onStopAwards}
        >
          Stop new awards
        </button>
      </div>

      {p.killSwitchDialog ? (
        <section
          role="dialog"
          aria-modal="false"
          aria-label="Confirm marketplace awards flag change"
          data-testid="mp.admin.policy.killSwitchDialog"
          className={
            "rounded-xl border p-4 " +
            (p.killSwitchDialog.action === "stop"
              ? "border-red-300 bg-red-50/70"
              : "border-emerald-300 bg-emerald-50/70")
          }
        >
          <h2 className="text-sm font-semibold text-neutral-900">
            {p.killSwitchDialog.action === "stop"
              ? `Confirm: stop new marketplace awards in ${p.killSwitchDialog.cityId}`
              : `Confirm: resume new marketplace awards in ${p.killSwitchDialog.cityId}`}
          </h2>
          <p className="mt-1 text-xs text-neutral-700">
            Target city:{" "}
            <b className="font-mono">{p.killSwitchDialog.cityId}</b>.{" "}
            {p.killSwitchDialog.action === "stop"
              ? "Stopping sets marketplace_rides = false for this city only; live bids, holds and active trips continue to completion."
              : "Resuming sets marketplace_rides = true for this city so riders can publish and award new marketplace requests."}
          </p>
          <label className="mt-3 block text-xs font-semibold text-neutral-800">
            Audit reason (required, min 3 characters)
            <textarea
              data-testid="mp.admin.policy.killSwitchReason"
              rows={2}
              value={p.killSwitchDialog.reason}
              onChange={(e) =>
                p.killSwitchDialog?.onReasonChange(e.target.value)
              }
              placeholder={`Why are you ${p.killSwitchDialog.action === "stop" ? "stopping" : "resuming"} new awards in ${p.killSwitchDialog.cityId}?`}
              className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-normal text-neutral-900"
            />
          </label>
          <div className="mt-3 flex items-center justify-end gap-2">
            <button
              type="button"
              data-testid="mp.admin.policy.killSwitchCancel"
              onClick={p.killSwitchDialog.onCancel}
              className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-semibold text-neutral-700"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="mp.admin.policy.killSwitchConfirm"
              disabled={!killReasonValid}
              onClick={p.killSwitchDialog.onConfirm}
              className={
                "rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-45 " +
                (p.killSwitchDialog.action === "stop"
                  ? "bg-red-700"
                  : "bg-emerald-700")
              }
            >
              {p.killSwitchDialog.action === "stop"
                ? `Stop awards in ${p.killSwitchDialog.cityId}`
                : `Resume awards in ${p.killSwitchDialog.cityId}`}
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 font-semibold text-neutral-900">
          Fare bounds{" "}
          <span className="text-xs font-normal text-neutral-400">
            — required before market activation; unconfigured markets fail
            closed
          </span>
        </h2>
        <FieldGrid fields={p.bounds} />
        {p.boundsError ? (
          <p className="mt-2 text-xs text-red-700">{p.boundsError}</p>
        ) : null}
      </section>
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 font-semibold text-neutral-900">
          Bid presets &amp; expiry
        </h2>
        <FieldGrid fields={p.presets} />
        <div className="mt-3 flex items-center gap-3 rounded-lg bg-neutral-100 px-3 py-2.5">
          <span className="flex-1 text-sm font-semibold text-neutral-900">
            Marketplace commission
          </span>
          <span className="font-semibold text-neutral-900">
            10% · 1,000 bps
          </span>
          <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-600">
            Fixed · not editable
          </span>
        </div>
      </section>
      <section className="rounded-xl border border-neutral-200 bg-white p-4">
        <h2 className="mb-3 font-semibold text-neutral-900">
          Search &amp; queue envelopes{" "}
          <span className="font-mono text-xs font-normal text-neutral-400">
            A07
          </span>
        </h2>
        <FieldGrid fields={p.envelopes} />
        <div className="mt-3 flex items-center gap-3">
          {p.previewLine ? (
            <div className="flex-1 rounded-lg bg-blue-50 px-3 py-2.5 text-sm text-neutral-900">
              <b>Preview:</b> {p.previewLine}
            </div>
          ) : null}
          <button
            type="button"
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-semibold text-neutral-900"
            onClick={p.onSaveDraft}
          >
            Save draft
          </button>
          <button
            type="button"
            data-testid="mp.admin.policy.publish"
            disabled={!p.canPublish}
            className="rounded-lg bg-admin-secondary px-4 py-2 text-sm font-semibold text-white disabled:opacity-45"
            onClick={p.onPublish}
          >
            Publish · requires 2nd approver
          </button>
        </div>
      </section>

      {p.pendingRequests !== undefined ? (
        <section
          data-testid="mp.admin.policy.pendingRequests"
          className="rounded-xl border border-neutral-200 bg-white p-4"
        >
          <h3 className="mb-2 text-sm font-semibold text-neutral-900">
            Pending change requests (dual approval: 2 distinct approvers other
            than author)
          </h3>
          {p.pendingRequests.length === 0 ? (
            <p className="text-xs text-neutral-500">
              No pending change requests for this city.
            </p>
          ) : (
            <div className="divide-y divide-neutral-100">
              {p.pendingRequests.map((req) => (
                <div
                  key={req.id}
                  data-testid={`mp.admin.policy.cr.${req.id}`}
                  className="flex flex-wrap items-center gap-3 py-2.5 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-neutral-900">
                      <span className="font-mono">{req.id}</span> · {req.reason}
                    </div>
                    <div className="text-neutral-500">
                      by {req.authorId} · approvals {req.approvals}/
                      {req.approvalsRequired}
                      {req.approvers.length > 0
                        ? ` (${req.approvers.join(", ")})`
                        : ""}{" "}
                      · {req.createdAt.slice(0, 10)}
                    </div>
                  </div>
                  {p.onApproveRequest ? (
                    <button
                      type="button"
                      data-testid={`mp.admin.policy.cr.approve.${req.id}`}
                      onClick={() => p.onApproveRequest?.(req.id)}
                      className="rounded-lg bg-emerald-50 px-3 py-1.5 font-semibold text-emerald-800"
                    >
                      Approve
                    </button>
                  ) : null}
                  {p.onRejectRequest ? (
                    <button
                      type="button"
                      data-testid={`mp.admin.policy.cr.reject.${req.id}`}
                      onClick={() => p.onRejectRequest?.(req.id)}
                      className="rounded-lg bg-red-50 px-3 py-1.5 font-semibold text-red-700"
                    >
                      Reject
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {p.decisionDialog ? (
            <div
              data-testid="mp.admin.policy.decisionDialog"
              className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3"
            >
              <div className="text-xs font-semibold text-neutral-900">
                {p.decisionDialog.mode === "approve"
                  ? `Approve change request ${p.decisionDialog.requestId} (${p.decisionDialog.cityId})`
                  : `Reject change request ${p.decisionDialog.requestId} (${p.decisionDialog.cityId})`}
              </div>
              <label className="mt-2 block text-xs text-neutral-700">
                {p.decisionDialog.mode === "approve"
                  ? "Approval note (optional)"
                  : "Rejection reason (required, min 3 characters)"}
                <textarea
                  data-testid="mp.admin.policy.decisionText"
                  rows={2}
                  value={p.decisionDialog.text}
                  onChange={(e) =>
                    p.decisionDialog?.onTextChange(e.target.value)
                  }
                  className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-900"
                />
              </label>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={p.decisionDialog.onCancel}
                  className="rounded-lg border border-neutral-300 bg-white px-2.5 py-1 text-xs font-semibold text-neutral-700"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  data-testid="mp.admin.policy.decisionConfirm"
                  disabled={!decisionValid}
                  onClick={p.decisionDialog.onConfirm}
                  className="rounded-lg bg-neutral-900 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-45"
                >
                  {p.decisionDialog.mode === "approve"
                    ? "Confirm approval"
                    : "Confirm rejection"}
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="grid grid-cols-3 gap-4">
        <section
          className="rounded-xl border border-neutral-200 bg-white p-4"
          data-testid="mp.admin.policy.audit"
        >
          <h3 className="mb-2 text-sm font-semibold text-neutral-900">
            Change audit
          </h3>
          {p.audit.map((a) => (
            <p
              key={a.version}
              className="border-b border-neutral-100 py-2 text-xs text-neutral-500 last:border-0"
            >
              <b className="text-neutral-900">{a.version}</b> · {a.line}
            </p>
          ))}
        </section>
        <section className="rounded-xl border border-neutral-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-900">
            Your role
          </h3>
          <p className="text-xs text-neutral-500">{p.roleLine}</p>
        </section>
        <section className="rounded-xl bg-amber-50 p-4">
          <p className="text-xs text-neutral-900">
            <b>Kill switch scope:</b> {p.killSwitchScope}
          </p>
        </section>
      </div>
    </div>
  );
}
