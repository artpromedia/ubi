/**
 * Vehicle document expiry (FL-9; decisions Q6; conflict matrix row 3).
 *
 * UBI holds the expiries (vehicles.insurance_expiry / inspection_expiry) and
 * enforces them; a fleet is WARNED — at 30 / 14 / 7 / 1 days (the market's
 * `documentWarningDays`) and immediately whenever one of its vehicle's
 * bookings runs past an expiry — and sees the effect (doc_expired, status
 * only). Each warning is an outbox event keyed by vehicle, document, expiry
 * and threshold, so a sweep that runs every minute still sends each warning
 * once; each also opens (or keeps) one conflict. A renewed document (a new
 * expiry) resolves the old conflicts.
 */

import {
  FLEET_POLICY_DEFAULTS,
  type FleetPolicy,
  type OccupiedBlock,
} from "../contract";
import { openConflict, resolveConflicts } from "./conflicts";
import { outboxKey, withOutbox, type OutboxInput } from "./outbox";
import { arrangementsOn } from "./vehicles";
import { workerLogger } from "../lib/logger";
import { DAY_MS, iso, localDateOf } from "../lib/time";

import type { FleetDeps } from "./context";
import type { Actor } from "./types";

const SYSTEM: Actor = { id: "fleet-service", role: "system" };

const KINDS = [
  ["insurance", "insuranceExpiry"],
  ["inspection", "inspectionExpiry"],
] as const;

/** The smallest warning threshold (days) an expiry has crossed, or null. */
export function crossedThreshold(
  expiry: Date,
  now: Date,
  policy: FleetPolicy,
): number | null {
  const remainingMs = expiry.getTime() - now.getTime();
  if (remainingMs <= 0) {
    return null;
  }
  const crossed = [...policy.documentWarningDays]
    .sort((a, b) => a - b)
    .filter((days) => remainingMs <= days * DAY_MS);
  return crossed[0] ?? null;
}

