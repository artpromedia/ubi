"use client";
import React from "react";

import { AccessNotice } from "../ops/AccessNotice";
import { ageLine } from "../../lib/marketplace-api";
import { scrubText } from "../../lib/redact";
import {
  OWED_WORK_WITHOUT_ADMIN_READ,
  attemptStateLabel,
  recoveryInfo,
  stepInfo,
} from "../../lib/saga-steps";

import type { AccessState } from "../../lib/access";

/**
 * C08 — stuck-saga & failed-reservation-recovery board. Every command here
 * is a bounded, idempotent, audited engine action (award reconciliation /
 * recovery retry) — never a raw table edit. A command always previews
 * (dryRun) before it commits, and a stale optimistic-concurrency read
 * (expectedUpdatedAt / expectedAttempts) surfaces as an explicit conflict
 * the operator must re-read before retrying — never a silent overwrite.
 *
 * Rows are labelled by their saga step / recovery action (lib/saga-steps.ts),
 * including the steps rounds 5–7 added (delivery hand-off; the business
 * budget reserve riding the funding step), and each preview states what the
 * command will and will not do to THAT step. Owed work that has no admin
 * list endpoint yet (business budget commit/release, queued delivery
 * cancellation, sealed trip-link SMS) is named in its own panel instead of
 * being implied absent.
 */
export type PendingSagaRow = {
  awardId: string;
  requestId: string;
  driverId: string;
  cityId: string;
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

/** The one in-flight command's visible phase — a preview always precedes an
 * apply; a conflict is its own distinct, explicit phase, never folded into
 * "result"; any other failure is an "error": a definite refusal (wrong
 * role, unverified device) applied nothing, while an ambiguous one (offline,
 * 5xx) offers only a re-send under the SAME idempotency key. */
export type CommandState = {
  kind: "reconcile" | "retry";
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
  active: CommandState;
  onPreviewReconcile: (awardId: string) => void;
  onConfirmReconcile: (awardId: string) => void;
  onPreviewRetry: (id: string) => void;
  onConfirmRetry: (id: string) => void;
  onCancel: () => void;
};

const OUTCOME_TONE: Record<string, string> = {
  resolved: "bg-green-50 text-green-700",
  unresolved: "bg-amber-50 text-amber-700",
  deferred: "bg-amber-50 text-amber-700",
  already_resolved: "bg-neutral-100 text-neutral-600",
};

function CommandPanel({
  active,
  onConfirm,
  onCancel,
}: {
  active: CommandState;
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
      <div className="mt-2">
        <button
          data-testid="mp.admin.saga.confirm"
          disabled={active.busy === true}
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
  return (
    <div className="flex flex-col gap-4 p-6" data-testid="mp.admin.saga.board">
      <CommandPanel
        active={p.active}
        onConfirm={() =>
          p.active?.kind === "reconcile"
            ? p.onConfirmReconcile(p.active.targetId)
            : p.active
              ? p.onConfirmRetry(p.active.targetId)
              : undefined
        }
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
