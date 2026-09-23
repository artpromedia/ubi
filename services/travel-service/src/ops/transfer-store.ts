/**
 * Airport transfer persistence: the lifecycle, version-guarded writes, the
 * orchestration lease, and the outbox + audit rows every transition writes.
 *
 * Lifecycle (P16):
 *
 *   pending_unassigned ──► requested ──► awarded
 *          │   ▲              │ ▲  │        │
 *          │   └──────────────┘ └──┘        ├──► cancelled
 *          ├──► failed / cancelled          └──► requested (traveller re-request)
 *
 *  - pending_unassigned: the intent exists here only; nothing exists on
 *    ride-service yet (or a refreshed fare waits for the traveller's approval).
 *  - requested: a scheduled request exists on ride-service (or is being
 *    re-made after a retime). No driver is secured.
 *  - awarded: ride-service reported a requester-approved award. The only state
 *    that says transport is secured.
 *  - failed / cancelled: terminal, each with an honest outcome.
 *
 * The contract state-machine file has no machine for this lifecycle yet
 * (contracts/state-machines.json is not owned here), so the transitions are
 * asserted locally and every one writes an outbox event from the existing
 * `reservation.*` catalog plus an audit_log row, in the same transaction as
 * the state change (CLAUDE.md #2).
 */
import { Prisma } from "@prisma/client";

import { ContractError, type EventName } from "@ubi/contracts";

import { cleanJson } from "./json";
import { withOutbox, type OutboxInput } from "./outbox";
import { generateId } from "../lib/ids";

import type { TravelDeps } from "./context";
import type { TransferState } from "./transfer-policy";
import type { Actor, JsonRecord, TravelDb } from "./types";
import type { RidePrincipal } from "../lib/ride-context";

export type TransferRow = NonNullable<
  Awaited<ReturnType<TravelDb["airportTransfer"]["findUnique"]>>
>;

export type TransferUpdate = Prisma.AirportTransferUpdateManyMutationInput;

/** SQL NULL for a nullable Json column. */
export const JSON_NULL = Prisma.DbNull;

export const ACTIVE_STATES: readonly TransferState[] = [
  "pending_unassigned",
  "requested",
  "awarded",
];

const TRANSITIONS: Readonly<Record<TransferState, readonly TransferState[]>> = {
  pending_unassigned: [
    "pending_unassigned",
    "requested",
    "failed",
    "cancelled",
  ],
  requested: [
    "requested",
    "pending_unassigned",
    "awarded",
    "failed",
    "cancelled",
  ],
  awarded: ["awarded", "requested", "cancelled"],
  failed: [],
  cancelled: [],
};

export function isTerminal(state: string): boolean {
  return state === "failed" || state === "cancelled";
}

export function assertTransferTransition(
  from: string,
  to: TransferState,
): void {
  const allowed = TRANSITIONS[from as TransferState] as
    | readonly TransferState[]
    | undefined;
  if (allowed === undefined || !allowed.includes(to)) {
    throw new ContractError(
      "illegal_transition",
      `an airport transfer cannot move from ${from} to ${to}`,
      { from, to },
    );
  }
}

/** The traveller the transfer's ride-service calls are signed as. */
export function principalOf(row: TransferRow): RidePrincipal {
  return { userId: row.userId, cityId: row.cityId };
}

export const SYSTEM_ACTOR: Actor = { id: "travel-service", role: "system" };

// ---------------------------------------------------------------------------
// Lease: one orchestrator at a time
// ---------------------------------------------------------------------------

const LEASE_MS = 60_000;

/**
 * Takes the transfer's orchestration lease (worker pass or traveller action).
 * A lease left by a crashed process lapses after a minute. `null`: someone
 * else holds it.
 */
export async function claimTransfer(
  deps: TravelDeps,
  transferId: string,
): Promise<TransferRow | null> {
  const now = deps.now();
  const claimed = await deps.db.airportTransfer.updateMany({
    where: {
      id: transferId,
      OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }],
    },
    data: { leaseUntil: new Date(now.getTime() + LEASE_MS) },
  });
  if (claimed.count !== 1) {
    return null;
  }
  return deps.db.airportTransfer.findUnique({ where: { id: transferId } });
}

