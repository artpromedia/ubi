"use client";
import React from "react";

import { AccessNotice } from "../ops/AccessNotice";
import { ageLine } from "../../lib/marketplace-api";
import { scrubText } from "../../lib/redact";
import {
  DELIVERY_CANCEL_RETRY_NOTE,
  OWED_WORK_WITHOUT_ADMIN_READ,
  attemptStateLabel,
  businessOpInfo,
  recoveryInfo,
  stepInfo,
} from "../../lib/saga-steps";

import type { AccessState } from "../../lib/access";

/**
 * C08 — stuck-saga & failed-reservation-recovery board. Every command here
 * is a bounded, idempotent, audited engine action (award reconciliation /
 * recovery retry / owed business-budget retry / delivery cancellation retry)
 * — never a raw table edit. A command always previews (dryRun) before it
 * commits, and a stale optimistic-concurrency read (expectedUpdatedAt /
 * expectedAttempts) surfaces as an explicit conflict the operator must
 * re-read before retrying — never a silent overwrite.
 */
export type PendingSagaRow = {
  awardId: string;
  requestId: string;
  driverId: string;
  cityId: string;
  fundingSource?: string;
  step: string;
  attemptState: string;
  attempts: number;
  lastError?: string;
  ageSec: number;
  updatedAt: string;
};
export type RecoveryRow = {
  id: string;
  action: string;
  driverId: string;
  reservationId: string;
  attempts: number;
  lastError?: string;
  ageSec: number;
  amountLine?: string;
};
export type OwedBusinessBookingRow = {
  awardId: string;
  requestId: string;
  organizationId: string;
  owedOp: string;
  owedLine: string;
  reservedLine: string;
  attempts: number;
  lastError?: string;
  ageSec: number;
};
export type PendingDeliveryCancelRow = {
  awardId: string;
  requestId: string;
  deliveryId: string;
  cancelledBy: string;
  reason?: string;
  attempts: number;
  lastError?: string;
  ageSec: number;
};

export type CommandKind =
  | "reconcile"
  | "retry"
  | "retryBusiness"
  | "retryDeliveryCancel";

/** The one in-flight command's visible phase — a preview always precedes an
 * apply; a conflict is its own distinct, explicit phase, never folded into
 * "result"; any other failure is an "error": a definite refusal (wrong
 * role, unverified device) applied nothing, while an ambiguous one (offline,
 * 5xx) offers only a re-send under the SAME idempotency key. */
export type CommandState = {
  kind: CommandKind;
  targetId: string;
  phase: "preview" | "conflict" | "result" | "error";
  message: string;
  /** Step/action-specific consequence shown with the preview. */
  note?: string;
  outcome?: string;
  /** The apply is in flight: the confirm control is disabled. */
  busy?: boolean;
  /** A classified failure for the "error" phase. */
  access?: AccessState;
  /** The failure left the outcome unknown (network / 5xx): confirming again
   * re-sends the SAME idempotency key, so the server applies it at most once. */
  ambiguous?: boolean;
} | null;

export type StuckSagaBoardProps = {
  sagasLoading: boolean;
  sagasError: AccessState | null;
  sagas: PendingSagaRow[];
  recoveriesLoading: boolean;
  recoveriesError: AccessState | null;
  recoveries: RecoveryRow[];
  owedBusinessLoading?: boolean;
  owedBusinessError?: AccessState | null;
  owedBusiness?: OwedBusinessBookingRow[];
  deliveryCancelsLoading?: boolean;
  deliveryCancelsError?: AccessState | null;
  deliveryCancels?: PendingDeliveryCancelRow[];
  active: CommandState;
  reason?: string;
  onReasonChange?: (reason: string) => void;
  onPreviewReconcile: (awardId: string) => void;
  onConfirmReconcile: (awardId: string) => void;
  onPreviewRetry: (id: string) => void;
  onConfirmRetry: (id: string) => void;
  onPreviewRetryBusiness?: (awardId: string) => void;
  onConfirmRetryBusiness?: (awardId: string, reason: string) => void;
  onPreviewRetryDeliveryCancel?: (awardId: string) => void;
  onConfirmRetryDeliveryCancel?: (awardId: string, reason: string) => void;
  onCancel: () => void;
};

