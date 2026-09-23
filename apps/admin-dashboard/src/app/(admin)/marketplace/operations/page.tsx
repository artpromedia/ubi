"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  StuckSagaBoard,
  type CommandState,
} from "@/components/marketplace/StuckSagaBoard";
import { AccessNotice } from "@/components/ops/AccessNotice";
import { useOnlineStatus } from "@/components/ops/useOnlineStatus";
import {
  classifyError,
  isAmbiguousFailure,
  isVersionConflict,
  readFailure,
} from "@/lib/access";
import { newIdempotencyKey } from "@/lib/api-client";
import { marketplaceApi } from "@/lib/marketplace-api";
import { formatMinorUnits } from "@/lib/money";
import { recoveryInfo, stepInfo } from "@/lib/saga-steps";

/**
 * What the operator confirmed: the row version the preview showed and the
 * ONE idempotency key minted for it. The apply sends exactly these — never a
 * fresh re-read — so a row that moved between preview and confirm is a
 * visible version conflict, and a double-click or a re-send after an
 * ambiguous failure replays one server-side outcome.
 */
type Confirmed =
  | {
      kind: "reconcile";
      targetId: string;
      expectedUpdatedAt: string;
      idempotencyKey: string;
    }
  | {
      kind: "retry";
      targetId: string;
      expectedAttempts: number;
      idempotencyKey: string;
    };

