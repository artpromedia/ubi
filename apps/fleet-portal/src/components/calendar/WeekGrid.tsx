/**
 * B2 — the week: one summary cell per row per local day (booked count,
 * shift summary, maintenance, the server's flags), the month boundary
 * labelled in the column header. Selecting a cell opens that day (for a
 * vehicle row, filtered to that plate).
 */
import { weekGrid, type WeekTone } from "@/lib/calendar-model";
import { FLEET_TEST_IDS } from "@/lib/test-ids";
import { cn } from "@/lib/utils";

import type { FleetCalendar } from "@/lib/fleet-types";

const TONE: Readonly<Record<WeekTone, string>> = {
  normal: "bg-[#1C1C1C] border border-[#2A2A2A] text-zinc-300",
  conflict: "fleet-block-risk",
  maintenance: "fleet-block-maintenance",
  expired: "bg-[#2A1A20] border border-[#7F1D1D] text-red-300",
  held: "fleet-block-held",
  empty: "border border-dashed border-[#2A2A2A] text-zinc-500",
};

export const WeekGrid = ({
  calendar,
  onOpenDay,
}: {
  readonly calendar: FleetCalendar;
  readonly onOpenDay: (date: string, rowLabel: string | null) => void;
}) => {
  const grid = weekGrid(calendar);
  return (
    <div className="overflow-x-auto rounded-xl border border-[#222] bg-[#141414]">
      <table className="w-full min-w-[860px] border-collapse text-xs">
        <caption className="sr-only">
          Week summary by{" "}
          {calendar.rowsKind === "drivers" ? "driver" : "vehicle"}. Select a day
          to open it.
        </caption>
        <thead>
          <tr className="text-left text-zinc-500">
            <th scope="col" className="w-40 px-3 py-2 font-medium">
              {calendar.rowsKind === "drivers" ? "Driver" : "Vehicle"}
            </th>
            {grid.columns.map((column) => (
              <th
                key={column.date}
                scope="col"
                className={cn(
                  "px-2 py-2 font-medium",
                  column.newMonth && "border-l-2 border-[#1DB954]",
                )}
              >
                <span className="block text-zinc-200">{column.day}</span>
                <span
                  className={cn("block", column.newMonth && "text-[#86EFAC]")}
                >
                  {column.month}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grid.rows.map(({ row, cells }) => (
            <tr key={row.rowId} className="border-t border-[#1F1F1F]">
              <th
                scope="row"
                className="px-3 py-2 text-left font-mono font-semibold text-zinc-100"
              >
                {row.label}
              </th>
              {cells.map((cell) => (
                <td key={cell.date} className="p-1">
                  <button
                    type="button"
                    data-testid={FLEET_TEST_IDS.calendar.weekCell}
                    aria-label={cell.accessibleName}
                    onClick={() =>
                      onOpenDay(
                        cell.date,
                        row.rowKind === "vehicle" ? row.label : null,
                      )
                    }
                    className={cn(
                      "flex h-14 w-full flex-col justify-center rounded-md px-2 text-left",
                      TONE[cell.tone],
                    )}
                  >
                    <span className="font-semibold">{cell.primary}</span>
                    {cell.secondary !== "" ? (
                      <span className="truncate text-[10.5px] opacity-80">
                        {cell.secondary}
                      </span>
                    ) : null}
                  </button>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
