"use client";

import {
  AlertTriangle,
  CheckCircle2,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from "lucide-react";

import { formatMinor, formatServerMoney } from "@/lib/money";
import {
  OPS_CREDIT_STATUSES,
  canManageOpsCredits,
  evaluateApproveEligibility,
  type CityOpsCreditConfigView,
  type OpsCreditStatus,
  type OpsCreditView,
} from "@/lib/ops-credits-api";

import type { PublicAdminSession } from "@/lib/session";
import type { FormEvent, ReactElement } from "react";

const STATUS_LABELS: Readonly<Record<OpsCreditStatus, string>> = {
  pending_approval: "Pending Approval",
  approved: "Approved",
  rejected: "Rejected",
  reversed: "Reversed",
};

export interface OpsCreditsFormState {
  readonly driverUserId: string;
  readonly amountMajor: string;
  readonly reasonCode: string;
  readonly reference: string;
  readonly note: string;
}

export interface OpsCreditsDialogState {
  readonly mode: "reject" | "reverse";
  readonly creditId: string;
  readonly driverUserId: string;
  readonly reason: string;
}

export interface OpsCreditsViewProps {
  readonly session: PublicAdminSession | null;
  readonly cityId: string;
  readonly onCityIdChange: (next: string) => void;
  readonly statusFilter: OpsCreditStatus;
  readonly onStatusFilterChange: (next: OpsCreditStatus) => void;
  readonly cityConfig: CityOpsCreditConfigView | undefined;
  readonly flagEnabled: boolean;
  readonly credits: readonly OpsCreditView[];
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly banner: {
    readonly tone: "ok" | "err" | "info";
    readonly text: string;
  } | null;
  readonly form: OpsCreditsFormState;
  readonly onFormChange: (patch: Partial<OpsCreditsFormState>) => void;
  readonly onSubmitCreate: (event: FormEvent<HTMLFormElement>) => void;
  readonly isSubmitting: boolean;
  readonly onApprove: (creditId: string) => void;
  readonly dialog: OpsCreditsDialogState | null;
  readonly onOpenDialog: (dialog: OpsCreditsDialogState) => void;
  readonly onDialogReasonChange: (reason: string) => void;
  readonly onCancelDialog: () => void;
  readonly onConfirmDialog: (event: FormEvent<HTMLFormElement>) => void;
}

export const OpsCreditsView = ({
  session,
  cityId,
  onCityIdChange,
  statusFilter,
  onStatusFilterChange,
  cityConfig,
  flagEnabled,
  credits,
  isLoading,
  errorMessage,
  banner,
  form,
  onFormChange,
  onSubmitCreate,
  isSubmitting,
  onApprove,
  dialog,
  onOpenDialog,
  onDialogReasonChange,
  onCancelDialog,
  onConfirmDialog,
}: OpsCreditsViewProps): ReactElement => {
  const isLimited = session?.mode === "limited";
  const hasRole = canManageOpsCredits(session?.user.role);
  const policy = cityConfig?.opsCreditPolicy;
  const currency = cityConfig?.currency ?? "NGN";
  const mutationsBlocked =
    isLimited ||
    !hasRole ||
    !flagEnabled ||
    policy === undefined ||
    isSubmitting;

  return (
    <div className="space-y-6 p-6 text-white" data-testid="ops-credits.page">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-gray-800 pb-4">
        <div>
          <h1 className="text-xl font-semibold text-white">
            Payments › Ops Driver Wallet Credits
          </h1>
          <p className="mt-1 text-xs text-gray-400">
            Audited two-person commission wallet credits (`ubi_float` → driver
            wallet). Every credit requires a distinct second operator to post.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <span
            data-testid="ops-credits.flag-pill"
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              flagEnabled
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                : "bg-amber-500/15 text-amber-300 border border-amber-500/30"
            }`}
          >
            ops_driver_wallet_credit: {flagEnabled ? "ON" : "OFF"}
          </span>

          <label className="flex items-center gap-2 text-xs text-gray-400">
            <span>City</span>
            <input
              data-testid="ops-credits.city-input"
              value={cityId}
              onChange={(e) => onCityIdChange(e.target.value.toUpperCase())}
              className="w-24 rounded-lg border border-gray-700 bg-gray-900 px-2.5 py-1.5 text-sm text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </label>
        </div>
      </div>

      {isLimited ? (
        <div
          data-testid="ops-credits.limited-banner"
          className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200"
        >
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <p className="font-semibold">
              Limited session — mutations disabled
            </p>
            <p className="mt-1 text-xs text-amber-200/80">
              Complete device step-up verification before requesting, approving,
              rejecting, or reversing driver wallet credits.
            </p>
          </div>
        </div>
      ) : null}

      {!isLimited && session && !hasRole ? (
        <div
          data-testid="ops-credits.role-banner"
          className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200"
        >
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div>
            <p className="font-semibold">Insufficient role</p>
            <p className="mt-1 text-xs text-red-200/80">
              Only `finance_ops`, `ops_admin`, `admin`, and `super_admin` hold
              `finance:ops` permission to manage driver commission credits.
            </p>
          </div>
        </div>
      ) : null}

      {!flagEnabled ? (
        <div
          data-testid="ops-credits.flag-off-banner"
          className="rounded-xl border border-gray-800 bg-gray-900/80 p-4 text-xs text-gray-300"
        >
          Flag <code className="text-amber-300">ops_driver_wallet_credit</code>{" "}
          is currently OFF in {cityId}. Enable it for the pilot city before
          submitting or approving driver wallet credits.
        </div>
      ) : null}

      {cityConfig !== undefined && policy === undefined ? (
        <div
          data-testid="ops-credits.policy-missing-banner"
          className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-xs text-red-200"
        >
          City {cityId} has no{" "}
          <code className="text-red-100">opsCreditPolicy</code> configured. Ops
          wallet credits fail closed until city caps and reason codes are
          published via two-person config approval.
        </div>
      ) : null}

      {banner ? (
        <div
          data-testid="ops-credits.status-banner"
          className={`rounded-xl border p-3 text-xs ${
            banner.tone === "ok"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : banner.tone === "err"
                ? "border-red-500/40 bg-red-500/10 text-red-200"
                : "border-blue-500/40 bg-blue-500/10 text-blue-200"
          }`}
        >
          {banner.text}
        </div>
      ) : null}

      {policy ? (
        <div
          data-testid="ops-credits.policy-caps"
          className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        >
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <p className="text-xs text-gray-400">Max per credit ({cityId})</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {formatMinor(policy.maxPerCreditMinor, currency)}
            </p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <p className="text-xs text-gray-400">Max per driver / day</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {formatMinor(policy.maxDriverDailyMinor, currency)}
            </p>
          </div>
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
            <p className="text-xs text-gray-400">Max city total / day</p>
            <p className="mt-1 text-lg font-semibold text-white">
              {formatMinor(policy.maxCityDailyMinor, currency)}
            </p>
          </div>
        </div>
      ) : null}

      <form
        onSubmit={onSubmitCreate}
        data-testid="ops-credits.create-form"
        className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">
            Request driver commission wallet credit
          </h2>
          <span className="text-xs text-gray-400">
            Requires second operator approval
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <label className="space-y-1 text-xs text-gray-300">
            <span>Driver user ID</span>
            <input
              type="text"
              required
              disabled={mutationsBlocked}
              data-testid="ops-credits.input-driver"
              value={form.driverUserId}
              onChange={(e) => onFormChange({ driverUserId: e.target.value })}
              placeholder="usr_driver_..."
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white disabled:opacity-50"
            />
          </label>

          <label className="space-y-1 text-xs text-gray-300">
            <span>Amount ({currency} whole units)</span>
            <input
              type="text"
              inputMode="numeric"
              required
              disabled={mutationsBlocked}
              data-testid="ops-credits.input-amount"
              value={form.amountMajor}
              onChange={(e) =>
                onFormChange({
                  amountMajor: e.target.value.replace(/\D/g, "").slice(0, 9),
                })
              }
              placeholder="5000"
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white disabled:opacity-50"
            />
          </label>

          <label className="space-y-1 text-xs text-gray-300">
            <span>Reason code</span>
            <select
              required
              disabled={mutationsBlocked || !policy}
              data-testid="ops-credits.input-reason"
              value={form.reasonCode}
              onChange={(e) => onFormChange({ reasonCode: e.target.value })}
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white disabled:opacity-50"
            >
              <option value="">Select reason…</option>
              {(policy?.reasonCodes ?? []).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs text-gray-300">
            <span>Bank / receipt reference</span>
            <input
              type="text"
              disabled={mutationsBlocked}
              data-testid="ops-credits.input-reference"
              value={form.reference}
              onChange={(e) => onFormChange({ reference: e.target.value })}
              placeholder="BNK-2026-..."
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white disabled:opacity-50"
            />
          </label>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <label className="flex-1 space-y-1 text-xs text-gray-300">
            <span>Audit note</span>
            <input
              type="text"
              disabled={mutationsBlocked}
              data-testid="ops-credits.input-note"
              value={form.note}
              onChange={(e) => onFormChange({ note: e.target.value })}
              placeholder="Verified bank deposit slip or pilot onboarding batch"
              className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white disabled:opacity-50"
            />
          </label>

          <button
            type="submit"
            disabled={mutationsBlocked}
            data-testid="ops-credits.submit-create"
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Submitting…" : "Request credit"}
          </button>
        </div>
      </form>

      <div className="space-y-3">
        <div
          className="flex flex-wrap gap-2"
          role="tablist"
          aria-label="Ops credit status filter"
        >
          {OPS_CREDIT_STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              role="tab"
              aria-selected={statusFilter === st}
              data-testid={`ops-credits.tab.${st}`}
              onClick={() => onStatusFilterChange(st)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                statusFilter === st
                  ? "bg-green-600 text-white"
                  : "bg-gray-900 text-gray-400 hover:bg-gray-800 hover:text-white border border-gray-800"
              }`}
            >
              {STATUS_LABELS[st]}
            </button>
          ))}
        </div>

        {errorMessage ? (
          <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-xs text-red-200">
            {errorMessage}
          </div>
        ) : isLoading ? (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400">
            Loading ops wallet credits…
          </div>
        ) : credits.length === 0 ? (
          <div
            data-testid="ops-credits.empty"
            className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-sm text-gray-400"
          >
            No {STATUS_LABELS[statusFilter].toLowerCase()} credits in {cityId}.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-800 bg-gray-900">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-800 bg-gray-950/60 text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Credit ID</th>
                  <th className="px-4 py-3 font-medium">Driver</th>
                  <th className="px-4 py-3 font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Reason & Ref</th>
                  <th className="px-4 py-3 font-medium">Requested By</th>
                  <th className="px-4 py-3 font-medium">Audit Trail</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {credits.map((credit) => {
                  const eligibility = evaluateApproveEligibility(
                    credit,
                    session,
                    flagEnabled,
                  );
                  return (
                    <tr
                      key={credit.id}
                      data-testid={`ops-credits.row.${credit.id}`}
                    >
                      <td className="px-4 py-3 font-mono text-gray-200">
                        {credit.id}
                      </td>
                      <td className="px-4 py-3 font-mono text-gray-300">
                        {credit.driverUserId}
                      </td>
                      <td className="px-4 py-3 font-semibold text-white">
                        {formatServerMoney(credit.amount)}
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        <div className="font-medium text-white">
                          {credit.reasonCode}
                        </div>
                        {credit.reference ? (
                          <div className="font-mono text-[11px] text-gray-400">
                            Ref: {credit.reference}
                          </div>
                        ) : null}
                        {credit.note ? (
                          <div className="text-[11px] text-gray-400">
                            {credit.note}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        <div className="font-mono">{credit.createdBy}</div>
                        <div className="text-[11px] text-gray-500">
                          {credit.createdByRole}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-400">
                        {credit.approvedBy ? (
                          <div>
                            Approved by{" "}
                            <span className="font-mono text-emerald-300">
                              {credit.approvedBy}
                            </span>
                            {credit.entryId ? (
                              <span className="block font-mono text-[11px] text-gray-500">
                                Entry: {credit.entryId}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {credit.rejectedBy ? (
                          <div>
                            Rejected by{" "}
                            <span className="font-mono text-red-300">
                              {credit.rejectedBy}
                            </span>
                            {credit.rejectionReason ? (
                              <span className="block text-[11px] text-gray-400">
                                {credit.rejectionReason}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {credit.reversedBy ? (
                          <div>
                            Reversed by{" "}
                            <span className="font-mono text-amber-300">
                              {credit.reversedBy}
                            </span>
                            {credit.reversalReason ? (
                              <span className="block text-[11px] text-gray-400">
                                {credit.reversalReason}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {credit.status === "pending_approval" ? (
                          <span className="text-amber-300">
                            Awaiting second operator
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {credit.status === "pending_approval" ? (
                          <div className="flex flex-col items-end gap-1.5">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                disabled={!eligibility.allowed || isSubmitting}
                                title={
                                  eligibility.reason ??
                                  "Approve and post ledger credit"
                                }
                                data-testid={`ops-credits.approve.${credit.id}`}
                                onClick={() => onApprove(credit.id)}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Approve
                              </button>
                              <button
                                type="button"
                                disabled={
                                  isLimited ||
                                  !hasRole ||
                                  !flagEnabled ||
                                  isSubmitting
                                }
                                data-testid={`ops-credits.reject.${credit.id}`}
                                onClick={() =>
                                  onOpenDialog({
                                    mode: "reject",
                                    creditId: credit.id,
                                    driverUserId: credit.driverUserId,
                                    reason: "",
                                  })
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-red-500/40 bg-red-500/10 px-2.5 py-1.5 text-xs font-medium text-red-200 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                Reject
                              </button>
                            </div>
                            {eligibility.selfAuthor && eligibility.reason ? (
                              <span
                                data-testid={`ops-credits.self-approve-blocked.${credit.id}`}
                                className="max-w-xs text-[11px] text-amber-300"
                              >
                                {eligibility.reason}
                              </span>
                            ) : null}
                          </div>
                        ) : credit.status === "approved" ? (
                          <button
                            type="button"
                            disabled={
                              isLimited ||
                              !hasRole ||
                              !flagEnabled ||
                              isSubmitting
                            }
                            data-testid={`ops-credits.reverse.${credit.id}`}
                            onClick={() =>
                              onOpenDialog({
                                mode: "reverse",
                                creditId: credit.id,
                                driverUserId: credit.driverUserId,
                                reason: "",
                              })
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                            Reverse
                          </button>
                        ) : (
                          <span className="text-gray-500">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {dialog ? (
        <form
          onSubmit={onConfirmDialog}
          data-testid="ops-credits.reason-dialog"
          className="rounded-xl border border-gray-700 bg-gray-900 p-5 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">
              {dialog.mode === "reject"
                ? `Reject pending credit ${dialog.creditId}`
                : `Reverse approved credit ${dialog.creditId}`}
            </h3>
            <span className="font-mono text-xs text-gray-400">
              Driver: {dialog.driverUserId}
            </span>
          </div>
          <p className="text-xs text-gray-400">
            {dialog.mode === "reject"
              ? "Provide an audited rejection reason (minimum 3 characters). No ledger entry will be posted."
              : "Reversing debits the driver's spendable balance back to ubi_float and refuses if active marketplace holds would be breached."}
          </p>
          <input
            type="text"
            required
            minLength={3}
            maxLength={280}
            data-testid="ops-credits.dialog-reason"
            value={dialog.reason}
            onChange={(e) => onDialogReasonChange(e.target.value)}
            placeholder="Enter audited reason…"
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancelDialog}
              className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || dialog.reason.trim().length < 3}
              data-testid="ops-credits.dialog-confirm"
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-500 disabled:opacity-50"
            >
              {dialog.mode === "reject" ? "Confirm reject" : "Confirm reversal"}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
};
