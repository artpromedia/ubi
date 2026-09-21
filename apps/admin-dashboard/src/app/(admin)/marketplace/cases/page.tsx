"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResolutionTimelinePage } from "@/components/marketplace/ResolutionTimelinePage";
import { fmt } from "@/lib/growth-api";
import { marketplaceApi, redactedExport } from "@/lib/marketplace-api";

/** C08 — the unified resolution timeline, looked up by request id. */
export default function ResolutionCaseContainer() {
  const [requestId, setRequestId] = useState("");
  const [lookedUp, setLookedUp] = useState<string | null>(null);

  const resolution = useQuery({
    queryKey: ["mpResolution", lookedUp],
    queryFn: () => marketplaceApi.resolution(lookedUp as string),
    enabled: lookedUp !== null,
  });

  const view = resolution.data;
  const awardLine = view?.award
    ? "Award " +
      view.award.awardId +
      " · driver " +
      view.award.driverId +
      " · fare " +
      fmt(view.award.fareMinor) +
      " · commission " +
      fmt(view.award.commissionMinor) +
      (view.award.captureReceiptId
        ? " · receipt " + view.award.captureReceiptId
        : "")
    : null;
  const executionLine = view?.execution
    ? "Execution ride " + view.execution.rideId + " · " + view.execution.state
    : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <h1 className="font-heading text-lg font-semibold">
          Marketplace › Cases
        </h1>
        <input
          data-testid="mp.admin.cases.requestId"
          value={requestId}
          onChange={(e) => setRequestId(e.target.value)}
          placeholder="Request id"
          className="ml-auto w-72 rounded-lg border border-border bg-card px-2 py-1 text-sm text-foreground"
        />
        <button
          data-testid="mp.admin.cases.open"
          className="rounded-lg bg-admin-secondary px-3 py-1.5 text-sm font-semibold text-white"
          onClick={() => setLookedUp(requestId)}
        >
          Open
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {lookedUp === null ? (
          <p className="p-6 text-sm text-muted-foreground">
            Enter a request id to open its resolution case.
          </p>
        ) : (
          <ResolutionTimelinePage
            loading={resolution.isLoading}
            error={
              resolution.isError ? (resolution.error as Error).message : null
            }
            requestId={lookedUp}
            requestState={view?.requestState ?? null}
            awardLine={awardLine}
            executionLine={executionLine}
            driverBlocked={view?.driverBlocked ?? null}
            stages={view?.stages ?? []}
            events={view?.events ?? []}
            gaps={view?.gaps ?? []}
            onExport={() => {
              if (typeof window === "undefined" || !view) return;
              const blob = new Blob([redactedExport(view)], {
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
