"use client";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TravelOpsBoard } from "@/components/ops/TravelOpsBoard";
import { useOnlineStatus } from "@/components/ops/useOnlineStatus";
import { classifyError, isAmbiguousFailure, readFailure } from "@/lib/access";
import { newIdempotencyKey } from "@/lib/api-client";
import {
  ACTION_COPY,
  settlementDifferenceLine,
  toExceptionRows,
  toItineraryRows,
  toProviderCards,
  travelOpsApi,
  type ExceptionAction,
} from "@/lib/travel-ops";

type Pending = {
  orderId: string;
  action: ExceptionAction;
  /** Minted when the confirmation opened; one confirmed action per key. */
  idempotencyKey: string;
};

/**
 * Board 23e (left) — travel exceptions + provider health + airport transfers
 * + the joined-orders itinerary, inside the existing ops console. Unknown
 * results: lookup by UBI ref only; never re-book. No "settle all".
 */
export default function TravelOpsPage() {
  const qc = useQueryClient();
  const online = useOnlineStatus();
  const [pending, setPending] = useState<Pending | null>(null);
  const [result, setResult] = useState<{
    tone: "ok" | "err";
    text: string;
  } | null>(null);
  const [tripId, setTripId] = useState<string | null>(null);
  // Synchronous one-in-flight guard: `act.isPending` only updates on the
  // next render, and an exception action (chase_refund) advances a stage
  // per call, so a second click in the same tick must not send again.
  const inFlight = useRef(false);

  const ex = useQuery({
    queryKey: ["travelOpsExceptions"],
    queryFn: travelOpsApi.exceptions,
    refetchInterval: 30_000,
  });
  const health = useQuery({
    queryKey: ["travelOpsProviderHealth"],
    queryFn: travelOpsApi.providersHealth,
    refetchInterval: 30_000,
  });
  const trip = useQuery({
    queryKey: ["travelOpsTrip", tripId],
    queryFn: () => travelOpsApi.trip(tripId as string),
    enabled: tripId !== null,
  });

  const act = useMutation({
    mutationFn: (p: Pending) =>
      travelOpsApi.act(p.orderId, p.action, p.idempotencyKey),
    onSettled: () => {
      inFlight.current = false;
    },
    onSuccess: (_answer, p) => {
      setPending(null);
      setResult({
        tone: "ok",
        text:
          ACTION_COPY[p.action].label +
          " recorded on " +
          p.orderId +
          " with your operator id.",
      });
      void qc.invalidateQueries({ queryKey: ["travelOpsExceptions"] });
    },
    onError: (e, p) => {
      setPending(null);
      const state = classifyError(e);
      const label = ACTION_COPY[p.action].label + " on " + p.orderId;
      setResult({
        tone: "err",
        // A dropped connection or 5xx may have reached travel-service: the
        // operator is told the outcome is unknown, never that nothing ran.
        text: isAmbiguousFailure(e)
          ? label +
            ": the outcome is unknown — the request may have reached UBI (" +
            state.title +
            "). Reload the exceptions and check this order's state before doing anything else; do not repeat the action blindly."
          : label +
            " was refused — nothing was applied. " +
            state.title +
            ": " +
            state.message +
            " Reload the exceptions before trying again.",
      });
      void qc.invalidateQueries({ queryKey: ["travelOpsExceptions"] });
    },
  });

  const view = trip.data;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <h1 className="font-heading text-lg font-semibold">Ops › Travel</h1>
      </div>
      <div className="flex-1 overflow-auto">
        <TravelOpsBoard
          offline={!online}
          exceptions={{
            loading: ex.isLoading,
            error: readFailure(ex, online),
            rows: toExceptionRows(ex.data ?? []),
          }}
          providers={{
            loading: health.isLoading,
            error: readFailure(health, online),
            cards: toProviderCards(health.data),
            settlementLine: settlementDifferenceLine(health.data),
            generatedAt: health.data?.generatedAt,
          }}
          pendingAction={
            pending
              ? {
                  orderId: pending.orderId,
                  action: pending.action,
                  busy: act.isPending,
                }
              : null
          }
          actionResult={result}
          onRequestAction={(orderId, action) => {
            setResult(null);
            setPending({
              orderId,
              action,
              idempotencyKey: newIdempotencyKey(),
            });
          }}
          onConfirmAction={() => {
            if (pending && !act.isPending && !inFlight.current) {
              inFlight.current = true;
              act.mutate(pending);
            }
          }}
          onCancelAction={() => setPending(null)}
          trip={{
            lookedUp: tripId,
            loading: trip.isLoading,
            error: readFailure(trip, online),
            title: view?.title ?? null,
            dates:
              view?.startDate || view?.endDate
                ? (view?.startDate ?? "?") + " → " + (view?.endDate ?? "?")
                : null,
            rows: toItineraryRows(view),
          }}
          onLookupTrip={(id) => setTripId(id)}
        />
      </div>
    </div>
  );
}
