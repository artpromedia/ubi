"use client";

/**
 * B1 / B3 — the day timeline: a 06:00–22:00 ruler in the fleet's zone, a
 * "now" marker, fixed-height virtualised rows (tested to 200+) and, per row,
 * lanes of blocks. Vehicle rows: assignments + maintenance on top, opaque
 * bookings below. Driver rows: availability (read-only, set by the driver),
 * signed shift + the vehicle's maintenance, opaque bookings.
 *
 * Keyboard model (handoff Accessibility): the grid is `role="grid"`; Up/Down
 * move between rows, Left/Right between a row's blocks in time order, Enter
 * opens a block's detail. D / W / T / "/" are handled by the calendar board.
 */
import Link from "next/link";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";

import {
  gridKey,
  placeOnRuler,
  scrollTopFor,
  visibleWindow,
  type GridFocus,
  type TimelineBlock,
  type TimelineRow,
} from "@/lib/calendar-model";
import { FLEET_TEST_IDS } from "@/lib/test-ids";
import {
  localTimeOf,
  nowOn,
  timeRangeIn,
  zoneShort,
  type DayRuler,
} from "@/lib/time";
import { cn } from "@/lib/utils";

export const VIEWPORT_HEIGHT = 560;
export const rowHeightFor = (rowsKind: "vehicles" | "drivers"): number =>
  rowsKind === "drivers" ? 100 : 72;

const LANE_HEIGHT = 26;

export function blockClass(block: TimelineBlock): string {
  if (block.atRisk) {
    return "fleet-block-risk";
  }
  switch (block.kind) {
    case "shift":
      return "fleet-block-shift";
    case "maintenance":
      return "fleet-block-maintenance";
    case "off_road":
      return "fleet-block-offroad";
    case "booked":
    case "on_trip":
      return "fleet-block-booked";
    case "unavailable":
      return "fleet-block-unavailable";
    case "available":
      return "fleet-block-available";
    default:
      return "fleet-block-held";
  }
}

export interface DayTimelineProps {
  readonly rows: readonly TimelineRow[];
  readonly rowsKind: "vehicles" | "drivers";
  readonly ruler: DayRuler;
  readonly zone: string;
  readonly now: number;
  readonly showDocuments: boolean;
}