/** C08 — stuck-saga & failed-reservation-recovery board container. */
export default function StuckSagaOperationsContainer() {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const [active, setActive] = useState<CommandState>(null);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);

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

  /** A preview is a dry run, so its failure is never ambiguous; an apply's
   * network/5xx failure is, and re-arms EXACTLY the command that was sent
   * (`sent`: its version and key) for a safe re-send — not whatever preview
   * happens to be armed now. */
  const failed = (
    kind: "reconcile" | "retry",
    targetId: string,
    e: unknown,
    sent?: Confirmed,
  ) => {
    const apply = sent !== undefined;
    if (apply && isVersionConflict(e)) {
      setConfirmed(null);
      setActive({
        kind,
        targetId,
        phase: "conflict",
        message: (e as Error).message,
      });
      return;
    }
    const ambiguous = apply && isAmbiguousFailure(e);
    setConfirmed(ambiguous ? sent : null);
    setActive({
      kind,
      targetId,
      phase: "error",
      message: (e as Error).message,
      access: classifyError(e),
      ambiguous,
    });
  };

  const previewReconcile = useMutation({
    mutationFn: (awardId: string) =>
      marketplaceApi.reconcileAward(awardId, { dryRun: true }),
    onSuccess: (result, awardId) => {
      const row = sagas.data?.rows.find((s) => s.awardId === awardId);
      setConfirmed({
        kind: "reconcile",
        targetId: awardId,
        expectedUpdatedAt: result.updatedAt,
        idempotencyKey: newIdempotencyKey(),
      });
      setActive({
        kind: "reconcile",
        targetId: awardId,
        phase: "preview",
        message:
          "This award is currently " +
          result.beforeState +
          (row ? " at the " + stepInfo(row.step).label + " step" : "") +
          ". Reconciling re-polls the exact saga step the sweep would take " +
          "(never a new one) and can only move it toward its next definite outcome.",
        note: row ? stepInfo(row.step).reconcileNote : undefined,
      });
    },
    onError: (e, awardId) => failed("reconcile", awardId, e),
  });
  const applyReconcile = useMutation({
    mutationFn: (c: Extract<Confirmed, { kind: "reconcile" }>) =>
      marketplaceApi.reconcileAward(
        c.targetId,
        { dryRun: false, expectedUpdatedAt: c.expectedUpdatedAt },
        c.idempotencyKey,
      ),
    onMutate: () => setActive((a) => (a ? { ...a, busy: true } : a)),
    onSuccess: (result) => {
      setConfirmed(null);
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
    onError: (e, c) => failed("reconcile", c.targetId, e, c),
  });

  const previewRetry = useMutation({
    mutationFn: (id: string) =>
      marketplaceApi.retryRecovery(id, { dryRun: true }),
    onSuccess: (result, id) => {
      const info = recoveryInfo(result.row.action);
      setConfirmed({
        kind: "retry",
        targetId: id,
        expectedAttempts: result.row.attempts,
        idempotencyKey: newIdempotencyKey(),
      });
      setActive({
        kind: "retry",
        targetId: id,
        phase: "preview",
        message:
          info.label +
          " — retried " +
          result.row.attempts +
          " time(s). Retrying now calls the SAME recovery action the sweep uses.",
        note: info.retryNote,
      });
    },
    onError: (e, id) => failed("retry", id, e),
  });
  const applyRetry = useMutation({
    mutationFn: (c: Extract<Confirmed, { kind: "retry" }>) =>
      marketplaceApi.retryRecovery(
        c.targetId,
        { dryRun: false, expectedAttempts: c.expectedAttempts },
        c.idempotencyKey,
      ),
    onMutate: () => setActive((a) => (a ? { ...a, busy: true } : a)),
    onSuccess: (result) => {
      setConfirmed(null);
      setActive({
        kind: "retry",
        targetId: result.row.id,
        phase: "result",
        outcome: result.outcome,
        message: result.detail ?? "no further detail",
      });
      void queryClient.invalidateQueries({ queryKey: ["mpRecoveries"] });
    },
    onError: (e, c) => failed("retry", c.targetId, e, c),
  });

  const applying = applyReconcile.isPending || applyRetry.isPending;
  const confirm = (kind: "reconcile" | "retry", targetId: string) => {
    // Only what was previewed can be applied, and only once at a time.
    if (
      confirmed === null ||
      confirmed.kind !== kind ||
      confirmed.targetId !== targetId ||
      applying
    ) {
      return;
    }
    if (confirmed.kind === "reconcile") {
      applyReconcile.mutate(confirmed);
    } else {
      applyRetry.mutate(confirmed);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <h1 className="font-heading text-lg font-semibold">
          Marketplace › Operations
        </h1>
      </div>
      <div className="flex-1 overflow-auto">
        {online ? null : (
          <div className="px-6 pt-6" data-testid="mp.admin.saga.offline">
            <AccessNotice
              state={classifyError(null, false)}
              context="the lists below are the last ones loaded"
            />
          </div>
        )}
        <StuckSagaBoard
          sagasLoading={sagas.isLoading}
          sagasError={readFailure(sagas, online)}
          sagas={sagas.data?.rows ?? []}
          recoveriesLoading={recoveries.isLoading}
          recoveriesError={readFailure(recoveries, online)}
          recoveries={(recoveries.data?.rows ?? []).map((r) => ({
            id: r.id,
            action: r.action,
            driverId: r.driverId,
            reservationId: r.reservationId,
            attempts: r.attempts,
            lastError: r.lastError,
            ageSec: r.ageSec,
            // The recovery read carries no currency: shown as the server's
            // minor units, never converted or assumed.
            amountLine:
              r.amountMinor === undefined
                ? undefined
                : formatMinorUnits(r.amountMinor),
          }))}
          active={active}
          // A preview arriving mid-apply would re-arm the confirm panel under
          // the in-flight command; previews wait until the apply settles.
          onPreviewReconcile={(awardId) => {
            if (!applying) {
              previewReconcile.mutate(awardId);
            }
          }}
          onConfirmReconcile={(awardId) => confirm("reconcile", awardId)}
          onPreviewRetry={(id) => {
            if (!applying) {
              previewRetry.mutate(id);
            }
          }}
          onConfirmRetry={(id) => confirm("retry", id)}
          onCancel={() => {
            setConfirmed(null);
            setActive(null);
          }}
        />
      </div>
    </div>
  );
}
