"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  StuckSagaBoard,
  type CommandKind,
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
import { formatMinorUnits, formatServerMoney } from "@/lib/money";
import {
  DELIVERY_CANCEL_RETRY_NOTE,
  businessOpInfo,
  recoveryInfo,
  stepInfo,
} from "@/lib/saga-steps";

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
    }
  | {
      kind: "retryBusiness";
      targetId: string;
      expectedAttempts: number;
      idempotencyKey: string;
      reason?: string;
    }
  | {
      kind: "retryDeliveryCancel";
      targetId: string;
      expectedAttempts: number;
      idempotencyKey: string;
      reason?: string;
    };

/** C08 — stuck-saga & failed-reservation-recovery board container. */
export default function StuckSagaOperationsContainer() {
  const queryClient = useQueryClient();
  const online = useOnlineStatus();
  const [active, setActive] = useState<CommandState>(null);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [reason, setReason] = useState("");

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
  const owedBusiness = useQuery({
    queryKey: ["mpOwedBusinessBookings"],
    queryFn: () => marketplaceApi.businessBookings(true),
    refetchInterval: 20_000,
  });
  const deliveryCancels = useQuery({
    queryKey: ["mpDeliveryCancellations"],
    queryFn: () => marketplaceApi.deliveryCancellations("pending"),
    refetchInterval: 20_000,
  });

  /** A preview is a dry run, so its failure is never ambiguous; an apply's
   * network/5xx failure is, and re-arms EXACTLY the command that was sent
   * (`sent`: its version and key) for a safe re-send — not whatever preview
   * happens to be armed now. */
  const failed = (
    kind: CommandKind,
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
      setReason("");
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
      setReason("");
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

  const previewRetryBusiness = useMutation({
    mutationFn: (awardId: string) =>
      marketplaceApi.retryBusinessBooking(awardId, { dryRun: true }),
    onSuccess: (result, awardId) => {
      const info = businessOpInfo(result.row.owedOp);
      setReason("");
      setConfirmed({
        kind: "retryBusiness",
        targetId: awardId,
        expectedAttempts: result.row.attempts,
        idempotencyKey: newIdempotencyKey(),
      });
      setActive({
        kind: "retryBusiness",
        targetId: awardId,
        phase: "preview",
        message:
          info.label +
          " (" +
          formatServerMoney(result.row.owedMinor) +
          ") — retried " +
          result.row.attempts +
          " time(s). Retrying now calls the SAME business-budget action the sweep uses.",
        note: info.retryNote,
      });
    },
    onError: (e, awardId) => failed("retryBusiness", awardId, e),
  });
  const applyRetryBusiness = useMutation({
    mutationFn: (c: Extract<Confirmed, { kind: "retryBusiness" }>) =>
      marketplaceApi.retryBusinessBooking(
        c.targetId,
        {
          dryRun: false,
          expectedAttempts: c.expectedAttempts,
          reason: c.reason,
        },
        c.idempotencyKey,
      ),
    onMutate: () => setActive((a) => (a ? { ...a, busy: true } : a)),
    onSuccess: (result) => {
      setConfirmed(null);
      setReason("");
      setActive({
        kind: "retryBusiness",
        targetId: result.row.awardId,
        phase: "result",
        outcome: result.outcome,
        message: result.detail ?? "no further detail",
      });
      void queryClient.invalidateQueries({
        queryKey: ["mpOwedBusinessBookings"],
      });
    },
    onError: (e, c) => failed("retryBusiness", c.targetId, e, c),
  });

  const previewRetryDeliveryCancel = useMutation({
    mutationFn: (awardId: string) =>
      marketplaceApi.retryDeliveryCancellation(awardId, { dryRun: true }),
    onSuccess: (result, awardId) => {
      setReason("");
      setConfirmed({
        kind: "retryDeliveryCancel",
        targetId: awardId,
        expectedAttempts: result.row.attempts,
        idempotencyKey: newIdempotencyKey(),
      });
      setActive({
        kind: "retryDeliveryCancel",
        targetId: awardId,
        phase: "preview",
        message:
          "Delivery cancellation for " +
          result.row.deliveryId +
          " — retried " +
          result.row.attempts +
          " time(s). Retrying now calls the SAME delivery cancellation action the sweep uses.",
        note: DELIVERY_CANCEL_RETRY_NOTE,
      });
    },
    onError: (e, awardId) => failed("retryDeliveryCancel", awardId, e),
  });
  const applyRetryDeliveryCancel = useMutation({
    mutationFn: (c: Extract<Confirmed, { kind: "retryDeliveryCancel" }>) =>
      marketplaceApi.retryDeliveryCancellation(
        c.targetId,
        {
          dryRun: false,
          expectedAttempts: c.expectedAttempts,
          reason: c.reason,
        },
        c.idempotencyKey,
      ),
    onMutate: () => setActive((a) => (a ? { ...a, busy: true } : a)),
    onSuccess: (result) => {
      setConfirmed(null);
      setReason("");
      setActive({
        kind: "retryDeliveryCancel",
        targetId: result.row.awardId,
        phase: "result",
        outcome: result.outcome,
        message: result.detail ?? "no further detail",
      });
      void queryClient.invalidateQueries({
        queryKey: ["mpDeliveryCancellations"],
      });
    },
    onError: (e, c) => failed("retryDeliveryCancel", c.targetId, e, c),
  });

  const applying =
    applyReconcile.isPending ||
    applyRetry.isPending ||
    applyRetryBusiness.isPending ||
    applyRetryDeliveryCancel.isPending;

  const confirm = (
    kind: CommandKind,
    targetId: string,
    operatorReason?: string,
  ) => {
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
    } else if (confirmed.kind === "retry") {
      applyRetry.mutate(confirmed);
    } else if (confirmed.kind === "retryBusiness") {
      const resolvedReason = (operatorReason ?? confirmed.reason ?? "").trim();
      if (!resolvedReason) return;
      const payload = { ...confirmed, reason: resolvedReason };
      setConfirmed(payload);
      applyRetryBusiness.mutate(payload);
    } else {
      const resolvedReason = (operatorReason ?? confirmed.reason ?? "").trim();
      if (!resolvedReason) return;
      const payload = { ...confirmed, reason: resolvedReason };
      setConfirmed(payload);
      applyRetryDeliveryCancel.mutate(payload);
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
            amountLine:
              r.amountMinor === undefined
                ? undefined
                : r.currency
                  ? formatServerMoney({
                      amountMinor: r.amountMinor,
                      currency: r.currency,
                    })
                  : formatMinorUnits(r.amountMinor),
          }))}
          owedBusinessLoading={owedBusiness.isLoading}
          owedBusinessError={readFailure(owedBusiness, online)}
          owedBusiness={(owedBusiness.data?.rows ?? []).map((b) => ({
            awardId: b.awardId,
            requestId: b.requestId,
            organizationId: b.organizationId,
            owedOp: b.owedOp,
            owedLine: formatServerMoney(b.owedMinor),
            reservedLine: formatServerMoney(b.reservedMinor),
            attempts: b.attempts,
            lastError: b.lastError,
            ageSec: b.ageSec,
          }))}
          deliveryCancelsLoading={deliveryCancels.isLoading}
          deliveryCancelsError={readFailure(deliveryCancels, online)}
          deliveryCancels={(deliveryCancels.data?.rows ?? []).map((d) => ({
            awardId: d.awardId,
            requestId: d.requestId,
            deliveryId: d.deliveryId,
            cancelledBy: d.cancelledBy,
            reason: d.reason,
            attempts: d.attempts,
            lastError: d.lastError,
            ageSec: d.ageSec,
          }))}
          active={active}
          reason={reason}
          onReasonChange={setReason}
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
          onPreviewRetryBusiness={(awardId) => {
            if (!applying) {
              previewRetryBusiness.mutate(awardId);
            }
          }}
          onConfirmRetryBusiness={(awardId, r) =>
            confirm("retryBusiness", awardId, r)
          }
          onPreviewRetryDeliveryCancel={(awardId) => {
            if (!applying) {
              previewRetryDeliveryCancel.mutate(awardId);
            }
          }}
          onConfirmRetryDeliveryCancel={(awardId, r) =>
            confirm("retryDeliveryCancel", awardId, r)
          }
          onCancel={() => {
            setConfirmed(null);
            setActive(null);
            setReason("");
          }}
        />
      </div>
    </div>
  );
}