export const DayTimeline = ({
  rows,
  rowsKind,
  ruler,
  zone,
  now,
  showDocuments,
}: DayTimelineProps) => {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [focus, setFocus] = useState<GridFocus>({ row: 0, block: null });
  const [open, setOpen] = useState<{
    row: TimelineRow;
    block: TimelineBlock;
  } | null>(null);
  const rowHeight = rowHeightFor(rowsKind);
  const placed = useMemo(
    () => rows.map((row) => placeOnRuler(row, ruler)),
    [rows, ruler],
  );
  // Left/Right walk the blocks drawn on the ruler, in time order; blocks
  // outside 06:00–22:00 are in the agenda.
  const navBlocks = useMemo(
    () => placed.map((layout) => layout.placed.map((entry) => entry.block)),
    [placed],
  );
  const view = visibleWindow({
    scrollTop,
    viewportHeight: VIEWPORT_HEIGHT,
    rowHeight,
    total: rows.length,
  });
  const nowPct = nowOn(ruler, now);
  const focusedRow = rows[focus.row];
  const focusedBlock =
    focusedRow === undefined || focus.block === null
      ? undefined
      : navBlocks[focus.row]?.[focus.block];
  const activeId =
    focusedBlock?.id ??
    (focusedRow === undefined ? undefined : `rowhdr-${focusedRow.rowId}`);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const command = gridKey(
      event.key,
      focus,
      navBlocks.map((blocks) => blocks.length),
    );
    if (command.type === "focus") {
      event.preventDefault();
      setFocus(command.focus);
      const next = scrollTopFor(command.focus.row, {
        scrollTop,
        viewportHeight: VIEWPORT_HEIGHT,
        rowHeight,
      });
      if (next !== scrollTop && scroller.current !== null) {
        scroller.current.scrollTop = next;
        setScrollTop(next);
      }
    } else if (command.type === "open") {
      event.preventDefault();
      const row = rows[command.focus.row];
      const block =
        command.focus.block === null
          ? undefined
          : navBlocks[command.focus.row]?.[command.focus.block];
      if (row !== undefined && block !== undefined) {
        setOpen({ row, block });
      }
    }
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-[#222] bg-[#141414]">
        <div className="grid grid-cols-[200px_1fr] border-b border-[#222] text-[11px] text-zinc-500">
          <div className="px-3 py-2">
            {rowsKind === "drivers" ? "Driver" : "Vehicle"} · {rows.length}
          </div>
          <div className="relative h-8" aria-hidden>
            {ruler.ticks.map((tick) => (
              <span
                key={`${tick.label}-${tick.pct}`}
                className="absolute top-2 -translate-x-1/2 font-mono"
                style={{ left: `${tick.pct}%` }}
              >
                {tick.label}
              </span>
            ))}
          </div>
        </div>
        {nowPct !== null ? (
          <div className="grid grid-cols-[200px_1fr]">
            <div />
            <div className="relative h-5">
              <span
                data-testid={FLEET_TEST_IDS.calendar.nowMarker}
                className="absolute top-0 -translate-x-1/2 rounded bg-[#1DB954] px-1.5 font-mono text-[10px] font-semibold text-black"
                style={{ left: `${nowPct}%` }}
              >
                Now {localTimeOf(now, zone)}
              </span>
            </div>
          </div>
        ) : null}
        <div
          ref={scroller}
          className="overflow-y-auto"
          style={{
            height: Math.min(
              VIEWPORT_HEIGHT,
              Math.max(rows.length, 1) * rowHeight,
            ),
          }}
          onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        >
          <div
            role="grid"
            aria-label={`Fleet calendar, ${rowsKind === "drivers" ? "driver" : "vehicle"} rows, ${ruler.date}`}
            aria-rowcount={rows.length}
            aria-activedescendant={activeId}
            tabIndex={0}
            onKeyDown={onKeyDown}
            className="outline-none focus-visible:ring-2 focus-visible:ring-[#1DB954]"
          >
            <div role="presentation" style={{ height: view.padTop }} />
            {rows.slice(view.start, view.end).map((row, offset) => {
              const index = view.start + offset;
              const layout = placed[index];
              return (
                <div
                  key={row.rowId}
                  role="row"
                  aria-rowindex={index + 1}
                  data-testid={
                    row.rowKind === "driver"
                      ? FLEET_TEST_IDS.calendar.driverRow
                      : FLEET_TEST_IDS.calendar.vehicleRow
                  }
                  className={cn(
                    "grid grid-cols-[200px_1fr] border-b border-[#1F1F1F]",
                    row.hasConflict && "bg-[#1a1416]",
                  )}
                  style={{ height: rowHeight }}
                >
                  <div
                    role="rowheader"
                    id={`rowhdr-${row.rowId}`}
                    className={cn(
                      "overflow-hidden px-3 py-1.5 text-xs",
                      focus.row === index &&
                        focus.block === null &&
                        "ring-2 ring-inset ring-[#1DB954]",
                    )}
                  >
                    {row.vehicleId !== null ? (
                      <Link
                        href={`/vehicles/${encodeURIComponent(row.vehicleId)}`}
                        className="font-mono font-semibold text-zinc-100 hover:underline"
                      >
                        {row.label}
                      </Link>
                    ) : (
                      <span className="font-semibold text-zinc-100">
                        {row.label}
                      </span>
                    )}
                    <p className="truncate text-zinc-400">{row.summary}</p>
                    <p className="truncate text-[10.5px] text-zinc-500">
                      {[
                        ...row.flags,
                        ...(showDocuments ? row.documents : []),
                      ].join(" · ")}
                      {layout !== undefined && layout.outside > 0
                        ? `${row.flags.length + (showDocuments ? row.documents.length : 0) > 0 ? " · " : ""}+${layout.outside} outside 06:00–22:00 (see agenda)`
                        : ""}
                    </p>
                  </div>
                  <div className="relative py-1.5">
                    {nowPct !== null ? (
                      <div
                        aria-hidden
                        className="absolute inset-y-0 w-px bg-[#1DB954]/70"
                        style={{ left: `${nowPct}%` }}
                      />
                    ) : null}
                    {Array.from({ length: row.lanes }, (_, lane) => (
                      <div
                        key={lane}
                        role="presentation"
                        className="relative"
                        style={{ height: LANE_HEIGHT, marginBottom: 2 }}
                      >
                        {(layout?.placed ?? [])
                          .filter((entry) => entry.block.lane === lane)
                          .map(({ block, span }) => {
                            const blockIndex = (navBlocks[index] ?? []).indexOf(
                              block,
                            );
                            const focused =
                              focus.row === index && focus.block === blockIndex;
                            return (
                              <div
                                key={block.id}
                                id={block.id}
                                role="gridcell"
                                aria-label={block.accessibleName}
                                aria-selected={focused}
                                title={`${block.label} · ${block.status}`}
                                data-testid={FLEET_TEST_IDS.calendar.block}
                                data-kind={block.kind}
                                tabIndex={-1}
                                onClick={() => {
                                  setFocus({ row: index, block: blockIndex });
                                  setOpen({ row, block });
                                }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    setOpen({ row, block });
                                  }
                                }}
                                className={cn(
                                  "absolute top-0 h-full cursor-pointer overflow-hidden truncate rounded-md px-1.5 text-[10.5px] font-medium leading-[24px]",
                                  blockClass(block),
                                  focused && "ring-2 ring-white",
                                )}
                                style={{
                                  left: `${span.leftPct}%`,
                                  width: `${span.widthPct}%`,
                                }}
                              >
                                {span.clippedStart ? "‹ " : ""}
                                {block.label}
                                {span.clippedEnd ? " ›" : ""}
                              </div>
                            );
                          })}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
            <div role="presentation" style={{ height: view.padBottom }} />
          </div>
        </div>
      </div>
      {open !== null ? (
        <BlockDetail
          row={open.row}
          block={open.block}
          zone={zone}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
};

/** Enter / click on a block: its detail, never more than the fleet may see. */
export const BlockDetail = ({
  row,
  block,
  zone,
  onClose,
}: {
  readonly row: TimelineRow;
  readonly block: TimelineBlock;
  readonly zone: string;
  readonly onClose?: () => void;
}) => (
  <section
    aria-live="polite"
    aria-label="Block detail"
    className="rounded-xl border border-[#262626] bg-[#1A1A1A] p-4 text-sm"
  >
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs uppercase tracking-wide text-zinc-500">
          {row.label} · {block.layer}
        </p>
        <p className="font-semibold text-zinc-100">{block.label}</p>
        <p className="text-zinc-300">{block.status}</p>
        <p className="mt-1 font-mono text-xs text-zinc-400">
          {timeRangeIn(block.startsAt, block.endsAt, zone)}{" "}
          {zoneShort(zone, new Date(block.startsAt).getTime())}
        </p>
      </div>
      {onClose !== undefined ? (
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
        >
          Close
        </button>
      ) : null}
    </div>
    {block.source.type === "booking" ? (
      <p className="mt-2 text-xs text-zinc-400">
        Booking details stay between the rider and the driver. Fleets see the
        time and UBI&apos;s risk flag only.
      </p>
    ) : null}
    {block.source.type === "availability" ? (
      <p className="mt-2 text-xs text-zinc-400">
        Set by the driver. You see the hours only, never a reason, and you
        can&apos;t edit them.
      </p>
    ) : null}
    {block.source.type === "ubi" ? (
      <p className="mt-2 text-xs text-zinc-400">
        A UBI decision: status only. There is no evidence and no override.
      </p>
    ) : null}
    {block.source.type === "maintenance" ||
    block.source.type === "assignment" ? (
      <Link
        href={`/vehicles/${encodeURIComponent(block.source.vehicleId)}${block.source.type === "maintenance" ? "#maintenance" : ""}`}
        className="mt-2 inline-block text-xs text-[#86EFAC] hover:underline"
      >
        Open vehicle →
      </Link>
    ) : null}
  </section>
);
