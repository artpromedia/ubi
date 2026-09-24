"use client";
import React, { useState } from "react";

import type { RenderedTimelineEvent } from "../../lib/mp-events";

/**
 * Append-only event history rendered from lib/mp-events.ts: each row shows
 * the operator copy (never the raw payload), the event name for grep-ability,
 * its category and the server facts (ids, reason codes, server money). An
 * event this build has no renderer for is flagged amber, values hidden.
 * The category filter is view-only state; nothing here mutates anything.
 */
const TONE: Record<RenderedTimelineEvent["tone"], string> = {
  info: "text-blue-700",
  warn: "text-amber-700",
  ok: "text-green-700",
};

export function TimelineEventList({
  events,
  testId = "mp.admin.events",
}: {
  events: RenderedTimelineEvent[];
  testId?: string;
}) {
  const [picked, setPicked] = useState<string>("all");
  const categories = Array.from(
    new Map(events.map((e) => [e.category, e.categoryLabel])).entries(),
  );
  // A filter left over from another case (a cached case re-renders this
  // same list) falls back to "all" rather than hiding every row with no
  // filter button left to clear it.
  const category = categories.some(([key]) => key === picked) ? picked : "all";
  const shown =
    category === "all" ? events : events.filter((e) => e.category === category);

  return (
    <div
      className="rounded-xl border border-neutral-200 bg-white p-4"
      data-testid={testId}
    >
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-sm font-semibold text-neutral-900">
          Events{" "}
          <span className="text-xs font-normal text-neutral-400">
            append-only · payloads never shown raw
          </span>
        </h3>
        {categories.length > 1 ? (
          <>
            <button
              type="button"
              className={
                "rounded-full border px-2 py-0.5 text-[11px] " +
                (category === "all"
                  ? "border-neutral-900 bg-neutral-900 text-white"
                  : "border-neutral-200 text-neutral-600")
              }
              onClick={() => setPicked("all")}
            >
              All ({events.length})
            </button>
            {categories.map(([key, label]) => (
              <button
                key={key}
                type="button"
                data-testid={testId + ".filter." + key}
                className={
                  "rounded-full border px-2 py-0.5 text-[11px] " +
                  (category === key
                    ? "border-neutral-900 bg-neutral-900 text-white"
                    : "border-neutral-200 text-neutral-600")
                }
                onClick={() => setPicked(key)}
              >
                {label} ({events.filter((e) => e.category === key).length})
              </button>
            ))}
          </>
        ) : null}
      </div>
      {shown.map((e, i) => (
        <div
          key={e.atIso + e.type + i}
          data-testid={testId + ".row"}
          data-event-type={e.type}
          className={
            "flex flex-col gap-1 border-b border-neutral-100 py-2 text-sm last:border-0 sm:flex-row sm:gap-3 " +
            (e.known ? "" : "bg-amber-50")
          }
        >
          <span className="w-44 shrink-0 font-mono text-xs text-neutral-400">
            {e.at}
          </span>
          <div className="w-56 shrink-0">
            <div className={"text-xs font-semibold " + TONE[e.tone]}>
              {e.label}
            </div>
            <div className="font-mono text-[10px] text-neutral-400">
              {e.type}
            </div>
            <span className="mt-0.5 inline-block rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
              {e.categoryLabel}
            </span>
          </div>
          <div className="flex-1">
            <p className="text-neutral-900">{e.summary}</p>
            {e.facts.length > 0 ? (
              <dl className="mt-1 grid grid-cols-1 gap-x-3 gap-y-0.5 text-[11px] sm:grid-cols-[max-content_1fr]">
                {e.facts.map((f) => (
                  <React.Fragment key={f.label}>
                    <dt className="text-neutral-500">{f.label}</dt>
                    <dd className="break-all font-mono text-neutral-800">
                      {f.value}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
