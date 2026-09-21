"use client";
import React, { useState } from "react";

/**
 * C08 — cancellations/no-shows, driver standing and the appeals workflow.
 * Every standing action is reason-coded and audited. Suspension and
 * reinstatement are PROTECTED: maker-checker — the operator who proposes one
 * can never be the one who approves it, and the operator who files an
 * appeal can never be the one who decides it. `operatorId` is this browser's
 * acting identity (a client-side UX guard only; the real enforcement is on
 * the server, which refuses a self-decision with 403 regardless of what this
 * page shows).
 */
export type CancellationRow = {
  rideId: string;
  driverId?: string;
  riderId: string;
  state: string;
  reasonCode?: string;
  at: string;
};
export type FlaggedDriverRow = {
  driverId: string;
  cityId: string;
  totalRides: number;
  driverCancellations: number;
  noShows: number;
  cancellationRatePct: string;
};
export type StandingActionRow = {
  id: string;
  driverId: string;
  actionType: "warning" | "suspension" | "reinstatement";
  reasonCode: string;
  reasonNote?: string;
  status: string;
  proposedBy: string;
  decidedBy?: string;
  decisionReason?: string;
  appealedBy?: string;
  appealNote?: string;
  appealDecidedBy?: string;
  appealReason?: string;
  requiresApproval: boolean;
};
export type DriverDetail = {
  driverId: string;
  totalRides: number;
  completions: number;
  driverCancellations: number;
  noShows: number;
  cancellationRatePct: string;
  blocked: boolean;
  history: StandingActionRow[];
};

export type ProposeForm = {
  actionType: "warning" | "suspension" | "reinstatement";
  reasonCode: string;
  reasonNote: string;
};

export type DriverStandingBoardProps = {
  operatorId: string;
  cancellationsLoading: boolean;
  cancellationsError: string | null;
  cancellations: CancellationRow[];
  flaggedLoading: boolean;
  flaggedError: string | null;
  flagged: FlaggedDriverRow[];
  reasonCodes: readonly string[];
  selectedDriverId: string | null;
  driverDetailLoading: boolean;
  driverDetailError: string | null;
  driverDetail: DriverDetail | null;
  proposeForm: ProposeForm;
  actionMessage: { tone: "ok" | "err"; text: string } | null;
  onSelectDriver: (driverId: string) => void;
  onProposeFormChange: (form: ProposeForm) => void;
  onSubmitPropose: () => void;
  onDecide: (actionId: string, approve: boolean, reason: string) => void;
  onFileAppeal: (actionId: string, note: string) => void;
  onDecideAppeal: (actionId: string, uphold: boolean, reason: string) => void;
};

/** A single reason-required action button: text input + confirm, so no
 * decision fires without an operator-entered reason. */
function ReasonedAction({
  testid,
  label,
  tone,
  onAct,
}: {
  testid: string;
  label: string;
  tone: "ok" | "danger";
  onAct: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <div className="flex items-center gap-2">
      <input
        data-testid={testid + ".reason"}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Reason (required)"
        className="w-48 rounded-lg border border-neutral-200 px-2 py-1 text-xs"
      />
      <button
        data-testid={testid}
        disabled={reason.trim() === ""}
        className={
          "rounded-lg px-3 py-1 text-xs font-semibold text-white disabled:opacity-40 " +
          (tone === "danger" ? "bg-red-600" : "bg-admin-secondary")
        }
        onClick={() => onAct(reason)}
      >
        {label}
      </button>
    </div>
  );
}