export async function documentSweep(deps: FleetDeps): Promise<number> {
  const now = deps.now();
  const vehicles = await deps.db.fleetVehicle.findMany({
    where: { status: "active" },
    include: {
      vehicle: true,
      fleet: { select: { id: true, cityId: true, zone: true } },
    },
  });
  const policies = new Map<string, FleetPolicy>();
  let sent = 0;
  for (const row of vehicles) {
    let policy = policies.get(row.fleet.cityId);
    if (policy === undefined) {
      try {
        policy = (await deps.config.load(row.fleet.cityId)).policy;
      } catch {
        policy = FLEET_POLICY_DEFAULTS;
      }
      policies.set(row.fleet.cityId, policy);
    }
    const horizonEnd =
      now.getTime() + policy.availabilityCheckHorizonDays * DAY_MS;
    let bookings: OccupiedBlock[] | null = null;
    for (const [kind, field] of KINDS) {
      const expiry = row.vehicle[field];
      if (expiry === null) {
        continue;
      }
      const expiryIso = iso(expiry.getTime());
      const events: OutboxInput[] = [];
      const threshold = crossedThreshold(expiry, now, policy);
      const expired = expiry.getTime() <= now.getTime();
      // Bookings on this vehicle that run past the expiry: warn immediately.
      let pastExpiry: OccupiedBlock[] = [];
      if (expiry.getTime() < horizonEnd) {
        if (bookings === null) {
          try {
            const today = localDateOf(now.getTime(), row.fleet.zone);
            const drivers = (
              await arrangementsOn(
                deps.db,
                { vehicleIds: [row.vehicleId] },
                today,
              )
            ).map((a) => a.driverId);
            bookings = (
              await deps.rides.occupiedBlocks({
                vehicleIds: [row.vehicleId],
                driverIds: drivers,
                from: iso(now.getTime()),
                to: iso(horizonEnd),
              })
            ).filter(
              (block) =>
                block.vehicleId === null || block.vehicleId === row.vehicleId,
            );
          } catch (error) {
            workerLogger.warn(
              { err: error, vehicleId: row.vehicleId },
              "document sweep: bookings unavailable",
            );
            bookings = [];
          }
        }
        pastExpiry = bookings.filter(
          (block) => new Date(block.endsAt).getTime() > expiry.getTime(),
        );
      }
      if (threshold === null && !expired && pastExpiry.length === 0) {
        // Nothing to warn about; only a renewal can still need settling.
        const open = await deps.db.fleetConflict.findMany({
          where: {
            vehicleId: row.vehicleId,
            type: { in: ["document_expiring", "document_expires_in_booking"] },
            status: { in: ["open", "resolving"] },
          },
          select: { detail: true },
        });
        const renewedAny = open.some((conflict) => {
          const detail = (conflict.detail ?? {}) as {
            kind?: string;
            expiresAt?: string;
          };
          return detail.kind === kind && detail.expiresAt !== expiryIso;
        });
        if (!renewedAny) {
          continue;
        }
      }
      await withOutbox(deps.db, async (tx) => {
        const exists = async (key: string) =>
          (await tx.outboxEvent.findUnique({
            where: { idempotencyKey: outboxKey(key) },
          })) !== null;
        // A renewal (new expiry) settles the conflicts opened for the old one.
        const stale = await tx.fleetConflict.findMany({
          where: {
            vehicleId: row.vehicleId,
            type: { in: ["document_expiring", "document_expires_in_booking"] },
            status: { in: ["open", "resolving"] },
          },
        });
        const renewed = stale.filter((conflict) => {
          const detail = (conflict.detail ?? {}) as {
            kind?: string;
            expiresAt?: string;
          };
          return detail.kind === kind && detail.expiresAt !== expiryIso;
        });
        if (renewed.length > 0) {
          events.push(
            ...(await resolveConflicts(
              tx,
              { ids: renewed.map((c) => c.id) },
              "document_renewed",
              SYSTEM,
              row.fleet.cityId,
              now,
            )),
          );
        }
        const base = {
          vehicleId: row.vehicleId,
          fleetId: row.fleetId,
          document: kind,
          expiresAt: expiryIso,
        };
        if (threshold !== null) {
          const key = `vehicle.document.expiring:${row.vehicleId}:${kind}:${expiryIso}:${threshold}d`;
          if (!(await exists(key))) {
            events.push({
              name: "vehicle.document.expiring",
              aggregateType: "vehicle",
              aggregateId: row.vehicleId,
              fromVersion: null,
              toVersion: row.version,
              idempotencyKey: key,
              actor: SYSTEM,
              cityId: row.fleet.cityId,
              occurredAt: now,
              payload: {
                ...base,
                thresholdDays: threshold,
                reason: "threshold",
              },
            });
            const opened = await openConflict(
              tx,
              {
                type: "document_expiring",
                severity: threshold <= 7 ? "high" : "medium",
                fleetId: row.fleetId,
                vehicleId: row.vehicleId,
                resolverRoles: ["fleet", "ubi"],
                deadlineAt: expiry,
                dedupeKey: `doc:${row.vehicleId}:${kind}:${expiryIso}`,
                detail: { kind, expiresAt: expiryIso },
              },
              SYSTEM,
              row.fleet.cityId,
              now,
            );
            events.push(...opened.events);
          }
        }
        if (expired) {
          const key = `vehicle.document.expired:${row.vehicleId}:${kind}:${expiryIso}`;
          if (!(await exists(key))) {
            events.push({
              name: "vehicle.document.expired",
              aggregateType: "vehicle",
              aggregateId: row.vehicleId,
              fromVersion: null,
              toVersion: row.version,
              idempotencyKey: key,
              actor: SYSTEM,
              cityId: row.fleet.cityId,
              occurredAt: now,
              // UBI enforces: the vehicle is doc_expired (status only).
              payload: { ...base, effect: "doc_expired" },
            });
          }
        }
        for (const block of pastExpiry) {
          const key = `vehicle.document.expiring:${row.vehicleId}:${kind}:${expiryIso}:booking:${block.blockId}`;
          if (await exists(key)) {
            continue;
          }
          events.push({
            name: "vehicle.document.expiring",
            aggregateType: "vehicle",
            aggregateId: row.vehicleId,
            fromVersion: null,
            toVersion: row.version,
            idempotencyKey: key,
            actor: SYSTEM,
            cityId: row.fleet.cityId,
            occurredAt: now,
            payload: {
              ...base,
              reason: "booking_after_expiry",
              bookingBlockId: block.blockId,
            },
          });
          const deadline =
            block.decisionDeadline !== null &&
            new Date(block.decisionDeadline) < expiry
              ? new Date(block.decisionDeadline)
              : expiry;
          const opened = await openConflict(
            tx,
            {
              type: "document_expires_in_booking",
              severity: "high",
              fleetId: row.fleetId,
              vehicleId: row.vehicleId,
              driverId: block.driverId,
              bookingBlockId: block.blockId,
              resolverRoles: ["fleet", "driver", "ubi"],
              deadlineAt: deadline,
              dedupeKey: `docbk:${row.vehicleId}:${kind}:${expiryIso}:${block.blockId}`,
              detail: {
                kind,
                expiresAt: expiryIso,
                blockStartsAt: block.startsAt,
                blockEndsAt: block.endsAt,
              },
            },
            SYSTEM,
            row.fleet.cityId,
            now,
          );
          events.push(...opened.events);
        }
        sent += events.length;
        return { result: null, events };
      });
    }
  }
  return sent;
}

/** Conflicts whose decision deadline passed unresolved: → lapsed. */
export async function lapseConflicts(deps: FleetDeps): Promise<number> {
  const now = deps.now();
  const due = await deps.db.fleetConflict.findMany({
    where: { status: { in: ["open", "resolving"] }, deadlineAt: { lte: now } },
    take: 500,
  });
  let lapsed = 0;
  for (const conflict of due) {
    await withOutbox(deps.db, async (tx) => {
      const moved = await tx.fleetConflict.updateMany({
        where: { id: conflict.id, version: conflict.version },
        data: { status: "lapsed", version: { increment: 1 } },
      });
      if (moved.count === 0) {
        return { result: null };
      }
      lapsed += 1;
      const fleet =
        conflict.fleetId === null
          ? null
          : await tx.fleet.findUnique({
              where: { id: conflict.fleetId },
              select: { cityId: true },
            });
      return {
        result: null,
        audits: [
          {
            actor: SYSTEM,
            action: "fleet.conflict.lapsed",
            subjectType: "fleet_conflict",
            subjectId: conflict.id,
            before: conflict.status,
            after: "lapsed",
            reason: "decision_deadline_passed",
          },
        ],
        events: [
          {
            name: "fleet.conflict.lapsed",
            aggregateType: "fleet_conflict",
            aggregateId: conflict.id,
            fromVersion: conflict.version,
            toVersion: conflict.version + 1,
            actor: SYSTEM,
            cityId: fleet?.cityId ?? null,
            occurredAt: now,
            payload: {
              conflictId: conflict.id,
              type: conflict.type,
              deadlineAt: iso((conflict.deadlineAt ?? now).getTime()),
            },
          },
        ],
      };
    });
  }
  return lapsed;
}
