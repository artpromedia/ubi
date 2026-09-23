/**
 * Driver-authored availability and time off (FL-5; handoff C4).
 *
 * Only the driver writes it. Time off outranks a fleet shift (decisions A3):
 * the shift simply loses those hours, and its effect on remittance follows
 * the signed terms' shortfall rule in settlement. Time off that overlaps the
 * driver's OWN advance booking is the driver's conflict — the save is
 * refused (409 `unresolved_booking_overlap`) until the driver has chosen,
 * booking by booking, either to trim the time off or to withdraw from the
 * booking, with the server's explained outcome in front of them (the preview).
 * Nothing is ever withdrawn on the driver's behalf: a chosen withdrawal is
 * recorded as a driver-owned conflict and the driver confirms it on the
 * marketplace's own withdraw route, which returns the captured commission
 * with a linked reversal and releases the rider's funding.
 *
 * A fleet sees none of this except an unexplained "unavailable" block and,
 * for a booking the driver is resolving, `driver_resolving`.
 *
 * `rrule` is a deliberate subset of RFC 5545: FREQ=DAILY|WEEKLY, optional
 * BYDAY, and COUNT or UNTIL (a local date), expanded on the local wall clock
 * (DST keeps the local times) up to the check horizon.
 */
import { createHash } from "node:crypto";

import { ContractError } from "@ubi/contracts";

import { requireFleetEnabled } from "./config";
import { openConflict } from "./conflicts";
import { FleetError } from "./errors";
import { withOutbox, type OutboxInput, type OutboxTx } from "./outbox";
import { shiftIntervals } from "./shifts";
import { shiftOf, validToOf } from "./views";
import { canonicalJson, generateId } from "../lib/ids";
import {
  DAY_MS,
  addDays,
  compareDates,
  dateColumnToLocalDate,
  hours2dp,
  intersectAll,
  isoWeekday,
  iso,
  localDateOf,
  localTimeOf,
  localToInstant,
  type Interval,
} from "../lib/time";
import { isLiveBooking, type DriverBooking } from "../ports/ride-port";

import type { FleetDeps } from "./context";
import type { Actor } from "./types";
import type { AvailabilityKind } from "../contract";

export interface WindowInput {
  readonly kind: AvailabilityKind;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly rrule?: string | undefined;
}

const WEEKDAYS: Readonly<Record<string, number>> = {
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
  SU: 7,
};

interface ParsedRule {
  readonly freq: "DAILY" | "WEEKLY";
  readonly byDay: readonly number[] | null;
  readonly count: number | null;
  readonly until: string | null;
}

export function parseRrule(rule: string): ParsedRule {
  const invalid = (reason: string): ContractError =>
    new ContractError(
      "validation_failed",
      `rrule is not supported: ${reason}`,
      { rrule: rule },
    );
  const parts = new Map<string, string>();
  for (const piece of rule.replace(/^RRULE:/i, "").split(";")) {
    const [key, value] = piece.split("=");
    if (key === undefined || value === undefined || key.length === 0) {
      throw invalid("malformed");
    }
    parts.set(key.toUpperCase(), value.toUpperCase());
  }
  for (const key of parts.keys()) {
    if (!["FREQ", "BYDAY", "COUNT", "UNTIL"].includes(key)) {
      throw invalid(`${key} is not supported`);
    }
  }
  const freq = parts.get("FREQ");
  if (freq !== "DAILY" && freq !== "WEEKLY") {
    throw invalid("FREQ must be DAILY or WEEKLY");
  }
  const byDayRaw = parts.get("BYDAY");
  const byDay =
    byDayRaw === undefined
      ? null
      : byDayRaw.split(",").map((day) => {
          const value = WEEKDAYS[day];
          if (value === undefined) {
            throw invalid(`BYDAY ${day}`);
          }
          return value;
        });
  const countRaw = parts.get("COUNT");
  const count = countRaw === undefined ? null : Number.parseInt(countRaw, 10);
  if (
    count !== null &&
    (!Number.isInteger(count) || count < 1 || count > 366)
  ) {
    throw invalid("COUNT must be 1..366");
  }
  const untilRaw = parts.get("UNTIL");
  let until: string | null = null;
  if (untilRaw !== undefined) {
    const match = /^(\d{4})(\d{2})(\d{2})/.exec(untilRaw);
    if (match === null) {
      throw invalid("UNTIL must be YYYYMMDD");
    }
    until = `${match[1]}-${match[2]}-${match[3]}`;
  }
  if (count !== null && until !== null) {
    throw invalid("COUNT and UNTIL are exclusive");
  }
  return { freq, byDay, count, until };
}

