"use client";
import React from "react";

import { AccessNotice } from "@/components/ops/AccessNotice";
import { type AccessState } from "@/lib/access";
import {
  type OffroadFlagDecision,
  type OffroadUseFlagView,
} from "@/lib/marketplace-api";

export type OffroadFlagDecisionState = {
  flagId: string;
  decision: OffroadFlagDecision;
  busy?: boolean;
  error?: string;
  access?: AccessState;
  resultMessage?: string;
} | null;

export type OffroadFlagsBoardProps = {
  loading?: boolean;
  error?: AccessState | null;
  flags?: OffroadUseFlagView[];
  selectedFlagId?: string | null;
  activeDecision?: OffroadFlagDecisionState;
  reason?: string;
  onSelectFlag?: (flagId: string | null) => void;
  onSelectAction?: (flagId: string, decision: OffroadFlagDecision) => void;
  onReasonChange?: (reason: string) => void;
  onSubmitDecision?: () => void;
  onCancelDecision?: () => void;
};

const DECISION_OPTIONS: {
  value: OffroadFlagDecision;
  label: string;
  description: string;
}[] = [
  {
    value: "dismiss",
    label: "Dismiss flag",
    description:
      "False positive or authorized yard/workshop movement; no fleet or driver action.",
  },
  {
    value: "warn_fleet",
    label: "Warn fleet",
    description:
      "Records an audited fleet warning for repeated or unverified off-road declaration.",
  },
  {
    value: "escalate_to_standing",
    label: "Escalate to standing",
    description:
      "Opens a policy_violation standing action (maker-checker protected) in the same transaction.",
  },
];

function triggerLabel(trigger: string): string {
  switch (trigger) {
    case "driver_online":
      return "Driver went online during off-road block";
    case "trip_started":
      return "Trip started during off-road block";
    case "booking_activated":
      return "Booking activated during off-road block";
    default:
      return trigger;
  }
}

/**
 * P2-02 — Off-Road Abuse Flags operator board.
 *
 * Reads `GET /v1/admin/mp/offroad-flags` and submits audited, idempotent
 * dispositions via `POST /v1/admin/mp/offroad-flags/:flagId/decide`.
 */