function StandingActionCard({
  action,
  operatorId,
  onDecide,
  onFileAppeal,
  onDecideAppeal,
}: {
  action: StandingActionRow;
  operatorId: string;
  onDecide: (id: string, approve: boolean, reason: string) => void;
  onFileAppeal: (id: string, note: string) => void;
  onDecideAppeal: (id: string, uphold: boolean, reason: string) => void;
}) {
  const isSelfProposal = operatorId !== "" && operatorId === action.proposedBy;
  const isSelfAppeal = operatorId !== "" && operatorId === action.appealedBy;
  return (
    <div
      className="rounded-xl border border-neutral-200 bg-white p-3 text-xs"
      data-testid={"mp.admin.standing.action." + action.id}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono font-semibold text-neutral-900">
          {action.actionType}
        </span>
        <span className="rounded-full bg-neutral-100 px-2 py-0.5 font-semibold uppercase tracking-wide text-neutral-600">
          {action.status}
        </span>
        {action.requiresApproval ? (
          <span className="text-neutral-400">2-person approval</span>
        ) : null}
      </div>
      <p className="text-neutral-600">
        Reason: {action.reasonCode}
        {action.reasonNote ? " — " + action.reasonNote : ""}
      </p>
      <p className="text-neutral-400">Proposed by {action.proposedBy}</p>

      {action.status === "pending_approval" ? (
        isSelfProposal ? (
          <p
            className="mt-2 text-red-700"
            data-testid={"mp.admin.standing.selfApprovalBlocked." + action.id}
          >
            You proposed this action — a different operator must approve or
            reject it.
          </p>
        ) : (
          <div className="mt-2 flex gap-3">
            <ReasonedAction
              testid={"mp.admin.standing.approve." + action.id}
              label="Approve"
              tone="ok"
              onAct={(reason) => onDecide(action.id, true, reason)}
            />
            <ReasonedAction
              testid={"mp.admin.standing.reject." + action.id}
              label="Reject"
              tone="danger"
              onAct={(reason) => onDecide(action.id, false, reason)}
            />
          </div>
        )
      ) : null}

      {action.status === "active" && action.actionType === "suspension" ? (
        <div className="mt-2">
          <ReasonedAction
            testid={"mp.admin.standing.fileAppeal." + action.id}
            label="Record driver appeal"
            tone="ok"
            onAct={(note) => onFileAppeal(action.id, note)}
          />
        </div>
      ) : null}

      {action.status === "appealed" ? (
        isSelfAppeal ? (
          <p
            className="mt-2 text-red-700"
            data-testid={"mp.admin.standing.selfAppealBlocked." + action.id}
          >
            You filed this appeal — a different operator must decide it.
          </p>
        ) : (
          <div className="mt-2 flex gap-3">
            <ReasonedAction
              testid={"mp.admin.standing.uphold." + action.id}
              label="Uphold (overturn)"
              tone="ok"
              onAct={(reason) => onDecideAppeal(action.id, true, reason)}
            />
            <ReasonedAction
              testid={"mp.admin.standing.deny." + action.id}
              label="Deny (stands)"
              tone="danger"
              onAct={(reason) => onDecideAppeal(action.id, false, reason)}
            />
          </div>
        )
      ) : null}
    </div>
  );
}

