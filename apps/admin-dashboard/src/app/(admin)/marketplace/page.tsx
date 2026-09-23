"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { MarketplaceMonitorPage } from "@/components/marketplace/MarketplaceMonitorPage";
import { AccessNotice } from "@/components/ops/AccessNotice";
import { useOnlineStatus } from "@/components/ops/useOnlineStatus";
import { classifyError, readFailure } from "@/lib/access";
import {
  marketplaceApi,
  monitorStats,
  toMonitorRow,
  toTimelineEvents,
} from "@/lib/marketplace-api";

/** M09 A01+A02 — live request monitor + versioned append-only timeline (no mutation controls). */
export default function MarketplaceMonitorContainer() {
  const online = useOnlineStatus();
  const [selected, setSelected] = useState<string | null>(null);
  const requests = useQuery({
    queryKey: ["mpRequests"],
    queryFn: () => marketplaceApi.requests(),
    refetchInterval: 15_000,
  });
  const timeline = useQuery({
    queryKey: ["mpTimeline", selected],
    queryFn: () => marketplaceApi.timeline(selected as string),
    enabled: selected !== null,
  });
  const rows = (requests.data?.rows ?? [])
    .map(toMonitorRow)
    .filter((r) => r !== null);
  // The selected request's own server currency, for event amounts that
  // travel without one (never an assumed currency).
  const currency = requests.data?.rows.find((r) => r.requestId === selected)
    ?.askedMinor?.currency;
  // Offline, reads pause (no error, no data): without this the monitor would
  // read as "no open requests" and a selected timeline would never appear.
  const requestsFailure =
    readFailure(requests, online) ??
    (online ? null : classifyError(null, false));
  const timelineFailure =
    selected !== null ? readFailure(timeline, online) : null;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <h1 className="font-heading text-lg font-semibold">
          Marketplace › Live requests
        </h1>
        {requests.isLoading ? (
          <span className="text-xs text-muted-foreground">Loading…</span>
        ) : null}
      </div>
      {requestsFailure ? (
        <div data-testid="mp.admin.monitor.error" className="p-3">
          <AccessNotice
            state={requestsFailure}
            context={
              requests.data
                ? "showing the last requests loaded"
                : "marketplace requests"
            }
          />
        </div>
      ) : null}
      {timelineFailure && selected !== null ? (
        <div className="p-3">
          <AccessNotice
            state={timelineFailure}
            context={"timeline for " + selected}
          />
        </div>
      ) : null}
      <div className="flex-1 overflow-auto">
        <MarketplaceMonitorPage
          stats={monitorStats(rows)}
          rows={rows}
          timeline={
            timeline.data
              ? {
                  requestId: timeline.data.requestId,
                  policyLine: "policy v" + timeline.data.policyVersion,
                  events: toTimelineEvents(timeline.data, { currency }),
                }
              : null
          }
          onOpenCase={(requestId) => setSelected(requestId)}
        />
      </div>
    </div>
  );
}
