"use client";

/**
 * The screen-reader equivalent of the timeline (handoff Accessibility): the
 * same blocks as a sortable table — vehicle (or driver), start, end, layer,
 * label and status — including blocks outside the 06:00–22:00 ruler.
 */
import { useState } from "react";

import {
  agendaEntries,
  sortAgenda,
  type AgendaSortKey,
  type TimelineRow,
} from "@/lib/calendar-model";

const COLUMNS: readonly { key: AgendaSortKey; label: string }[] = [
  { key: "row", label: "Vehicle" },
  { key: "start", label: "Start" },
  { key: "end", label: "End" },
  { key: "layer", label: "Layer" },
  { key: "label", label: "Label" },
  { key: "status", label: "Status" },
];

const ariaSort = (
  active: boolean,
  direction: "asc" | "desc",
): "ascending" | "descending" | "none" => {
  if (!active) {
    return "none";
  }
  return direction === "asc" ? "ascending" : "descending";
};

const sortArrow = (active: boolean, direction: "asc" | "desc"): string => {
  if (!active) {
    return "";
  }
  return direction === "asc" ? " ↑" : " ↓";
};

export const AgendaTable = ({
  rows,
  zone,
  zoneText,
  rowsKind,
}: {
  readonly rows: readonly TimelineRow[];
  readonly zone: string;
  readonly zoneText: string;
  readonly rowsKind: "vehicles" | "drivers";
}) => {
  const [sort, setSort] = useState<{
    key: AgendaSortKey;
    direction: "asc" | "desc";
  }>({
    key: "start",
    direction: "asc",
  });
  const entries = sortAgenda(
    agendaEntries(rows, zone),
    sort.key,
    sort.direction,
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-[#222] bg-[#141414]">
      <table className="w-full min-w-[760px] border-collapse text-xs">
        <caption className="px-3 py-2 text-left text-zinc-400">
          Agenda · times in {zoneText} · {entries.length}{" "}
          {entries.length === 1 ? "entry" : "entries"}
        </caption>
        <thead>
          <tr className="border-b border-[#222] text-left text-zinc-500">
            {COLUMNS.map((column) => {
              const active = sort.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={ariaSort(active, sort.direction)}
                  className="px-3 py-2 font-medium"
                >
                  <button
                    type="button"
                    className="hover:text-zinc-200"
                    onClick={() =>
                      setSort({
                        key: column.key,
                        direction:
                          active && sort.direction === "asc" ? "desc" : "asc",
                      })
                    }
                  >
                    {column.key === "row" && rowsKind === "drivers"
                      ? "Driver"
                      : column.label}
                    {sortArrow(active, sort.direction)}
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-3 py-4 text-zinc-500">
                Nothing on the calendar for this range.
              </td>
            </tr>
          ) : (
            entries.map((entry) => (
              <tr
                key={entry.id}
                className="border-b border-[#1F1F1F] text-zinc-300"
              >
                <td className="px-3 py-1.5 font-mono">{entry.row}</td>
                <td className="px-3 py-1.5 font-mono">{entry.start}</td>
                <td className="px-3 py-1.5 font-mono">{entry.end}</td>
                <td className="px-3 py-1.5">{entry.layer}</td>
                <td className="px-3 py-1.5">{entry.label}</td>
                <td className="px-3 py-1.5">{entry.status}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
};