/** Every occurrence of a window inside [.., horizonEnd). */
export function expandWindow(
  window: WindowInput,
  zone: string,
  horizonEnd: number,
): Interval[] {
  const start = new Date(window.startsAt).getTime();
  const end = new Date(window.endsAt).getTime();
  if (window.rrule === undefined) {
    return [{ start, end }];
  }
  const rule = parseRrule(window.rrule);
  const baseDate = localDateOf(start, zone);
  const startTime = localTimeOf(start, zone);
  const endTime = localTimeOf(end, zone);
  const spanDays = Math.round(
    (new Date(`${localDateOf(end, zone)}T00:00:00Z`).getTime() -
      new Date(`${baseDate}T00:00:00Z`).getTime()) /
      DAY_MS,
  );
  const baseWeekday = isoWeekday(baseDate);
  const out: Interval[] = [];
  let date = baseDate;
  let produced = 0;
  for (let step = 0; step < 400; step += 1) {
    if (rule.until !== null && compareDates(date, rule.until) > 0) {
      break;
    }
    if (rule.count !== null && produced >= rule.count) {
      break;
    }
    const weekday = isoWeekday(date);
    const matches =
      rule.freq === "DAILY"
        ? rule.byDay === null || rule.byDay.includes(weekday)
        : (rule.byDay ?? [baseWeekday]).includes(weekday);
    if (matches) {
      const occurrenceStart = localToInstant(date, startTime, zone);
      if (occurrenceStart >= horizonEnd) {
        break;
      }
      const occurrenceEnd = localToInstant(
        addDays(date, spanDays),
        endTime,
        zone,
      );
      if (occurrenceEnd > occurrenceStart) {
        out.push({ start: occurrenceStart, end: occurrenceEnd });
      }
      produced += 1;
    }
    date = addDays(date, 1);
  }
  return out;
}

function validateWindows(
  windows: readonly WindowInput[],
  zone: string,
  horizonEnd: number,
): void {
  for (const window of windows) {
    const start = new Date(window.startsAt).getTime();
    const end = new Date(window.endsAt).getTime();
    if (!(end > start)) {
      throw new ContractError(
        "validation_failed",
        "every window must end after it starts",
      );
    }
    if (window.rrule !== undefined) {
      if (end - start > DAY_MS) {
        throw new ContractError(
          "validation_failed",
          "a repeating window lasts at most one day per occurrence",
        );
      }
      expandWindow(window, zone, horizonEnd);
    }
  }
}

interface Affects {
  readonly shifts: { assignmentId: string; lostHours: number }[];
  readonly bookings: {
    booking: DriverBooking;
    startsAt: string;
    endsAt: string;
  }[];
}

async function computeAffects(
  deps: FleetDeps,
  actor: Actor,
  windows: readonly WindowInput[],
  zone: string,
  now: Date,
  horizonEnd: number,
): Promise<Affects> {
  const timeOff = windows
    .filter((window) => window.kind === "time_off")
    .flatMap((window) => expandWindow(window, zone, horizonEnd))
    .map((interval) => ({
      start: Math.max(interval.start, now.getTime()),
      end: Math.min(interval.end, horizonEnd),
    }))
    .filter((interval) => interval.end > interval.start);
  if (timeOff.length === 0) {
    return { shifts: [], bookings: [] };
  }
  const horizon = { start: now.getTime(), end: horizonEnd };
  const arrangements = await deps.db.fleetAssignment.findMany({
    where: { driverId: actor.id, status: { in: ["active", "notice"] } },
  });
  const shifts = arrangements.flatMap((row) => {
    const instances = shiftIntervals(
      shiftOf(row),
      row.zone,
      dateColumnToLocalDate(row.validFrom),
      validToOf(row.validTo),
      horizon,
    );
    const lost = intersectAll(instances, timeOff);
    const ms = lost.reduce((sum, piece) => sum + (piece.end - piece.start), 0);
    return ms > 0 ? [{ assignmentId: row.id, lostHours: hours2dp(ms) }] : [];
  });
  const bookings = (
    await deps.rides.driverCalendar(
      actor.id,
      iso(now.getTime()),
      iso(horizonEnd),
    )
  )
    .filter((booking) => isLiveBooking(booking))
    .filter((booking) => {
      const window = {
        start: new Date(booking.schedule.windowStart).getTime(),
        end: new Date(booking.schedule.windowEnd).getTime(),
      };
      return timeOff.some(
        (off) => off.start < window.end && window.start < off.end,
      );
    })
    .map((booking) => ({
      booking,
      startsAt: booking.schedule.windowStart,
      endsAt: booking.schedule.windowEnd,
    }));
  return { shifts, bookings };
}

