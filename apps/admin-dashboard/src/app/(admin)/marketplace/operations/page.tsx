"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  StuckSagaBoard,
  type CommandState,
} from "@/components/marketplace/StuckSagaBoard";
import { marketplaceApi } from "@/lib/marketplace-api";

/** C08 — stuck-saga & failed-reservation-recovery board container. */
export default function StuckSagaOperationsContainer() {
  const queryClient = useQueryClient();
  const [active, setActive] = useState<CommandState>(null);

  const sagas = useQuery({
    queryKey: ["mpPendingSagas"],
    queryFn: () => marketplaceApi.pendingSagas(),
    refetchInterval: 20_000,
  });
  const recoveries = useQuery({
    queryKey: ["mpRecoveries"],
    queryFn: () => marketplaceApi.recoveries(),
    refetchInterval: 20_000,
  });

  const previewReconcile = useMutation({
    mutationFn: (awardId: string) =>
      marketplaceApi.reconcileAward(awardId, { dryRun: true }),
    onSuccess: (result, awardId) =>
      setActive({
        kind: "reconcile",
        targetId: awardId,
        phase: "preview",
        message:
          "This award is currently " +
          result.beforeState +
          ". Reconciling re-polls the exact saga step the sweep would take " +
          "(never a new one) and can only move it toward its next definite outcome.",
      }),
  });
  const applyReconcile = useMutation({
    mutationFn: (awardId: string) =>
      marketplaceApi.reconcileAward(awardId, { dryRun: true }).then((preview) =>
        marketplaceApi.reconcileAward(awardId, {
          dryRun: false,
          expectedUpdatedAt: preview.updatedAt,
        }),
      ),
    onSuccess: (result) => {
      setActive({
        kind: "reconcile",
        targetId: result.awardId,
        phase: "result",
        outcome: result.outcome,
        message:
          result.beforeState +
          " → " +
          result.afterState +
          (result.detail ? " — " + result.detail : ""),
      });
      void queryClient.invalidateQueries({ queryKey: ["mpPendingSagas"] });
    },
    onError: (e, awardId) =>
      setActive({
        kind: "reconcile",
        targetId: awardId,
        phase: "conflict",
        message: (e as Error).message,
      }),
  });

  const previewRetry = useMutation({
    mutationFn: (id: string) =>
      marketplaceApi.retryRecovery(id, { dryRun: true }),
    onSuccess: (result, id) =>
      setActive({
        kind: "retry",
        targetId: id,
        phase: "preview",
        message:
          "This recovery row has been retried " +
          result.row.attempts +
          " time(s). Retrying now calls the SAME recovery action the sweep uses.",
      }),
  });
  const applyRetry = useMutation({
    mutationFn: (id: string) =>
      marketplaceApi.retryRecovery(id, { dryRun: true }).then((preview) =>
        marketplaceApi.retryRecovery(id, {
          dryRun: false,
          expectedAttempts: preview.row.attempts,
        }),
      ),
    onSuccess: (result) => {
      setActive({
        kind: "retry",
        targetId: result.row.id,
        phase: "result",
        outcome: result.outcome,
        message: result.detail ?? "no further detail",
      });
      void queryClient.invalidateQueries({ queryKey: ["mpRecoveries"] });
    },
    onError: (e, id) =>
      setActive({
        kind: "retry",
        targetId: id,
        phase: "conflict",
        message: (e as Error).message,
      }),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <h1 className="font-heading text-lg font-semibold">
          Marketplace › Operations
        </h1>
      </div>
      <div className="flex-1 overflow-auto">
        <StuckSagaBoard
          sagasLoading={sagas.isLoading}
          sagasError={sagas.isError ? (sagas.error as Error).message : null}
          sagas={sagas.data?.rows ?? []}
          recoveriesLoading={recoveries.isLoading}
          recoveriesError={
            recoveries.isError ? (recoveries.error as Error).message : null
          }
          recoveries={(recoveries.data?.rows ?? []).map((r) => ({
            id: r.id,
            action: r.action,
            driverId: r.driverId,
            reservationId: r.reservationId,
            attempts: r.attempts,
            lastError: r.lastError,
            ageSec: r.ageSec,
          }))}
          active={active}
          onPreviewReconcile={(awardId) => previewReconcile.mutate(awardId)}
          onConfirmReconcile={(awardId) => applyReconcile.mutate(awardId)}
          onPreviewRetry={(id) => previewRetry.mutate(id)}
          onConfirmRetry={(id) => applyRetry.mutate(id)}
          onCancel={() => setActive(null)}
        />
      </div>
    </div>
  );
}