export async function releaseTransfer(
  deps: TravelDeps,
  transferId: string,
): Promise<void> {
  await deps.db.airportTransfer.updateMany({
    where: { id: transferId },
    data: { leaseUntil: null },
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Bookkeeping that depends on nothing it read (attempts, last error, when to
 * look next, ride-service's latest labels). Not version-guarded, no event.
 */
export async function touchTransfer(
  deps: TravelDeps,
  transferId: string,
  data: TransferUpdate,
): Promise<void> {
  await deps.db.airportTransfer.updateMany({
    where: { id: transferId },
    data,
  });
}

/**
 * A write that depends on the row as read (a stored create body, a window, a
 * choice offered): guarded by the version, which it bumps. `null` when the
 * row moved underneath — the caller re-reads and decides again.
 */
export async function guardedUpdate(
  deps: TravelDeps,
  row: TransferRow,
  data: TransferUpdate,
  audit?: {
    readonly actor: Actor;
    readonly action: string;
    readonly reason: string;
  },
): Promise<TransferRow | null> {
  const result = await withOutbox(deps.db, async (tx) => {
    const updated = await tx.airportTransfer.updateMany({
      where: { id: row.id, version: row.version },
      data: { ...data, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      return { result: null };
    }
    const after = await tx.airportTransfer.findUniqueOrThrow({
      where: { id: row.id },
    });
    if (audit !== undefined) {
      await tx.auditLog.create({
        data: auditRow(audit.actor, audit.action, audit.reason, row, after),
      });
    }
    return { result: after };
  });
  return result;
}

export interface TransitionInput {
  readonly row: TransferRow;
  readonly to: TransferState;
  readonly data?: TransferUpdate;
  readonly actor: Actor;
  readonly action: string;
  readonly reason: string;
  readonly event: EventName;
  readonly payload?: JsonRecord;
  readonly correlationId?: string | null;
  readonly occurredAt: Date;
}

/**
 * Moves a transfer to `to`: asserts the lifecycle, bumps the version under a
 * guard on the version read, and writes the audit row and the outbox event in
 * the same transaction. `null` when the row moved underneath (nothing written).
 */
export async function transitionTransfer(
  deps: TravelDeps,
  input: TransitionInput,
): Promise<TransferRow | null> {
  assertTransferTransition(input.row.state, input.to);
  const result = await withOutbox(deps.db, async (tx) => {
    const updated = await tx.airportTransfer.updateMany({
      where: { id: input.row.id, version: input.row.version },
      data: {
        ...input.data,
        state: input.to,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      return { result: null };
    }
    const after = await tx.airportTransfer.findUniqueOrThrow({
      where: { id: input.row.id },
    });
    await tx.auditLog.create({
      data: auditRow(input.actor, input.action, input.reason, input.row, after),
    });
    return {
      result: after,
      events: [
        transferEvent(input.event, after, input.row.version, input.actor, {
          occurredAt: input.occurredAt,
          correlationId: input.correlationId ?? null,
          payload: input.payload,
        }),
      ],
    };
  });
  return result;
}

export function actorTypeOf(actor: Actor): string {
  if (actor.role === "system") {
    return "system";
  }
  if (actor.role === "rider" || actor.role === "driver") {
    return actor.role;
  }
  return "agent";
}

/**
 * One `reservation.*` (or related) outbox row. Ids, codes, instants and
 * integer amounts only — never a place or a name (CLAUDE.md #12).
 */
export function transferEvent(
  name: EventName,
  after: TransferRow,
  fromVersion: number | null,
  actor: Actor,
  options: {
    readonly occurredAt: Date;
    readonly correlationId: string | null;
    readonly payload?: JsonRecord;
  },
): OutboxInput {
  return {
    name,
    aggregateType: "reservation",
    aggregateId: after.id,
    fromVersion,
    toVersion: after.version,
    actor,
    actorType: actorTypeOf(actor),
    cityId: after.cityId,
    idempotencyKey: `${name}:${after.id}:v${after.version}`,
    correlationId: options.correlationId,
    occurredAt: options.occurredAt,
    payload: {
      transferId: after.id,
      linkedOrderId: after.orderId,
      direction: after.direction,
      state: after.state,
      driverSecured: after.state === "awarded",
      generation: after.generation,
      scheduledRequestId: after.scheduledRequestId,
      rideRequestId: after.rideRequestId,
      pickupAt: after.pickupAt?.toISOString() ?? null,
      windowEnd: after.windowEnd?.toISOString() ?? null,
      approvedMaxFareMinor: Number(after.maxFareMinor),
      currency: after.currency,
      ...options.payload,
    },
  };
}

function snapshotOf(row: TransferRow): JsonRecord {
  return {
    state: row.state,
    version: row.version,
    generation: row.generation,
    scheduledRequestId: row.scheduledRequestId,
    rideRequestId: row.rideRequestId,
    pickupAt: row.pickupAt?.toISOString() ?? null,
    windowEnd: row.windowEnd?.toISOString() ?? null,
    arriveBy: row.arriveBy?.toISOString() ?? null,
    maxFareMinor: Number(row.maxFareMinor),
    retimedCount: row.retimedCount,
    flightStatus: row.flightStatus,
    actionRequired:
      typeof row.actionRequired === "object" && row.actionRequired !== null
        ? ((row.actionRequired as JsonRecord).reason ?? null)
        : null,
  };
}

function auditRow(
  actor: Actor,
  action: string,
  reason: string,
  before: TransferRow,
  after: TransferRow,
) {
  return {
    id: generateId("aud"),
    actorId: actor.id,
    actorRole: actor.role,
    action,
    subjectType: "airport_transfer",
    subjectId: after.id,
    before: cleanJson(snapshotOf(before)),
    after: cleanJson(snapshotOf(after)),
    reason,
  };
}