function previewTokenOf(
  driverId: string,
  windows: readonly WindowInput[],
  bookingIds: readonly string[],
): string {
  const digest = createHash("sha256")
    .update(
      canonicalJson({ driverId, windows, bookingIds: [...bookingIds].sort() }),
    )
    .digest("hex");
  return `apv_${digest.slice(0, 40)}`;
}

function withdrawOutcome(booking: DriverBooking) {
  return {
    commissionReturned: booking.commissionMinor ?? null,
    fundingReleased: true as const,
    rematch: "decided_by_marketplace" as const,
    penalty: "none" as const,
  };
}

export async function previewAvailability(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  windows: readonly WindowInput[],
) {
  const config = await requireFleetEnabled(deps.config, cityId);
  const zone = config.city.timezone;
  const now = deps.now();
  const horizonEnd =
    now.getTime() + config.policy.availabilityCheckHorizonDays * DAY_MS;
  validateWindows(windows, zone, horizonEnd);
  const affects = await computeAffects(
    deps,
    actor,
    windows,
    zone,
    now,
    horizonEnd,
  );
  return {
    previewToken: previewTokenOf(
      actor.id,
      windows,
      affects.bookings.map((entry) => entry.booking.bookingId),
    ),
    zone,
    checkedAt: iso(now.getTime()),
    horizonEndsAt: iso(horizonEnd),
    affects: [
      ...affects.shifts.map((shift) => ({
        kind: "shift" as const,
        assignmentId: shift.assignmentId,
        effect: "hours_reduced" as const,
        lostHours: shift.lostHours,
      })),
      ...affects.bookings.map((entry) => ({
        kind: "booking" as const,
        bookingId: entry.booking.bookingId,
        effect: "conflicts" as const,
        startsAt: entry.startsAt,
        endsAt: entry.endsAt,
        outcome: withdrawOutcome(entry.booking),
        options: ["trim_time_off" as const, "withdraw_booking" as const],
      })),
    ],
  };
}

