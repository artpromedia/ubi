"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  NotificationFailuresBoard,
  type DlqCommandState,
} from "@/components/marketplace/NotificationFailuresBoard";
import { AccessNotice } from "@/components/ops/AccessNotice";
import { useOnlineStatus } from "@/components/ops/useOnlineStatus";
import { classifyError, readFailure } from "@/lib/access";
import { newIdempotencyKey } from "@/lib/api-client";
import {
  marketplaceApi,
  type DlqQueueFilter,
  type DlqStatusFilter,
} from "@/lib/marketplace-api";

/** C08 / P2-04 — Notification Dead-Letter Queue (DLQ) container. */
export default function NotificationFailuresContainer() {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const [queue, setQueue] = useState<DlqQueueFilter>("all");
  const [status, setStatus] = useState<DlqStatusFilter>("pending");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBulkIds, setSelectedBulkIds] = useState<string[]>([]);
  const [activeCommand, setActiveCommand] = useState<DlqCommandState>(null);
  const [discardReason, setDiscardReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);

  const dlqQuery = useQuery({
    queryKey: ["opsNotificationDlq", queue, status],
    queryFn: () => marketplaceApi.dlqList({ queue, status, limit: 100 }),
    refetchInterval: 20_000,
  });

  const replayMutation = useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) =>
      marketplaceApi.replayDlqItem(id, key),
    onMutate: () =>
      setActiveCommand((prev) => (prev ? { ...prev, busy: true } : prev)),
    onSuccess: (res) => {
      setIdempotencyKey(null);
      setActiveCommand({
        kind: "replay",
        targetId: res.data.id,
        phase: "result",
        message: res.idempotent
          ? `Entry ${res.data.id} was already replayed (idempotent no-op).`
          : `Entry ${res.data.id} replayed (${res.data.replayOutcome ?? "delivered"}).`,
      });
      void queryClient.invalidateQueries({ queryKey: ["opsNotificationDlq"] });
    },
    onError: (err, { id }) => {
      setActiveCommand({
        kind: "replay",
        targetId: id,
        phase: "error",
        message: (err as Error).message,
        access: classifyError(err),
      });
    },
  });

  const bulkReplayMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      let replayedCount = 0;
      for (const id of ids) {
        await marketplaceApi.replayDlqItem(id, newIdempotencyKey());
        replayedCount += 1;
      }
      return replayedCount;
    },
    onMutate: () =>
      setActiveCommand((prev) => (prev ? { ...prev, busy: true } : prev)),
    onSuccess: (count) => {
      setSelectedBulkIds([]);
      setIdempotencyKey(null);
      setActiveCommand({
        kind: "bulkReplay",
        targetId: "bulk",
        phase: "result",
        message: `Replayed ${count} dead-letter entry(s).`,
      });
      void queryClient.invalidateQueries({ queryKey: ["opsNotificationDlq"] });
    },
    onError: (err) => {
      setActiveCommand({
        kind: "bulkReplay",
        targetId: "bulk",
        phase: "error",
        message: (err as Error).message,
        access: classifyError(err),
      });
    },
  });

  const discardMutation = useMutation({
    mutationFn: ({
      id,
      reason,
      key,
    }: {
      id: string;
      reason: string;
      key: string;
    }) => marketplaceApi.discardDlqItem(id, reason, key),
    onMutate: () =>
      setActiveCommand((prev) => (prev ? { ...prev, busy: true } : prev)),
    onSuccess: (res) => {
      setDiscardReason("");
      setIdempotencyKey(null);
      setActiveCommand({
        kind: "discard",
        targetId: res.data.id,
        phase: "result",
        message: `Entry ${res.data.id} discarded and recorded in AuditLog.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["opsNotificationDlq"] });
    },
    onError: (err, { id }) => {
      setActiveCommand({
        kind: "discard",
        targetId: id,
        phase: "error",
        message: (err as Error).message,
        access: classifyError(err),
      });
    },
  });

  const handleConfirm = () => {
    if (!activeCommand || activeCommand.phase !== "confirm") return;
    const key = idempotencyKey ?? newIdempotencyKey();
    if (activeCommand.kind === "replay") {
      replayMutation.mutate({ id: activeCommand.targetId, key });
    } else if (activeCommand.kind === "bulkReplay") {
      bulkReplayMutation.mutate(activeCommand.targetIds ?? []);
    } else if (activeCommand.kind === "discard") {
      const trimmed = discardReason.trim();
      if (trimmed.length < 3) return;
      discardMutation.mutate({
        id: activeCommand.targetId,
        reason: trimmed,
        key,
      });
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <h1 className="font-heading text-lg font-semibold">
          Marketplace › Notification failures
        </h1>
      </div>
      <div className="flex-1 overflow-auto">
        {online ? null : (
          <div className="px-6 pt-6" data-testid="admin.dlq.offline">
            <AccessNotice
              state={classifyError(null, false)}
              context="the dead-letter queues below are the last ones loaded"
            />
          </div>
        )}
        <NotificationFailuresBoard
          loading={dlqQuery.isLoading}
          error={readFailure(dlqQuery, online)}
          items={dlqQuery.data?.data.items ?? []}
          counts={dlqQuery.data?.data.counts}
          queue={queue}
          status={status}
          selectedId={selectedId}
          selectedBulkIds={selectedBulkIds}
          activeCommand={activeCommand}
          discardReason={discardReason}
          onQueueChange={(nextQueue) => {
            setQueue(nextQueue);
            setSelectedId(null);
            setSelectedBulkIds([]);
          }}
          onStatusChange={(nextStatus) => {
            setStatus(nextStatus);
            setSelectedId(null);
            setSelectedBulkIds([]);
          }}
          onSelectRow={setSelectedId}
          onToggleBulkSelect={(id) =>
            setSelectedBulkIds((prev) =>
              prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
            )
          }
          onPromptReplay={(id) => {
            setIdempotencyKey(newIdempotencyKey());
            setActiveCommand({
              kind: "replay",
              targetId: id,
              phase: "confirm",
            });
          }}
          onPromptBulkReplay={(ids) => {
            setIdempotencyKey(newIdempotencyKey());
            setActiveCommand({
              kind: "bulkReplay",
              targetId: "bulk",
              targetIds: ids,
              phase: "confirm",
            });
          }}
          onPromptDiscard={(id) => {
            setDiscardReason("");
            setIdempotencyKey(newIdempotencyKey());
            setActiveCommand({
              kind: "discard",
              targetId: id,
              phase: "confirm",
            });
          }}
          onDiscardReasonChange={setDiscardReason}
          onConfirmCommand={handleConfirm}
          onCancelCommand={() => {
            setActiveCommand(null);
            setDiscardReason("");
            setIdempotencyKey(null);
          }}
        />
      </div>
    </div>
  );
}
