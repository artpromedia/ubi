"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResolutionTimelinePage } from "@/components/marketplace/ResolutionTimelinePage";
import { useOnlineStatus } from "@/components/ops/useOnlineStatus";
import { readFailure } from "@/lib/access";
import { redactedCaseExport, marketplaceApi } from "@/lib/marketplace-api";
import { formatServerMoney } from "@/lib/money";
import { TIMELINE_COVERAGE_GAPS, renderTimelineEvents } from "@/lib/mp-events";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** C08 — the unified resolution timeline, looked up by request id. */
export default function ResolutionCaseContainer() {
  const online = useOnlineStatus();
  const [requestId, setRequestId] = useState("");
  const [lookedUp, setLookedUp] = useState<string | null>(null);
  const trimmed = requestId.trim();
  const valid = UUID_RE.test(trimmed);

  const resolution = useQuery({
    queryKey: ["mpResolution", lookedUp],
    queryFn: () => marketplaceApi.resolution(lookedUp as string),
    enabled: lookedUp !== null,
  });

  const view = resolution.data;
  // Amounts an event carries without a currency are shown in the request's
  // own server currency (the award's fare), never an assumed one.
  const ctx = { currency: view?.award?.fareMinor.currency };
  const awardLine = view?.award
    ? "Award " +
      view.award.awardId +
      " · driver " +
      view.award.driverId +
      " · fare " +
      formatServerMoney(view.award.fareMinor) +
      " · commission " +
      formatServerMoney(view.award.commissionMinor) +
      (view.award.captureReceiptId
        ? " · receipt " + view.award.captureReceiptId
        : "")
    : null;
  const executionLine = view?.execution
    ? "Execution ride " + view.execution.rideId + " · " + view.execution.state
    : null;

  return (
    <div className="flex h-full flex-col">
      <form
        className="flex flex-wrap items-center gap-3 border-b border-border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) {
            setLookedUp(trimmed);
          }
        }}
      >
        <h1 className="font-heading text-lg font-semibold">
          Marketplace › Cases
        </h1>
        <input
          data-testid="mp.admin.cases.requestId"
          value={requestId}
          onChange={(e) => setRequestId(e.target.value)}
          placeholder="Request id (UUID)"
          aria-invalid={trimmed !== "" && !valid}
          className="ml-auto w-80 rounded-lg border border-border bg-card px-2 py-1 font-mono text-sm text-foreground"
        />
        <button
          type="submit"
          data-testid="mp.admin.cases.open"
          disabled={!valid}
          className="rounded-lg bg-admin-secondary px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          Open
        </button>
        {trimmed !== "" && !valid ? (
          <p className="w-full text-right text-xs text-amber-600">
            A marketplace request id is a UUID.
          </p>
        ) : null}
      </form>
      <div className="flex-1 overflow-auto">
        {lookedUp === null ? (
          <p className="p-6 text-sm text-muted-foreground">
            Enter a request id to open its resolution case.
          </p>
        ) : (
          <ResolutionTimelinePage
            loading={resolution.isLoading}
            // Offline, the lookup is paused (not loading, no data): say so
            // rather than render an empty case.
            error={readFailure(resolution, online)}
            requestId={lookedUp}
            requestState={view?.requestState ?? null}
            awardLine={awardLine}
            executionLine={executionLine}
            driverBlocked={view?.driverBlocked ?? null}
            stages={view?.stages ?? []}
            events={renderTimelineEvents(view?.events ?? [], ctx)}
            gaps={view ? [...view.gaps, ...TIMELINE_COVERAGE_GAPS] : []}
            onExport={() => {
              if (typeof window === "undefined" || !view) {
                return;
              }
              const blob = new Blob([redactedCaseExport(view, ctx)], {
                type: "application/json",
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "resolution-" + lookedUp + ".json";
              a.click();
              URL.revokeObjectURL(url);
            }}
          />
        )}
      </div>
    </div>
  );
}