export async function putAvailability(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  input: {
    readonly windows: readonly WindowInput[];
    readonly withdrawals: readonly string[];
    readonly previewToken: string;
  },
) {
  const config = await requireFleetEnabled(deps.config, cityId);
  const zone = config.city.timezone;
  const now = deps.now();
  const horizonEnd =
    now.getTime() + config.policy.availabilityCheckHorizonDays * DAY_MS;
  validateWindows(input.windows, zone, horizonEnd);
  // Recomputed, never trusted from the client: what the save would do now.
  const affects = await computeAffects(
    deps,
    actor,
    input.windows,
    zone,
    now,
    horizonEnd,
  );
  const conflicting = affects.bookings.map((entry) => entry.booking.bookingId);
  if (
    previewTokenOf(actor.id, input.windows, conflicting) !== input.previewToken
  ) {
    throw new ContractError(
      "conflict",
      "Your bookings or windows changed since the preview. Check the impact again before saving.",
      { reason: "preview_stale" },
    );
  }
  const chosen = new Set(input.withdrawals);
  const unknown = [...chosen].filter((id) => !conflicting.includes(id));
  if (unknown.length > 0) {
    throw new ContractError(
      "validation_failed",
      "a withdrawal names a booking your time off does not overlap",
      {
        bookingIds: unknown,
      },
    );
  }
  const unresolved = conflicting.filter((id) => !chosen.has(id));
  if (unresolved.length > 0) {
    throw new FleetError(
      "unresolved_booking_overlap",
      "Your time off overlaps a booking. Trim the time off to keep it, or choose to withdraw from it.",
      { bookingIds: unresolved },
    );
  }
  const status = chosen.size > 0 ? "saved_with_withdrawals" : "saved";
  const previous = await deps.db.driverAvailability.aggregate({
    where: { driverId: actor.id },
    _max: { setVersion: true },
  });
  const setVersion = (previous._max.setVersion ?? 0) + 1;
  const result = await withOutbox(deps.db, async (tx) => {
    await tx.driverAvailability.updateMany({
      where: { driverId: actor.id, status: { not: "removed" } },
      data: { status: "removed", removedAt: now },
    });
    const saved = [];
    for (const window of input.windows) {
      const row = await tx.driverAvailability.create({
        data: {
          id: generateId("dav"),
          driverId: actor.id,
          kind: window.kind,
          startsAt: new Date(window.startsAt),
          endsAt: new Date(window.endsAt),
          rrule: window.rrule ?? null,
          zone,
          status,
          setVersion,
        },
      });
      saved.push(row);
    }
    const events: OutboxInput[] = [
      {
        name: "driver.availability.saved",
        aggregateType: "driver",
        aggregateId: actor.id,
        fromVersion: setVersion === 1 ? null : setVersion - 1,
        toVersion: setVersion,
        actor,
        cityId,
        occurredAt: now,
        // The driver's own data: counts only, and no labels a fleet could read.
        payload: {
          driverId: actor.id,
          setVersion,
          status,
          windows: saved.length,
          withdrawalsChosen: chosen.size,
        },
      },
    ];
    const withdrawals = [];
    for (const entry of affects.bookings.filter((candidate) =>
      chosen.has(candidate.booking.bookingId),
    )) {
      const opened = await openConflict(
        tx,
        {
          type: "time_off_overlaps_booking",
          severity: "medium",
          fleetId: await fleetOfDriverAt(tx, actor.id, entry.startsAt),
          driverId: actor.id,
          bookingBlockId: null,
          resolverRoles: ["driver", "rider"],
          deadlineAt: null,
          // The driver has chosen; the marketplace withdrawal completes it.
          status: "resolving",
          dedupeKey: `timeoff:${actor.id}:${entry.booking.bookingId}:v${setVersion}`,
          detail: {
            bookingId: entry.booking.bookingId,
            bookingStartsAt: entry.startsAt,
            bookingEndsAt: entry.endsAt,
          },
        },
        actor,
        cityId,
        now,
      );
      events.push(...opened.events);
      withdrawals.push({
        bookingId: entry.booking.bookingId,
        conflictId: opened.conflict.id,
        outcome: withdrawOutcome(entry.booking),
        next: {
          method: "POST" as const,
          path: `/v1/mp/advance-bookings/${entry.booking.bookingId}/withdraw`,
        },
      });
    }
    return {
      result: {
        status,
        setVersion,
        windows: saved.map((row) => ({
          windowId: row.id,
          kind: row.kind as AvailabilityKind,
          startsAt: iso(row.startsAt.getTime()),
          endsAt: iso(row.endsAt.getTime()),
          rrule: row.rrule,
        })),
        withdrawals,
      },
      events,
      audits: [
        {
          actor,
          action: "driver.availability.saved",
          subjectType: "driver_availability",
          subjectId: actor.id,
          after: {
            setVersion,
            status,
            windows: saved.length,
            withdrawalsChosen: [...chosen],
          },
        },
      ],
    };
  });
  return result;
}

/** The fleet whose signed arrangement covers the driver on that date, if any. */
async function fleetOfDriverAt(
  tx: OutboxTx,
  driverId: string,
  at: string,
): Promise<string | null> {
  const date = at.slice(0, 10);
  const row = await tx.fleetAssignment.findFirst({
    where: {
      driverId,
      validFrom: { lte: new Date(`${date}T00:00:00.000Z`) },
      OR: [
        { validTo: null },
        { validTo: { gt: new Date(`${date}T00:00:00.000Z`) } },
      ],
    },
    orderBy: { signedAt: "desc" },
  });
  return row?.fleetId ?? null;
}

/** Saved windows as occurrences within `window` (for schedules and calendars). */
export async function availabilityOccurrences(
  deps: FleetDeps,
  driverIds: readonly string[],
  window: Interval,
) {
  if (driverIds.length === 0) {
    return [];
  }
  const rows = await deps.db.driverAvailability.findMany({
    where: { driverId: { in: [...driverIds] }, status: { not: "removed" } },
  });
  return rows.flatMap((row) => {
    const occurrences = expandWindow(
      {
        kind: row.kind as AvailabilityKind,
        startsAt: iso(row.startsAt.getTime()),
        endsAt: iso(row.endsAt.getTime()),
        ...(row.rrule === null ? {} : { rrule: row.rrule }),
      },
      row.zone,
      window.end,
    );
    return occurrences
      .map((occurrence) => ({
        start: Math.max(occurrence.start, window.start),
        end: Math.min(occurrence.end, window.end),
      }))
      .filter((occurrence) => occurrence.end > occurrence.start)
      .map((occurrence) => ({
        driverId: row.driverId,
        kind: row.kind as AvailabilityKind,
        windowId: row.id,
        ...occurrence,
      }));
  });
}