export function OffroadFlagsBoard({
  loading = false,
  error = null,
  flags = [],
  selectedFlagId = null,
  activeDecision = null,
  reason = "",
  onSelectFlag,
  onSelectAction,
  onReasonChange,
  onSubmitDecision,
  onCancelDecision,
}: Readonly<OffroadFlagsBoardProps>) {
  const selectedFlag =
    flags.find((f) => f.flagId === selectedFlagId) ??
    (activeDecision
      ? (flags.find((f) => f.flagId === activeDecision.flagId) ?? null)
      : null);

  const canSubmit =
    Boolean(activeDecision) &&
    !activeDecision?.busy &&
    reason.trim().length >= 3;

  return (
    <section
      className="flex flex-col gap-4 border-t border-neutral-200 p-6"
      data-testid="admin.offroadFlags.board"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">
            Off-road abuse flags
          </h2>
          <p className="mt-1 text-xs text-neutral-600">
            Vehicles reported off-road that simultaneously triggered{" "}
            <code className="font-mono">driver_online</code>,{" "}
            <code className="font-mono">trip_started</code>, or{" "}
            <code className="font-mono">booking_activated</code>. Every decision
            requires an operator reason and writes an idempotent audit record.
          </p>
        </div>
        <span className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-xs text-neutral-700">
          Open flags:{" "}
          <strong className="font-mono text-amber-700">
            {flags.filter((f) => !f.decision).length}
          </strong>{" "}
          / {flags.length}
        </span>
      </div>

      {error ? (
        <div data-testid="admin.offroadFlags.error">
          <AccessNotice state={error} context="the off-road abuse flags feed" />
        </div>
      ) : loading ? (
        <div
          className="rounded-xl border border-neutral-200 bg-white p-5 text-xs text-neutral-500"
          data-testid="admin.offroadFlags.loading"
        >
          Loading off-road abuse flags…
        </div>
      ) : flags.length === 0 ? (
        <div
          className="rounded-xl border border-neutral-200 bg-white p-5 text-xs text-neutral-500"
          data-testid="admin.offroadFlags.empty"
        >
          No off-road abuse flags recorded.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
              <tr>
                <th className="p-3">Flag / Block</th>
                <th className="p-3">Vehicle / Driver</th>
                <th className="p-3">City</th>
                <th className="p-3">Trigger &amp; Subject</th>
                <th className="p-3">Flagged At</th>
                <th className="p-3">Disposition</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {flags.map((flag) => {
                const isSelected = selectedFlag?.flagId === flag.flagId;
                return (
                  <tr
                    key={flag.flagId}
                    data-testid="admin.offroadFlags.row"
                    data-flag-id={flag.flagId}
                    className={
                      isSelected ? "bg-amber-50/40" : "hover:bg-neutral-50/70"
                    }
                  >
                    <td className="p-3 font-mono text-[11px]">
                      <div className="font-medium text-neutral-900">
                        {flag.flagId}
                      </div>
                      <div className="text-neutral-500">
                        block: {flag.blockId}
                      </div>
                    </td>
                    <td className="p-3 font-mono text-[11px]">
                      <div className="text-neutral-900">
                        veh: {flag.vehicleId}
                      </div>
                      <div className="text-neutral-500">
                        drv: {flag.driverId}
                      </div>
                    </td>
                    <td className="p-3 font-mono text-[11px] text-neutral-800">
                      {flag.cityId}
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-amber-900">
                        {triggerLabel(flag.trigger)}
                      </div>
                      <div className="font-mono text-[11px] text-neutral-500">
                        ref: {flag.subjectRef}
                      </div>
                    </td>
                    <td className="p-3 font-mono text-[11px] text-neutral-700">
                      {flag.flaggedAt}
                    </td>
                    <td className="p-3">
                      {flag.decision ? (
                        <div>
                          <span className="inline-block rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-800">
                            {flag.decision}
                          </span>
                          {flag.decisionReason ? (
                            <div className="mt-0.5 text-[11px] text-neutral-500">
                              {flag.decisionReason}
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <span className="inline-block rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 font-mono text-[11px] font-medium text-amber-800">
                          undecided
                        </span>
                      )}
                    </td>
                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          onSelectFlag?.(isSelected ? null : flag.flagId)
                        }
                        className="rounded border border-neutral-200 bg-white px-2.5 py-1 text-[11px] font-medium text-neutral-800 hover:bg-neutral-50"
                      >
                        {isSelected ? "Close" : "Review & decide"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail & Decision Panel */}
      {selectedFlag ? (
        <div
          className="rounded-xl border border-neutral-200 bg-white p-4 text-xs"
          data-testid="admin.offroadFlags.detail"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-100 pb-3">
            <div>
              <h3 className="font-semibold text-neutral-900">
                Off-Road Flag Review · {selectedFlag.flagId}
              </h3>
              <p className="font-mono text-[11px] text-neutral-500">
                vehicle {selectedFlag.vehicleId} · driver{" "}
                {selectedFlag.driverId} · block {selectedFlag.blockId} ·
                subjectRef {selectedFlag.subjectRef}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                onSelectFlag?.(null);
                onCancelDecision?.();
              }}
              className="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
            >
              Close
            </button>
          </div>

          {selectedFlag.decision ? (
            <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
              <p className="font-semibold">
                Decided:{" "}
                <span className="font-mono">{selectedFlag.decision}</span>
              </p>
              <p className="mt-1 text-[11px]">
                By {selectedFlag.decidedBy ?? "operator"} at{" "}
                {selectedFlag.decidedAt ?? "—"} — Reason:{" "}
                {selectedFlag.decisionReason ?? "—"}
                {selectedFlag.standingActionId
                  ? ` · Standing action ${selectedFlag.standingActionId}`
                  : ""}
              </p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                {DECISION_OPTIONS.map((opt) => {
                  const chosen =
                    activeDecision?.flagId === selectedFlag.flagId &&
                    activeDecision.decision === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      data-testid={`admin.offroadFlags.action.${opt.value}`}
                      onClick={() =>
                        onSelectAction?.(selectedFlag.flagId, opt.value)
                      }
                      className={
                        "rounded-lg border p-3 text-left transition " +
                        (chosen
                          ? "border-neutral-900 bg-neutral-900 text-white"
                          : "border-neutral-200 bg-neutral-50 text-neutral-900 hover:bg-neutral-100")
                      }
                    >
                      <div className="font-semibold">{opt.label}</div>
                      <div
                        className={
                          "mt-1 text-[11px] " +
                          (chosen ? "text-neutral-200" : "text-neutral-600")
                        }
                      >
                        {opt.description}
                      </div>
                    </button>
                  );
                })}
              </div>

              <div>
                <label
                  htmlFor="offroad-flag-reason"
                  className="block text-[11px] font-medium text-neutral-700"
                >
                  Operator reason (required, min 3 characters)
                </label>
                <input
                  id="offroad-flag-reason"
                  type="text"
                  data-testid="admin.offroadFlags.reason"
                  value={reason}
                  onChange={(e) => onReasonChange?.(e.target.value)}
                  placeholder="Cite verification evidence, fleet contact, or pattern observed…"
                  className="mt-1 w-full max-w-xl rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-900"
                />
              </div>

              {activeDecision?.error ? (
                <p
                  className="text-xs font-medium text-red-700"
                  data-testid="admin.offroadFlags.actionError"
                >
                  {activeDecision.error}
                </p>
              ) : null}

              {activeDecision?.resultMessage ? (
                <p
                  className="text-xs font-medium text-emerald-700"
                  data-testid="admin.offroadFlags.resultMessage"
                >
                  {activeDecision.resultMessage}
                </p>
              ) : null}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="admin.offroadFlags.submit"
                  disabled={!canSubmit}
                  onClick={() => onSubmitDecision?.()}
                  className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {activeDecision?.busy ? "Submitting…" : "Record decision"}
                </button>
                {activeDecision ? (
                  <button
                    type="button"
                    onClick={() => onCancelDecision?.()}
                    className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700"
                  >
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
