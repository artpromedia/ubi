'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MarketplaceMonitorPage } from '@/components/marketplace/MarketplaceMonitorPage';
import { marketplaceApi, monitorStats, toMonitorRow, toTimelineEvents } from '@/lib/marketplace-api';

/** M09 A01+A02 — live request monitor + versioned append-only timeline (no mutation controls). */
export default function MarketplaceMonitorContainer() {
  const [selected, setSelected] = useState<string | null>(null);
  const requests = useQuery({ queryKey: ['mpRequests'], queryFn: () => marketplaceApi.requests(), refetchInterval: 15_000 });
  const timeline = useQuery({ queryKey: ['mpTimeline', selected], queryFn: () => marketplaceApi.timeline(selected as string), enabled: selected !== null });
  const rows = (requests.data?.rows ?? []).map(toMonitorRow).filter((r) => r !== null);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border p-4">
        <h1 className="font-heading text-lg font-semibold">Marketplace › Live requests</h1>
        {requests.isLoading ? <span className="text-xs text-muted-foreground">Loading…</span> : null}
      </div>
      {requests.isError ? (
        <div data-testid="mp.admin.monitor.error" className="border-b border-border bg-red-500/15 p-3 text-xs text-red-400">
          Could not load marketplace requests: {(requests.error as Error).message}
        </div>
      ) : null}
      {timeline.isError && selected !== null ? (
        <div className="border-b border-border bg-red-500/15 p-3 text-xs text-red-400">
          Could not load timeline for {selected}: {(timeline.error as Error).message}
        </div>
      ) : null}
      <div className="flex-1 overflow-auto">
        <MarketplaceMonitorPage
          stats={monitorStats(rows)}
          rows={rows}
          timeline={
            timeline.data
              ? { requestId: timeline.data.requestId, policyLine: 'policy v' + timeline.data.policyVersion, events: toTimelineEvents(timeline.data) }
              : null
          }
          onOpenCase={(requestId) => setSelected(requestId)}
        />
      </div>
    </div>
  );
}
