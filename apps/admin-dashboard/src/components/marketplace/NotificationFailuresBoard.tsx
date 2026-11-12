"use client";
import React from "react";

import { AccessNotice } from "@/components/ops/AccessNotice";
import { type AccessState } from "@/lib/access";
import {
  type DlqItemView,
  type DlqListCounts,
  type DlqQueueFilter,
  type DlqStatusFilter,
} from "@/lib/marketplace-api";

export type DlqCommandState = {
  kind: "replay" | "discard" | "bulkReplay";
  targetId: string;
  targetIds?: string[];
  phase: "confirm" | "result" | "error";
  busy?: boolean;
  message?: string;
  access?: AccessState;
} | null;

export type NotificationFailuresBoardProps = {
  loading?: boolean;
  error?: AccessState | null;
  items?: DlqItemView[];
  counts?: DlqListCounts;
  queue?: DlqQueueFilter;
  status?: DlqStatusFilter;
  selectedId?: string | null;
  selectedBulkIds?: string[];
  activeCommand?: DlqCommandState;
  discardReason?: string;
  onQueueChange?: (queue: DlqQueueFilter) => void;
  onStatusChange?: (status: DlqStatusFilter) => void;
  onSelectRow?: (id: string | null) => void;
  onToggleBulkSelect?: (id: string) => void;
  onPromptReplay?: (id: string) => void;
  onPromptBulkReplay?: (ids: string[]) => void;
  onPromptDiscard?: (id: string) => void;
  onDiscardReasonChange?: (reason: string) => void;
  onConfirmCommand?: () => void;
  onCancelCommand?: () => void;
};

const QUEUE_TABS: {
  value: DlqQueueFilter;
  label: string;
  redisKey?: string;
}[] = [
  { value: "all", label: "All queues" },
  {
    value: "marketplace",
    label: "Marketplace push/SMS",
    redisKey: "notif:mp:dlq",
  },
  {
    value: "trip_access",
    label: "Trip-link SMS",
    redisKey: "notif:trip_access:dlq",
  },
];

const STATUS_TABS: { value: DlqStatusFilter; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "replayed", label: "Replayed" },
  { value: "discarded", label: "Discarded" },
  { value: "all", label: "All statuses" },
];

function statusBadgeClass(status: DlqItemView["status"]): string {
  switch (status) {
    case "replayed":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "discarded":
      return "border-neutral-300 bg-neutral-100 text-neutral-700";
    default:
      return "border-amber-200 bg-amber-50 text-amber-800";
  }
}

/**
 * C08 / P2-04 — Notification Dead-Letter Queue (DLQ) operator board.
 *
 * Reads sanitized entries from `GET /v1/ops/notifications/dlq` covering both
 * `notif:mp:dlq` (marketplace push + SMS fallback) and `notif:trip_access:dlq`
 * (guest trip-link SMS). Never renders raw phone numbers, access tokens, or
 * sealed ciphertext. Every replay or discard writes an server-side AuditLog.
 */
