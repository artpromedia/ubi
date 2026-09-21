"use client";
import React from "react";

/**
 * C08 — the unified resolution timeline: request → award → funding →
 * commission → execution → settlement/reversal → notification, stitched
 * from ride-service's own reads (see AdminResolution). Every stage carries a
 * tone the operator reads at a glance: view (grey), proposed (blue, in
 * flight), committed (green), failed (red), unavailable (amber — a named
 * gap, never a fabricated row). Read-only: no mutation control lives here —
 * those live on the stuck-saga and standing boards this view links out to.
 */
export type StageStatus =
  | "view"
  | "proposed"
  | "committed"
  | "failed"
  | "unavailable";
export type ResolutionStageRow = {
  name: string;
  status: StageStatus;
  detail: string;
  at?: string;
};
export type ResolutionEventRow = { at: string; type: string; detail: string };
export type ResolutionTimelineProps = {
  loading: boolean;
  error: string | null;
  requestId: string;
  requestState: string | null;
  awardLine: string | null;
  executionLine: string | null;
  driverBlocked: boolean | null;
  stages: ResolutionStageRow[];
  events: ResolutionEventRow[];
  gaps: string[];
  onExport: () => void;
};

const STAGE_TONE: Record<StageStatus, string> = {
  view: "bg-neutral-100 text-neutral-600",
  proposed: "bg-blue-50 text-blue-700",
  committed: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
  unavailable: "bg-amber-50 text-amber-700",
};
const STAGE_LABEL: Record<StageStatus, string> = {
  view: "View",
  proposed: "Proposed action",
  committed: "Committed",
  failed: "Failed",
  unavailable: "Unavailable",
};

export function ResolutionTimelinePage(p: ResolutionTimelineProps) {
  if (p.loading) {
    return (
      <div
        className="p-6 text-sm text-neutral-500"
        data-testid="mp.admin.resolution.loading"
      >
        Loading resolution case…
      </div>
    );
  }
  if (p.error) {
    return (
      <div
        className="p-6 text-sm text-red-700"
        data-testid="mp.admin.resolution.error"
      >
        Could not load this resolution case: {p.error}
      </div>
    );
  }
  return (
    <div
      className="flex flex-col gap-4 p-6"
      data-testid="mp.admin.resolution.page"
    >
      <div className="flex items-center gap-3">
        <h2 className="flex-1 font-semibold text-neutral-900">
          Resolution · {p.requestId}{" "}
          <span className="font-mono text-xs font-normal text-neutral-400">
            {p.requestState}
          </span>
        </h2>
        {p.driverBlocked ? (
          <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-red-700">
            Driver suspended
          </span>
        ) : null}
        <button
          data-testid="mp.admin.resolution.export"
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-xs font-semibold text-neutral-900"
          onClick={p.onExport}
        >
          Export (redacted)
        </button>
      </div>
      {p.awardLine ? (
        <p className="text-xs text-neutral-500">{p.awardLine}</p>
      ) : null}
      {p.executionLine ? (
        <p className="text-xs text-neutral-500">{p.executionLine}</p>
      ) : null}

      <div
        className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4"
        data-testid="mp.admin.resolution.stages"
      >
        {p.stages.map((s) => (
          <div
            key={s.name}
            className="rounded-xl border border-neutral-200 bg-white p-3"
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                {s.name}
              </span>
              <span
                className={
                  "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide " +
                  STAGE_TONE[s.status]
                }
              >
                {STAGE_LABEL[s.status]}
              </span>
            </div>
            <p className="text-xs text-neutral-700">{s.detail}</p>
            {s.at ? (
              <p className="mt-1 font-mono text-[10px] text-neutral-400">
                {s.at}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      {p.gaps.length > 0 ? (
        <div
          className="rounded-xl bg-amber-50 p-3 text-xs text-neutral-900"
          data-testid="mp.admin.resolution.gaps"
        >
          <b>Named data-source gaps (not fabricated):</b>
          <ul className="mt-1 list-disc pl-4">
            {p.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {p.events.length === 0 ? (
        <p
          className="rounded-xl border border-neutral-200 bg-white p-4 text-xs text-neutral-500"
          data-testid="mp.admin.resolution.emptyEvents"
        >
          No events recorded yet.
        </p>
      ) : (
        <div className="rounded-xl border border-neutral-200 bg-white p-4">
          <h3 className="mb-2 text-sm font-semibold text-neutral-900">
            Events
          </h3>
          {p.events.map((e, i) => (
            <div
              key={i}
              className="flex gap-3 border-b border-neutral-100 py-2 text-sm last:border-0"
            >
              <span className="w-40 font-mono text-xs text-neutral-400">
                {e.at}
              </span>
              <span className="w-52 font-mono text-xs text-neutral-700">
                {e.type}
              </span>
              <span className="flex-1 text-neutral-900">{e.detail}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