export function DriverStandingBoard(p: DriverStandingBoardProps) {
  return (
    <div
      className="flex flex-col gap-4 p-6"
      data-testid="mp.admin.standing.board"
    >
      {p.actionMessage ? (
        <div
          data-testid="mp.admin.standing.message"
          className={
            "rounded-lg p-3 text-xs " +
            (p.actionMessage.tone === "err"
              ? "bg-red-50 text-red-700"
              : "bg-green-50 text-green-700")
          }
        >
          {p.actionMessage.text}
        </div>
      ) : null}

      <section>
        <h2 className="mb-2 font-semibold text-neutral-900">
          Cancellations &amp; no-shows
        </h2>
        {p.cancellationsError ? (
          <p
            className="text-xs text-red-700"
            data-testid="mp.admin.standing.cancellationsError"
          >
            Could not load cancellations: {p.cancellationsError}
          </p>
        ) : p.cancellationsLoading ? (
          <p className="text-xs text-neutral-500">Loading…</p>
        ) : p.cancellations.length === 0 ? (
          <p
            className="text-xs text-neutral-500"
            data-testid="mp.admin.standing.cancellationsEmpty"
          >
            No marketplace cancellations or no-shows recorded.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <table
              className="w-full text-sm"
              data-testid="mp.admin.standing.cancellationsTable"
            >
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2 font-semibold">Ride</th>
                  <th className="px-4 py-2 font-semibold">Driver</th>
                  <th className="px-4 py-2 font-semibold">State</th>
                  <th className="px-4 py-2 font-semibold">Reason</th>
                  <th className="px-4 py-2 font-semibold">At</th>
                </tr>
              </thead>
              <tbody>
                {p.cancellations.map((c) => (
                  <tr
                    key={c.rideId}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="px-4 py-2 font-mono text-xs">{c.rideId}</td>
                    <td className="px-4 py-2">
                      {c.driverId ? (
                        <button
                          className="font-mono text-xs text-admin-secondary underline"
                          onClick={() => p.onSelectDriver(c.driverId as string)}
                        >
                          {c.driverId}
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-2">{c.state}</td>
                    <td className="px-4 py-2 text-xs text-neutral-500">
                      {c.reasonCode ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-xs text-neutral-400">
                      {c.at}
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
          Flagged drivers{" "}
          <span className="text-xs font-normal text-neutral-400">
            worst trailing-window cancellation rate first (pattern detection)
          </span>
        </h2>
        {p.flaggedError ? (
          <p
            className="text-xs text-red-700"
            data-testid="mp.admin.standing.flaggedError"
          >
            Could not load the driver standing board: {p.flaggedError}
          </p>
        ) : p.flaggedLoading ? (
          <p className="text-xs text-neutral-500">Loading…</p>
        ) : p.flagged.length === 0 ? (
          <p
            className="text-xs text-neutral-500"
            data-testid="mp.admin.standing.flaggedEmpty"
          >
            No driver currently meets the minimum sample for flagging.
          </p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <table
              className="w-full text-sm"
              data-testid="mp.admin.standing.flaggedTable"
            >
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-2 font-semibold">Driver</th>
                  <th className="px-4 py-2 font-semibold">Rides</th>
                  <th className="px-4 py-2 font-semibold">Driver cancels</th>
                  <th className="px-4 py-2 font-semibold">No-shows</th>
                  <th className="px-4 py-2 font-semibold">Rate</th>
                </tr>
              </thead>
              <tbody>
                {p.flagged.map((d) => (
                  <tr
                    key={d.driverId}
                    className="border-b border-neutral-100 last:border-0"
                  >
                    <td className="px-4 py-2">
                      <button
                        className="font-mono text-xs text-admin-secondary underline"
                        onClick={() => p.onSelectDriver(d.driverId)}
                      >
                        {d.driverId}
                      </button>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{d.totalRides}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {d.driverCancellations}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{d.noShows}</td>
                    <td className="px-4 py-2 font-semibold text-red-700">
                      {d.cancellationRatePct}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {p.selectedDriverId ? (
        <section
          className="rounded-xl border border-neutral-200 bg-white p-4"
          data-testid="mp.admin.standing.driverDetail"
        >
          <h2 className="mb-2 font-semibold text-neutral-900">
            Driver {p.selectedDriverId}
          </h2>
          {p.driverDetailError ? (
            <p
              className="text-xs text-red-700"
              data-testid="mp.admin.standing.driverDetailError"
            >
              Could not load this driver&rsquo;s standing: {p.driverDetailError}
            </p>
          ) : p.driverDetailLoading ? (
            <p className="text-xs text-neutral-500">Loading…</p>
          ) : p.driverDetail ? (
            <>
              <p className="text-xs text-neutral-600">
                {p.driverDetail.totalRides} rides ·{" "}
                {p.driverDetail.driverCancellations} driver cancels ·{" "}
                {p.driverDetail.noShows} no-shows · rate{" "}
                {p.driverDetail.cancellationRatePct}
                {p.driverDetail.blocked ? (
                  <span className="ml-2 rounded-full bg-red-50 px-2 py-0.5 font-semibold uppercase tracking-wide text-red-700">
                    Currently suspended
                  </span>
                ) : null}
              </p>

              <div className="mt-3 rounded-lg bg-neutral-50 p-3">
                <h3 className="mb-2 text-xs font-semibold text-neutral-900">
                  Propose a standing action
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    data-testid="mp.admin.standing.propose.actionType"
                    value={p.proposeForm.actionType}
                    onChange={(e) =>
                      p.onProposeFormChange({
                        ...p.proposeForm,
                        actionType: e.target.value as ProposeForm["actionType"],
                      })
                    }
                    className="rounded-lg border border-neutral-200 px-2 py-1 text-xs"
                  >
                    <option value="warning">Warning</option>
                    <option value="suspension">Suspension (protected)</option>
                    <option value="reinstatement">
                      Reinstatement (protected)
                    </option>
                  </select>
                  <select
                    data-testid="mp.admin.standing.propose.reasonCode"
                    value={p.proposeForm.reasonCode}
                    onChange={(e) =>
                      p.onProposeFormChange({
                        ...p.proposeForm,
                        reasonCode: e.target.value,
                      })
                    }
                    className="rounded-lg border border-neutral-200 px-2 py-1 text-xs"
                  >
                    <option value="">Reason code…</option>
                    {p.reasonCodes.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                  <input
                    data-testid="mp.admin.standing.propose.note"
                    value={p.proposeForm.reasonNote}
                    onChange={(e) =>
                      p.onProposeFormChange({
                        ...p.proposeForm,
                        reasonNote: e.target.value,
                      })
                    }
                    placeholder="Note (optional)"
                    className="w-56 rounded-lg border border-neutral-200 px-2 py-1 text-xs"
                  />
                  <button
                    data-testid="mp.admin.standing.propose.submit"
                    disabled={p.proposeForm.reasonCode === ""}
                    className="rounded-lg bg-admin-secondary px-3 py-1 text-xs font-semibold text-white disabled:opacity-40"
                    onClick={p.onSubmitPropose}
                  >
                    Propose
                  </button>
                </div>
              </div>

              <div className="mt-3 flex flex-col gap-2">
                <h3 className="text-xs font-semibold text-neutral-900">
                  Standing history
                </h3>
                {p.driverDetail.history.length === 0 ? (
                  <p
                    className="text-xs text-neutral-500"
                    data-testid="mp.admin.standing.historyEmpty"
                  >
                    No standing actions recorded for this driver.
                  </p>
                ) : (
                  p.driverDetail.history.map((a) => (
                    <StandingActionCard
                      key={a.id}
                      action={a}
                      operatorId={p.operatorId}
                      onDecide={p.onDecide}
                      onFileAppeal={p.onFileAppeal}
                      onDecideAppeal={p.onDecideAppeal}
                    />
                  ))
                )}
              </div>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
