/**
 * INTERNAL CONTRACT B — the settlement inputs payment-service reads to
 * journal fleet remittance (packages/contracts/src/fleet.ts,
 * SettlementInputsResponseSchema). fleet-service computes HOURS and hands
 * over the SIGNED terms; it never computes or moves money.
 *
 *  - The week is [weekStart 00:00, weekStart + 7 days 00:00) in the city's
 *    zone; `weekStart` must be a Monday. On a DST week a full shift is 167
 *    or 169 real hours — every instant comes from the zone's rules.
 *  - One item per signed arrangement row whose validity touches the week:
 *    a mid-week terms change is two items, each with the terms signed for
 *    its own part (activeFrom / activeTo), so a later change is never
 *    retroactive.
 *  - shiftHoursInWeek = the signed shift's real intervals ∩ the week ∩ the
 *    arrangement's validity (a night shift that started on Sunday before the
 *    week contributes its Monday morning; one starting on the week's Sunday
 *    is clipped at the week end).
 *  - plannedMaintenanceHoursInWeek = shift ∩ planned blocks that held the
 *    vehicle (scheduled | active | completed); decisions Q2 pro-rates a
 *    weekly_fixed remittance by these.
 *  - unplannedOffRoadHoursInWeek = shift ∩ off-road blocks (active |
 *    completed; an open-ended one runs until now), minus any hour already
 *    counted as planned — an hour is never counted twice. The signed
 *    shortfall rule applies to these.
 *  - Decimal hours, two places, half up.
 */
import { ContractError } from "@ubi/contracts";

import { shiftIntervals } from "./shifts";
import { shiftOf, termsOf, validToOf } from "./views";
import {
  addDays,
  dateColumnToLocalDate,
  hours2dp,
  intersectAll,
  isoWeekday,
  iso,
  localDateToDateColumn,
  mergeIntervals,
  isValidZone,
  startOfLocalDay,
  subtractIntervals,
  totalMs,
  type Interval,
} from "../lib/time";

import type { FleetTx } from "./types";
import type {
  SettlementInputItem,
  SettlementInputsResponse,
} from "../contract";

const PLANNED = ["planned_service", "inspection", "repair"];

export async function settlementInputs(
  db: FleetTx,
  query: { readonly weekStart: string; readonly cityId: string },
  now: Date,
): Promise<SettlementInputsResponse> {
  if (isoWeekday(query.weekStart) !== 1) {
    throw new ContractError(
      "validation_failed",
      "weekStart must be a Monday (the settlement week starts on Monday)",
      {
        weekStart: query.weekStart,
      },
    );
  }
  // The city row, not its active config or flag: signed terms are settled
  // even in a paused city or with fleet tools switched off.
  const city = await db.city.findUnique({ where: { id: query.cityId } });
  if (city === null || !isValidZone(city.timezone)) {
    throw new ContractError("not_found", "unknown city", {
      cityId: query.cityId,
    });
  }
  const zone = city.timezone;
  const weekEnd = addDays(query.weekStart, 6);
  const week: Interval = {
    start: startOfLocalDay(query.weekStart, zone),
    end: startOfLocalDay(addDays(query.weekStart, 7), zone),
  };
  const rows = await db.fleetAssignment.findMany({
    where: {
      fleet: { cityId: query.cityId },
      validFrom: { lte: localDateToDateColumn(addDays(query.weekStart, 7)) },
      OR: [
        { validTo: null },
        {
          validTo: { gte: localDateToDateColumn(addDays(query.weekStart, -1)) },
        },
      ],
    },
    orderBy: [
      { fleetId: "asc" },
      { driverId: "asc" },
      { validFrom: "asc" },
      { id: "asc" },
    ],
  });
  const vehicleIds = [...new Set(rows.map((row) => row.vehicleId))];
  const blocks = await db.fleetMaintenanceBlock.findMany({
    where: {
      vehicleId: { in: vehicleIds },
      status: { in: ["scheduled", "active", "completed"] },
      startsAt: { lt: new Date(week.end) },
    },
  });

  const items: SettlementInputItem[] = [];
  for (const row of rows) {
    const validFrom = dateColumnToLocalDate(row.validFrom);
    const validTo = validToOf(row.validTo);
    if (validTo !== null && validTo <= validFrom) {
      continue; // superseded before it ever started: never in force
    }
    const activeFrom = startOfLocalDay(validFrom, row.zone);
    const activeTo =
      validTo === null ? null : startOfLocalDay(validTo, row.zone);
    const shift = mergeIntervals(
      shiftIntervals(shiftOf(row), row.zone, validFrom, validTo, week),
    );
    const validityTouchesWeek =
      activeFrom < week.end && (activeTo === null || activeTo > week.start);
    if (shift.length === 0 && !validityTouchesWeek) {
      continue;
    }
    const mine = blocks.filter((block) => block.vehicleId === row.vehicleId);
    const planned = mergeIntervals(
      mine
        .filter(
          (block) => PLANNED.includes(block.kind) && block.endsAt !== null,
        )
        .map((block) => ({
          start: block.startsAt.getTime(),
          end: (block.endsAt as Date).getTime(),
        })),
    );
    const offRoad = mergeIntervals(
      mine
        .filter(
          (block) =>
            block.kind === "unplanned_off_road" && block.status !== "scheduled",
        )
        .map((block) => ({
          start: block.startsAt.getTime(),
          end:
            block.endsAt?.getTime() ??
            Math.max(now.getTime(), block.startsAt.getTime()),
        })),
    );
    const terms = termsOf(row);
    items.push({
      assignmentId: row.id,
      fleetId: row.fleetId,
      driverId: row.driverId,
      vehicleId: row.vehicleId,
      termsVersion: row.termsVersion,
      terms: {
        type: terms.type,
        amountMinor: terms.amountMinor,
        currency: terms.currency,
        percent: terms.percent,
        shortfall: {
          policy: "carry_forward",
          maxWeeks: terms.shortfall.maxWeeks,
        },
      },
      shiftHoursInWeek: hours2dp(totalMs(shift)),
      plannedMaintenanceHoursInWeek: hours2dp(
        totalMs(intersectAll(shift, planned)),
      ),
      unplannedOffRoadHoursInWeek: hours2dp(
        totalMs(intersectAll(shift, subtractIntervals(offRoad, planned))),
      ),
      activeFrom: iso(activeFrom),
      activeTo: activeTo === null ? null : iso(activeTo),
    });
  }
  return { weekStart: query.weekStart, weekEnd, zone, items };
}
