"use client";
import React from "react";

/** A01 + A02 — presentational component wired by src/app/(admin)/marketplace/page.tsx.
 * Tailwind classes use the shared admin palette (admin.primary #191414, admin.secondary #2563eb, admin.accent #1DB954).
 * Timeline events are append-only from GET /admin/mp/requests/:id/timeline; no mutation controls here. */
export type MonitorStat = {
  label: string;
  value: string;
  detail?: string;
  tone?: "ok" | "warn" | "danger";
};
export type MonitorRow = {
  requestId: string;
  route: string;
  service: string;
  asked: string;
  bids: number;
  reach: string;
  envelope: string;
  state: "open" | "award_pending" | "awarded" | "no_bids";
};
export type TimelineEvent = {
  at: string;
  type: string;
  tone: "info" | "warn" | "ok";
  detail: string;
};

const STATE_PILL: Record<MonitorRow["state"], string> = {
  open: "bg-amber-50 text-amber-700",
  no_bids: "bg-amber-50 text-amber-700",
  award_pending: "bg-blue-50 text-blue-700",
  awarded: "bg-green-50 text-green-700",
};
const STATE_LABEL: Record<MonitorRow["state"], string> = {
  open: "Open",
  no_bids: "Open · no bids",
  award_pending: "Award pending",
  awarded: "Awarded",
};
const EVENT_TONE: Record<TimelineEvent["tone"], string> = {
  info: "text-blue-700",
  warn: "text-amber-700",
  ok: "text-green-700",
};

export function MarketplaceMonitorPage({
  stats,
  rows,
  timeline,
  onOpenCase,
}: {
  stats: MonitorStat[];
  rows: MonitorRow[];
  timeline: {
    requestId: string;
    policyLine: string;
    events: TimelineEvent[];
  } | null;
  onOpenCase: (requestId: string) => void;
}) {
  return (
    <div
      className="flex flex-col gap-4 p-6"
      data-testid="mp.admin.monitor.table"
    >
      <div className="grid grid-cols-4 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-xl border border-neutral-200 bg-white p-4"
          >
            <div className="text-xs text-neutral-500">{s.label}</div>
            <div
              className={
                "font-semibold text-2xl tabular-nums " +
                (s.tone === "danger" ? "text-red-700" : "text-neutral-900")
              }
            >
              {s.value}
            </div>
            {s.detail ? (
              <div
                className={
                  "text-xs " +
                  (s.tone === "danger"
                    ? "text-red-700"
                    : s.tone === "ok"
                      ? "text-green-700"
                      : "text-neutral-500")
                }
              >
                {s.detail}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 bg-neutral-50 text-left text-[11px] uppercase tracking-wide text-neutral-500">
              <th className="px-4 py-2 font-semibold">Request</th>
              <th className="px-4 py-2 font-semibold">Route (approx)</th>
              <th className="px-4 py-2 font-semibold">Service</th>
              <th className="px-4 py-2 font-semibold">Asked</th>
              <th className="px-4 py-2 font-semibold">Bids</th>
              <th className="px-4 py-2 font-semibold">Reach</th>
              <th className="px-4 py-2 font-semibold">Envelope</th>
              <th className="px-4 py-2 font-semibold">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.requestId}
                className="cursor-pointer border-b border-neutral-100 last:border-0 hover:bg-neutral-50"
                onClick={() => onOpenCase(r.requestId)}
              >
                <td className="px-4 py-3 font-mono text-xs">{r.requestId}</td>
                <td className="px-4 py-3">{r.route}</td>
                <td className="px-4 py-3">{r.service}</td>
                <td className="px-4 py-3 tabular-nums">{r.asked}</td>
                <td className="px-4 py-3 tabular-nums">{r.bids}</td>
                <td className="px-4 py-3 tabular-nums">{r.reach}</td>
                <td className="px-4 py-3">{r.envelope}</td>
                <td className="px-4 py-3">
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide " +
                      STATE_PILL[r.state]
                    }
                  >
                    {STATE_LABEL[r.state]}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {timeline ? (
        <div
          className="rounded-xl border border-neutral-200 bg-white p-4"
          data-testid={"mp.admin.timeline." + timeline.requestId}
        >
          <div className="mb-2 flex items-center gap-2">
            <div className="flex-1 font-semibold text-neutral-900">
              Timeline · {timeline.requestId}{" "}
              <span className="font-mono text-xs font-normal text-neutral-400">
                {timeline.policyLine}
              </span>
            </div>
            <button
              className="text-sm font-semibold text-admin-secondary"
              onClick={() => onOpenCase(timeline.requestId)}
            >
              Open full case
            </button>
          </div>
          {timeline.events.map((e, i) => (
            <div
              key={i}
              className="flex gap-3 border-b border-neutral-100 py-2 text-sm last:border-0"
            >
              <span className="w-16 font-mono text-xs text-neutral-400">
                {e.at}
              </span>
              <span className={"w-48 font-mono text-xs " + EVENT_TONE[e.tone]}>
                {e.type}
              </span>
              <span className="flex-1 text-neutral-900">{e.detail}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