const OUTCOME_TONE: Record<string, string> = {
  resolved: "bg-green-50 text-green-700",
  unresolved: "bg-amber-50 text-amber-700",
  deferred: "bg-amber-50 text-amber-700",
  already_resolved: "bg-neutral-100 text-neutral-600",
};

function requiresOperatorReason(kind: CommandKind): boolean {
  return kind === "retryBusiness" || kind === "retryDeliveryCancel";
}

function CommandPanel({
  active,
  reason,
  onReasonChange,
  onConfirm,
  onCancel,
}: {
  active: CommandState;
  reason: string;
  onReasonChange?: (reason: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!active) {
    return null;
  }
  if (active.phase === "conflict") {
    return (
      <div
        className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800"
        data-testid="mp.admin.saga.conflict"
      >
        <b>Version conflict:</b> {active.message} Reload this row and try again
        — nothing was changed.
        <button
          className="ml-3 font-semibold underline"
          onClick={onCancel}
          data-testid="mp.admin.saga.dismiss"
        >
          Dismiss
        </button>
      </div>
    );
  }
  if (active.phase === "error") {
    return (
      <div className="flex flex-col gap-2" data-testid="mp.admin.saga.error">
        {active.access ? (
          <AccessNotice
            state={active.access}
            context={
              (active.kind === "reconcile" ? "reconcile " : "retry ") +
              active.targetId
            }
          />
        ) : null}
        {active.ambiguous ? (
          <p
            className="text-xs text-neutral-700"
            data-testid="mp.admin.saga.ambiguous"
          >
            The outcome is unknown — the command may have reached UBI.
            Confirming again re-sends the same idempotency key, so it is applied
            at most once.{" "}
            <button
              className="font-semibold underline"
              data-testid="mp.admin.saga.retrySameKey"
              disabled={active.busy === true}
              onClick={onConfirm}
            >
              Confirm again (same key)
            </button>{" "}
            <button className="font-semibold underline" onClick={onCancel}>
              Dismiss
            </button>
          </p>
        ) : (
          <p className="text-xs text-neutral-600">
            Refused — nothing was applied.{" "}
            <button className="font-semibold underline" onClick={onCancel}>
              Dismiss
            </button>
          </p>
        )}
      </div>
    );
  }
  if (active.phase === "result") {
    return (
      <div
        className={
          "rounded-xl p-3 text-xs " +
          (OUTCOME_TONE[active.outcome ?? ""] ??
            "bg-neutral-100 text-neutral-700")
        }
        data-testid="mp.admin.saga.result"
      >
        <b>{active.outcome}:</b> {active.message}
        <button className="ml-3 font-semibold underline" onClick={onCancel}>
          Close
        </button>
      </div>
    );
  }
  const needsReason = requiresOperatorReason(active.kind);
  const canConfirm =
    active.busy !== true && (!needsReason || reason.trim().length > 0);
  // preview
  return (
    <div
      className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900"
      data-testid="mp.admin.saga.preview"
    >
      <b>Preview — nothing has been applied yet.</b> {active.message}
      {active.note ? (
        <p className="mt-1" data-testid="mp.admin.saga.previewNote">
          {active.note}
        </p>
      ) : null}
      {needsReason ? (
        <div className="mt-2">
          <label
            htmlFor="mp-admin-saga-reason"
            className="block text-[11px] font-semibold text-blue-900"
          >
            Audit reason (required)
            <input
              id="mp-admin-saga-reason"
              type="text"
              value={reason}
              disabled={active.busy === true}
              onChange={(e) => onReasonChange?.(e.target.value)}
              placeholder="Why are you retrying this owed operation now?"
              data-testid="mp.admin.saga.reason"
              className="mt-1 block w-full max-w-lg rounded-lg border border-blue-300 bg-white px-2.5 py-1 text-xs font-normal text-neutral-900"
            />
          </label>
        </div>
      ) : null}
      <div className="mt-2">
        <button
          data-testid="mp.admin.saga.confirm"
          disabled={!canConfirm}
          className="rounded-lg bg-admin-secondary px-3 py-1 font-semibold text-white disabled:opacity-50"
          onClick={onConfirm}
        >
          {active.busy ? "Applying…" : "Confirm & apply"}
        </button>
        <button
          className="ml-2 font-semibold underline"
          onClick={onCancel}
          disabled={active.busy === true}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function StuckSagaBoard(p: StuckSagaBoardProps) {
  // While a confirmed command is in flight no other row can be previewed:
  // the confirm panel stays bound to the command that was sent.
  const applying = p.active?.busy === true;
  const reason = p.reason ?? "";
  const owedBusiness = p.owedBusiness ?? [];
  const deliveryCancels = p.deliveryCancels ?? [];
  return (
    <div className="flex flex-col gap-4 p-6" data-testid="mp.admin.saga.board">
      <CommandPanel
        active={p.active}
        reason={reason}
        onReasonChange={p.onReasonChange}
        onConfirm={() => {
          if (!p.active) return;
          if (p.active.kind === "reconcile") {
            p.onConfirmReconcile(p.active.targetId);
          } else if (p.active.kind === "retry") {
            p.onConfirmRetry(p.active.targetId);
          } else if (p.active.kind === "retryBusiness") {
            p.onConfirmRetryBusiness?.(p.active.targetId, reason.trim());
          } else {
            p.onConfirmRetryDeliveryCancel?.(p.active.targetId, reason.trim());
          }
        }}
        onCancel={p.onCancel}
      />

      <section>
        <h2 className="mb-2 font-semibold text-neutral-900">
          Stuck sagas{" "}
          <span className="text-xs font-normal text-neutral-400">
            awards in award_pending — never reopened, only reconciled
          </span>
        </h2>
        {p.sagasError ? (
          <div data-testid="mp.admin.saga.sagasError">
            <AccessNotice state={p.sagasError} context="pending sagas" />
          </div>
        ) : p.sagasLoading ? (
          <p className="text-xs text-neutral-500">Loading…</p>
        ) : p.sagas.length === 0 ? (
          <p
            className="text-xs text-neutral-500"
            data-testid="mp.admin.saga.sagasEmpty"
          >
            No awards are stuck in award_pending right now.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table
              className="w-full text-sm"
              data-testid="mp.admin.saga.sagasTable"
            >
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2 font-semibold">Award</th>
                  <th className="px-4 py-2 font-semibold">Driver</th>
                  <th className="px-4 py-2 font-semibold">Step</th>
                  <th className="px-4 py-2 font-semibold">Attempts</th>
                  <th className="px-4 py-2 font-semibold">Age</th>
                  <th className="px-4 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {p.sagas.map((s) => {
                  const step = stepInfo(s.step);
                  return (
                    <tr
                      key={s.awardId}
                      className="border-b border-neutral-100 align-top last:border-0"
                      data-testid={"mp.admin.saga.row." + s.awardId}
                    >
                      <td className="px-4 py-2 font-mono text-xs">
                        {s.awardId}
                        <div className="text-[10px] text-neutral-400">
                          request {s.requestId}
                          {s.fundingSource
                            ? " · funded: " + scrubText(s.fundingSource)
                            : ""}
                        </div>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {s.driverId}
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-semibold text-neutral-900">
                          {step.label}
                          {step.known ? null : (
                            <span
                              className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-700"
                              data-testid="mp.admin.saga.unknownStep"
                            >
                              unrecognised
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {step.detail}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {attemptStateLabel(s.attemptState)}
                          {s.lastError
                            ? " · last error: " + scrubText(s.lastError)
                            : ""}
                        </div>
                      </td>
                      <td className="px-4 py-2 tabular-nums">{s.attempts}</td>
                      <td className="px-4 py-2 tabular-nums">
                        {ageLine(s.ageSec)}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          data-testid={
                            "mp.admin.saga.previewReconcile." + s.awardId
                          }
                          disabled={applying}
                          className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-900 disabled:opacity-40"
                          onClick={() => p.onPreviewReconcile(s.awardId)}
                        >
                          Preview reconcile
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-semibold text-neutral-900">
          Failed reservation recovery{" "}
          <span className="text-xs font-normal text-neutral-400">
            unresolved holds/reserves/settlements the sweep still owes
          </span>
        </h2>
        {p.recoveriesError ? (
          <div data-testid="mp.admin.saga.recoveriesError">
            <AccessNotice state={p.recoveriesError} context="recoveries" />
          </div>
        ) : p.recoveriesLoading ? (
          <p className="text-xs text-neutral-500">Loading…</p>
        ) : p.recoveries.length === 0 ? (
          <p
            className="text-xs text-neutral-500"
            data-testid="mp.admin.saga.recoveriesEmpty"
          >
            No unresolved recovery rows right now.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table
              className="w-full text-sm"
              data-testid="mp.admin.saga.recoveriesTable"
            >
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2 font-semibold">Action</th>
                  <th className="px-4 py-2 font-semibold">Driver</th>
                  <th className="px-4 py-2 font-semibold">Amount</th>
                  <th className="px-4 py-2 font-semibold">Attempts</th>
                  <th className="px-4 py-2 font-semibold">Age</th>
                  <th className="px-4 py-2 font-semibold">Last error</th>
                  <th className="px-4 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {p.recoveries.map((r) => {
                  const info = recoveryInfo(r.action);
                  return (
                    <tr
                      key={r.id}
                      className="border-b border-neutral-100 last:border-0"
                    >
                      <td className="px-4 py-2">
                        <div className="text-xs font-semibold text-neutral-900">
                          {info.label}
                          {info.known ? null : (
                            <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] text-amber-700">
                              unrecognised
                            </span>
                          )}
                        </div>
                        <div className="font-mono text-[10px] text-neutral-400">
                          {r.action}
                        </div>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {r.driverId}
                      </td>
                      <td className="px-4 py-2 text-xs tabular-nums">
                        {r.amountLine ?? "—"}
                      </td>
                      <td className="px-4 py-2 tabular-nums">{r.attempts}</td>
                      <td className="px-4 py-2 tabular-nums">
                        {ageLine(r.ageSec)}
                      </td>
                      <td className="px-4 py-2 text-xs text-neutral-500">
                        {r.lastError ? scrubText(r.lastError) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          data-testid={"mp.admin.saga.previewRetry." + r.id}
                          disabled={applying}
                          className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-900 disabled:opacity-40"
                          onClick={() => p.onPreviewRetry(r.id)}
                        >
                          Preview retry
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section data-testid="mp.admin.saga.owedBusinessSection">
        <h2 className="mb-2 font-semibold text-neutral-900">
          Owed business budget operations{" "}
          <span className="text-xs font-normal text-neutral-400">
            organization budget commit/release/increase owed to payment-service
          </span>
        </h2>
        {p.owedBusinessError ? (
          <div data-testid="mp.admin.saga.owedBusinessError">
            <AccessNotice
              state={p.owedBusinessError}
              context="owed business bookings"
            />
          </div>
        ) : p.owedBusinessLoading ? (
          <p className="text-xs text-neutral-500">Loading…</p>
        ) : owedBusiness.length === 0 ? (
          <p
            className="text-xs text-neutral-500"
            data-testid="mp.admin.saga.owedBusinessEmpty"
          >
            No owed business budget operations right now.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table
              className="w-full text-sm"
              data-testid="mp.admin.saga.owedBusinessTable"
            >
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2 font-semibold">Award</th>
                  <th className="px-4 py-2 font-semibold">Organization</th>
                  <th className="px-4 py-2 font-semibold">Owed op</th>
                  <th className="px-4 py-2 font-semibold">Owed / Reserved</th>
                  <th className="px-4 py-2 font-semibold">Attempts</th>
                  <th className="px-4 py-2 font-semibold">Age</th>
                  <th className="px-4 py-2 font-semibold">Last error</th>
                  <th className="px-4 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {owedBusiness.map((b) => {
                  const info = businessOpInfo(b.owedOp);
                  return (
                    <tr
                      key={b.awardId}
                      className="border-b border-neutral-100 last:border-0"
                      data-testid={"mp.admin.saga.owedBusinessRow." + b.awardId}
                    >
                      <td className="px-4 py-2 font-mono text-xs">
                        {b.awardId}
                        <div className="text-[10px] text-neutral-400">
                          request {b.requestId}
                        </div>
                      </td>
                      <td className="px-4 py-2 font-mono text-xs">
                        {b.organizationId}
                      </td>
                      <td className="px-4 py-2">
                        <div className="text-xs font-semibold text-neutral-900">
                          {info.label}
                        </div>
                        <div className="font-mono text-[10px] text-neutral-400">
                          {b.owedOp}
                        </div>
                      </td>
                      <td className="px-4 py-2 text-xs tabular-nums">
                        <div>{b.owedLine}</div>
                        <div className="text-[10px] text-neutral-400">
                          reserved {b.reservedLine}
                        </div>
                      </td>
                      <td className="px-4 py-2 tabular-nums">{b.attempts}</td>
                      <td className="px-4 py-2 tabular-nums">
                        {ageLine(b.ageSec)}
                      </td>
                      <td className="px-4 py-2 text-xs text-neutral-500">
                        {b.lastError ? scrubText(b.lastError) : "—"}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button
                          data-testid={
                            "mp.admin.saga.previewRetryBusiness." + b.awardId
                          }
                          disabled={applying}
                          className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-900 disabled:opacity-40"
                          onClick={() => p.onPreviewRetryBusiness?.(b.awardId)}
                        >
                          Preview retry
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section data-testid="mp.admin.saga.deliveryCancelsSection">
        <h2 className="mb-2 font-semibold text-neutral-900">
          Queued delivery cancellations{" "}
          <span className="text-xs font-normal text-neutral-400">
            pending cancellations owed to delivery-service
          </span>
        </h2>
        {p.deliveryCancelsError ? (
          <div data-testid="mp.admin.saga.deliveryCancelsError">
            <AccessNotice
              state={p.deliveryCancelsError}
              context="pending delivery cancellations"
            />
          </div>
        ) : p.deliveryCancelsLoading ? (
          <p className="text-xs text-neutral-500">Loading…</p>
        ) : deliveryCancels.length === 0 ? (
          <p
            className="text-xs text-neutral-500"
            data-testid="mp.admin.saga.deliveryCancelsEmpty"
          >
            No pending delivery cancellations right now.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
            <table
              className="w-full text-sm"
              data-testid="mp.admin.saga.deliveryCancelsTable"
            >
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2 font-semibold">Award</th>
                  <th className="px-4 py-2 font-semibold">Delivery</th>
                  <th className="px-4 py-2 font-semibold">Cancelled by</th>
                  <th className="px-4 py-2 font-semibold">Attempts</th>
                  <th className="px-4 py-2 font-semibold">Age</th>
                  <th className="px-4 py-2 font-semibold">Last error</th>
                  <th className="px-4 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {deliveryCancels.map((d) => (
                  <tr
                    key={d.awardId}
                    className="border-b border-neutral-100 last:border-0"
                    data-testid={"mp.admin.saga.deliveryCancelRow." + d.awardId}
                  >
                    <td className="px-4 py-2 font-mono text-xs">
                      {d.awardId}
                      <div className="text-[10px] text-neutral-400">
                        request {d.requestId}
                      </div>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {d.deliveryId}
                    </td>
                    <td className="px-4 py-2 text-xs">
                      <span className="font-semibold text-neutral-900">
                        {scrubText(d.cancelledBy)}
                      </span>
                      {d.reason ? (
                        <div className="text-[10px] text-neutral-500">
                          {scrubText(d.reason)}
                        </div>
                      ) : null}
                      <div className="text-[10px] text-neutral-400">
                        {DELIVERY_CANCEL_RETRY_NOTE}
                      </div>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{d.attempts}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {ageLine(d.ageSec)}
                    </td>
                    <td className="px-4 py-2 text-xs text-neutral-500">
                      {d.lastError ? scrubText(d.lastError) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        data-testid={
                          "mp.admin.saga.previewRetryDeliveryCancel." +
                          d.awardId
                        }
                        disabled={applying}
                        className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-900 disabled:opacity-40"
                        onClick={() =>
                          p.onPreviewRetryDeliveryCancel?.(d.awardId)
                        }
                      >
                        Preview retry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section data-testid="mp.admin.saga.owedGaps">
        <h2 className="mb-2 font-semibold text-neutral-900">
          Owed work with no admin list yet{" "}
          <span className="text-xs font-normal text-neutral-400">
            durable and swept by the services — named, not fabricated
          </span>
        </h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {OWED_WORK_WITHOUT_ADMIN_READ.map((g) => (
            <div
              key={g.key}
              className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-neutral-900"
              data-testid={"mp.admin.saga.owedGap." + g.key}
            >
              <p className="font-semibold">{g.title}</p>
              <p className="mt-1 text-neutral-700">{g.where}</p>
              <p className="mt-1 text-neutral-700">
                Missing: <code className="font-mono">{g.missingEndpoint}</code>
              </p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
