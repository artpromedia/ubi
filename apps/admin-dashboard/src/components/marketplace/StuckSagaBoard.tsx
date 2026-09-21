"use client";
import React from "react";

/**
 * C08 — stuck-saga & failed-reservation-recovery board. Every command here
 * is a bounded, idempotent, audited engine action (award reconciliation /
 * recovery retry) — never a raw table edit. A command always previews
 * (dryRun) before it commits, and a stale optimistic-concurrency read
 * (expectedUpdatedAt / expectedAttempts) surfaces as an explicit conflict
 * the operator must re-read before retrying — never a silent overwrite.
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
 * "result". */
export type CommandState = {
  kind: "reconcile" | "retry";
  targetId: string;
  phase: "preview" | "conflict" | "result";
  message: string;
  outcome?: string;
} | null;

export type StuckSagaBoardProps = {
  sagasLoading: boolean;
  sagasError: string | null;
  sagas: PendingSagaRow[];
  recoveriesLoading: boolean;
  recoveriesError: string | null;
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
  if (!active) return null;
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
      <button
        data-testid="mp.admin.saga.confirm"
        className="ml-3 rounded-lg bg-admin-secondary px-3 py-1 font-semibold text-white"
        onClick={onConfirm}
      >
        Confirm &amp; apply
      </button>
      <button className="ml-2 font-semibold underline" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

export function StuckSagaBoard(p: StuckSagaBoardProps) {
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
          <p
            className="text-xs text-red-700"
            data-testid="mp.admin.saga.sagasError"
          >
            Could not load pending sagas: {p.sagasError}
          </p>
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
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
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
                {p.sagas.map((s) => (
                  <tr
                    key={s.awardId}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="px-4 py-2 font-mono text-xs">{s.awardId}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {s.driverId}
                    </td>
                    <td className="px-4 py-2">{s.step || "—"}</td>
                    <td className="px-4 py-2 tabular-nums">{s.attempts}</td>
                    <td className="px-4 py-2 tabular-nums">{s.ageSec}s</td>
                    <td className="px-4 py-2 text-right">
                      <button
                        data-testid={
                          "mp.admin.saga.previewReconcile." + s.awardId
                        }
                        className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-900"
                        onClick={() => p.onPreviewReconcile(s.awardId)}
                      >
                        Preview reconcile
                      </button>
                    </td>
                  </tr>
                ))}
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
          <p
            className="text-xs text-red-700"
            data-testid="mp.admin.saga.recoveriesError"
          >
            Could not load recoveries: {p.recoveriesError}
          </p>
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
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <table
              className="w-full text-sm"
              data-testid="mp.admin.saga.recoveriesTable"
            >
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2 font-semibold">Action</th>
                  <th className="px-4 py-2 font-semibold">Driver</th>
                  <th className="px-4 py-2 font-semibold">Attempts</th>
                  <th className="px-4 py-2 font-semibold">Age</th>
                  <th className="px-4 py-2 font-semibold">Last error</th>
                  <th className="px-4 py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {p.recoveries.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="px-4 py-2 font-mono text-xs">{r.action}</td>
                    <td className="px-4 py-2 font-mono text-xs">
                      {r.driverId}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{r.attempts}</td>
                    <td className="px-4 py-2 tabular-nums">{r.ageSec}s</td>
                    <td className="px-4 py-2 text-xs text-neutral-500">
                      {r.lastError ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        data-testid={"mp.admin.saga.previewRetry." + r.id}
                        className="rounded-lg border border-neutral-200 px-2 py-1 text-xs font-semibold text-neutral-900"
                        onClick={() => p.onPreviewRetry(r.id)}
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
    </div>
  );
}