export function NotificationFailuresBoard({
  loading = false,
  error = null,
  items = [],
  counts,
  queue = "all",
  status = "pending",
  selectedId = null,
  selectedBulkIds = [],
  activeCommand = null,
  discardReason = "",
  onQueueChange,
  onStatusChange,
  onSelectRow,
  onToggleBulkSelect,
  onPromptReplay,
  onPromptBulkReplay,
  onPromptDiscard,
  onDiscardReasonChange,
  onConfirmCommand,
  onCancelCommand,
}: Readonly<NotificationFailuresBoardProps>) {
  const selectedItem = items.find((i) => i.id === selectedId) ?? null;
  const replayableBulkIds = selectedBulkIds.filter((id) => {
    const item = items.find((row) => row.id === id);
    return item && item.status === "pending" && item.replayable;
  });
  const canConfirmDiscard =
    activeCommand?.kind !== "discard" || discardReason.trim().length >= 3;

  return (
    <div
      className="flex flex-col gap-6 p-6"
      data-testid="admin.dlq.board"
      data-surface="mp.admin.notifications.board"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-neutral-900">
            Notification dead-letter queues
          </h2>
          <p className="mt-1 text-xs text-neutral-600">
            Inspect, replay idempotently, or discard exhausted deliveries across{" "}
            <code className="font-mono">notif:mp:dlq</code> and{" "}
            <code className="font-mono">notif:trip_access:dlq</code>. Payloads
            are sanitized server-side (no raw phone numbers, tokens, or sealed
            envelopes).
          </p>
        </div>

        {counts ? (
          <div
            className="flex flex-wrap gap-2 text-xs"
            data-testid="admin.dlq.counts"
          >
            <span className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-neutral-700">
              Pending:{" "}
              <strong className="font-mono text-amber-700">
                {counts.pending}
              </strong>
            </span>
            <span className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-neutral-700">
              Replayed:{" "}
              <strong className="font-mono text-emerald-700">
                {counts.replayed}
              </strong>
            </span>
            <span className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1 text-neutral-700">
              Discarded:{" "}
              <strong className="font-mono text-neutral-700">
                {counts.discarded}
              </strong>
            </span>
          </div>
        ) : null}
      </div>

      {/* Queue & Status Filter Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="flex flex-wrap gap-1.5"
          data-testid="admin.dlq.queueTabs"
          role="tablist"
          aria-label="Notification dead-letter queues"
        >
          {QUEUE_TABS.map((tab) => {
            const active = queue === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`admin.dlq.queueTab.${tab.value}`}
                onClick={() => onQueueChange?.(tab.value)}
                className={
                  "rounded-lg border px-3 py-1.5 text-xs font-medium transition " +
                  (active
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50")
                }
              >
                {tab.label}
                {tab.redisKey ? (
                  <span className="ml-1.5 font-mono text-[11px] opacity-75">
                    ({tab.redisKey})
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div
          className="flex flex-wrap items-center gap-1.5"
          data-testid="admin.dlq.statusTabs"
        >
          {STATUS_TABS.map((tab) => {
            const active = status === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                data-testid={`admin.dlq.statusTab.${tab.value}`}
                onClick={() => onStatusChange?.(tab.value)}
                className={
                  "rounded-lg border px-2.5 py-1 text-xs transition " +
                  (active
                    ? "border-emerald-700 bg-emerald-600 text-white font-medium"
                    : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50")
                }
              >
                {tab.label}
              </button>
            );
          })}

          {replayableBulkIds.length > 0 ? (
            <button
              type="button"
              data-testid="admin.dlq.bulkReplay"
              onClick={() => onPromptBulkReplay?.(replayableBulkIds)}
              className="ml-2 rounded-lg bg-neutral-900 px-3 py-1 text-xs font-medium text-white hover:bg-neutral-800"
            >
              Replay selected ({replayableBulkIds.length})
            </button>
          ) : null}
        </div>
      </div>

      {/* Command confirmation / result banner */}
      {activeCommand ? (
        <div
          className="rounded-xl border border-neutral-300 bg-neutral-50 p-4 text-xs"
          data-testid="admin.dlq.commandPanel"
        >
          {activeCommand.phase === "confirm" ? (
            <div className="space-y-3">
              <div className="font-semibold text-neutral-900">
                {activeCommand.kind === "replay"
                  ? `Confirm idempotent replay for DLQ entry ${activeCommand.targetId}`
                  : activeCommand.kind === "bulkReplay"
                    ? `Confirm idempotent replay for ${activeCommand.targetIds?.length ?? 0} selected DLQ entries`
                    : `Discard DLQ entry ${activeCommand.targetId}`}
              </div>
              <p className="text-neutral-600">
                {activeCommand.kind === "discard"
                  ? "Discarding marks this dead-letter entry as permanently resolved without re-sending. An operator reason (min 3 characters) is recorded in AuditLog."
                  : "Replaying invokes the downstream push/SMS delivery port once and marks the entry replayed in Redis and AuditLog. Already-replayed items return idempotent: true without duplicate delivery."}
              </p>
              {activeCommand.kind === "discard" ? (
                <div>
                  <label
                    htmlFor="dlq-discard-reason"
                    className="block text-[11px] font-medium text-neutral-700"
                  >
                    Discard reason (required, min 3 chars)
                  </label>
                  <input
                    id="dlq-discard-reason"
                    type="text"
                    data-testid="admin.dlq.reason"
                    value={discardReason}
                    onChange={(e) => onDiscardReasonChange?.(e.target.value)}
                    placeholder="e.g. Stale trip already completed; user notified in-app"
                    className="mt-1 w-full max-w-lg rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-900"
                  />
                </div>
              ) : null}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="admin.dlq.confirm"
                  disabled={Boolean(activeCommand.busy) || !canConfirmDiscard}
                  onClick={() => onConfirmCommand?.()}
                  className="rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                >
                  {activeCommand.busy
                    ? "Working…"
                    : activeCommand.kind === "discard"
                      ? "Confirm discard"
                      : "Confirm replay"}
                </button>
                <button
                  type="button"
                  data-testid="admin.dlq.cancel"
                  disabled={Boolean(activeCommand.busy)}
                  onClick={() => onCancelCommand?.()}
                  className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs text-neutral-700"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : activeCommand.phase === "result" ? (
            <div className="flex items-center justify-between gap-3">
              <span
                className="font-medium text-emerald-800"
                data-testid="admin.dlq.resultMessage"
              >
                {activeCommand.message ?? "Action completed."}
              </span>
              <button
                type="button"
                onClick={() => onCancelCommand?.()}
                className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700"
              >
                Dismiss
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {activeCommand.access ? (
                <AccessNotice
                  state={activeCommand.access}
                  context="notification DLQ action"
                />
              ) : (
                <p className="font-medium text-red-700">
                  {activeCommand.message ?? "Action failed."}
                </p>
              )}
              <button
                type="button"
                onClick={() => onCancelCommand?.()}
                className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-xs text-neutral-700"
              >
                Dismiss
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* Main Table / Loading / Error / Empty states */}
      {error ? (
        <div data-testid="admin.dlq.error">
          <AccessNotice
            state={error}
            context="the notification dead-letter queues"
          />
        </div>
      ) : loading ? (
        <div
          className="rounded-xl border border-neutral-200 bg-white p-6 text-xs text-neutral-500"
          data-testid="admin.dlq.loading"
        >
          Loading dead-letter entries…
        </div>
      ) : items.length === 0 ? (
        <div
          className="rounded-xl border border-neutral-200 bg-white p-6 text-xs text-neutral-500"
          data-testid="admin.dlq.empty"
        >
          No dead-letter entries match the current queue and status filter.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-neutral-200 bg-neutral-50 text-neutral-600">
              <tr>
                <th className="p-3 w-8">Sel</th>
                <th className="p-3">Queue</th>
                <th className="p-3">Event</th>
                <th className="p-3">Channel / Role</th>
                <th className="p-3">Recipient / Subject</th>
                <th className="p-3">Attempts</th>
                <th className="p-3">Failure reason</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {items.map((item) => {
                const isSelected = selectedId === item.id;
                const isBulkChecked = selectedBulkIds.includes(item.id);
                const canMutate = item.status === "pending";
                return (
                  <tr
                    key={item.id}
                    data-testid="admin.dlq.row"
                    data-dlq-id={item.id}
                    className={
                      isSelected ? "bg-emerald-50/40" : "hover:bg-neutral-50/70"
                    }
                  >
                    <td className="p-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.id}`}
                        disabled={!canMutate || !item.replayable}
                        checked={isBulkChecked}
                        onChange={() => onToggleBulkSelect?.(item.id)}
                      />
                    </td>
                    <td className="p-3 font-mono text-[11px]">
                      <span className="rounded border border-neutral-200 bg-neutral-50 px-1.5 py-0.5">
                        {item.queue}
                      </span>
                    </td>
                    <td className="p-3">
                      <div className="font-mono font-medium text-neutral-900">
                        {item.eventName}
                      </div>
                      <div className="font-mono text-[11px] text-neutral-500">
                        {item.id}
                      </div>
                    </td>
                    <td className="p-3">
                      <span className="font-mono uppercase text-neutral-800">
                        {item.channel}
                      </span>
                      {item.role ? (
                        <span className="ml-1.5 text-neutral-500">
                          · {item.role}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-3 font-mono text-[11px] text-neutral-700">
                      {item.userId ? <div>user: {item.userId}</div> : null}
                      {item.maskedPhone ? (
                        <div>phone: {item.maskedPhone}</div>
                      ) : null}
                      {item.requestId ? <div>req: {item.requestId}</div> : null}
                      {item.subjectId ? (
                        <div>
                          {item.subjectType ?? "subject"}: {item.subjectId}
                        </div>
                      ) : null}
                    </td>
                    <td className="p-3 font-mono text-neutral-800">
                      {item.attempts}
                    </td>
                    <td className="p-3 text-amber-800 font-mono text-[11px]">
                      {item.reason}
                    </td>
                    <td className="p-3">
                      <span
                        className={
                          "inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium " +
                          statusBadgeClass(item.status)
                        }
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="p-3 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          data-testid="admin.dlq.inspect"
                          onClick={() =>
                            onSelectRow?.(isSelected ? null : item.id)
                          }
                          className="rounded border border-neutral-200 bg-white px-2 py-1 text-[11px] text-neutral-700 hover:bg-neutral-50"
                        >
                          {isSelected ? "Hide" : "Inspect"}
                        </button>
                        {canMutate && item.replayable ? (
                          <button
                            type="button"
                            data-testid="admin.dlq.replay"
                            onClick={() => onPromptReplay?.(item.id)}
                            className="rounded bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-neutral-800"
                          >
                            Replay
                          </button>
                        ) : null}
                        {canMutate ? (
                          <button
                            type="button"
                            data-testid="admin.dlq.discard"
                            onClick={() => onPromptDiscard?.(item.id)}
                            className="rounded border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-100"
                          >
                            Discard
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Sanitized Detail Panel */}
      {selectedItem ? (
        <div
          className="rounded-xl border border-neutral-200 bg-white p-4 text-xs"
          data-testid="admin.dlq.detail"
        >
          <div className="flex items-center justify-between border-b border-neutral-100 pb-3">
            <div>
              <h3 className="font-semibold text-neutral-900">
                Sanitized DLQ Entry Detail
              </h3>
              <p className="font-mono text-[11px] text-neutral-500">
                {selectedItem.id} · event {selectedItem.eventId}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onSelectRow?.(null)}
              className="rounded border border-neutral-200 px-2 py-1 text-[11px] text-neutral-600"
            >
              Close
            </button>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-[11px] text-neutral-500">Queue</dt>
              <dd className="font-mono font-medium text-neutral-900">
                {selectedItem.queue}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-neutral-500">Event Name</dt>
              <dd className="font-mono font-medium text-neutral-900">
                {selectedItem.eventName}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-neutral-500">Channel / Role</dt>
              <dd className="font-mono text-neutral-900">
                {selectedItem.channel} / {selectedItem.role ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-neutral-500">Status</dt>
              <dd className="font-mono text-neutral-900">
                {selectedItem.status}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-neutral-500">User ID</dt>
              <dd className="font-mono text-neutral-900">
                {selectedItem.userId ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-neutral-500">Masked Phone</dt>
              <dd className="font-mono text-neutral-900">
                {selectedItem.maskedPhone ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-neutral-500">Request / Token</dt>
              <dd className="font-mono text-neutral-900">
                {selectedItem.requestId ?? selectedItem.tokenId ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-neutral-500">City / Subject</dt>
              <dd className="font-mono text-neutral-900">
                {selectedItem.cityId ?? "—"} ·{" "}
                {selectedItem.subjectId
                  ? `${selectedItem.subjectType ?? "subject"}:${selectedItem.subjectId}`
                  : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-neutral-500">Failure Reason</dt>
              <dd className="font-mono text-amber-800">
                {selectedItem.reason} ({selectedItem.attempts} attempt(s))
              </dd>
            </div>
            <div>
              <dt className="text-[11px] text-neutral-500">Failed At</dt>
              <dd className="font-mono text-neutral-900">
                {selectedItem.at ?? "—"}
              </dd>
            </div>
            {selectedItem.replayedAt ? (
              <div className="col-span-2">
                <dt className="text-[11px] text-neutral-500">Replay Audit</dt>
                <dd className="font-mono text-emerald-800">
                  {selectedItem.replayedAt} by {selectedItem.replayedBy ?? "—"}{" "}
                  ({selectedItem.replayOutcome ?? "delivered"})
                </dd>
              </div>
            ) : null}
            {selectedItem.discardedAt ? (
              <div className="col-span-2">
                <dt className="text-[11px] text-neutral-500">Discard Audit</dt>
                <dd className="font-mono text-neutral-700">
                  {selectedItem.discardedAt} by{" "}
                  {selectedItem.discardedBy ?? "—"} —{" "}
                  {selectedItem.discardReason ?? "—"}
                </dd>
              </div>
            ) : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
}
