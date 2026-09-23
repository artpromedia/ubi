/**
 * Assignment proposals, PIN-signed arrangements and their history (FL-3).
 *
 * CONSENT. A fleet PROPOSES (vehicle, shift, terms); only the driver's PIN —
 * verified by user-service's real wallet-PIN check through the relayed
 * driver context (ports/pin-port.ts) — turns a proposal into a signed
 * arrangement. A proposal never counts as availability. Declining takes no
 * reason and carries no penalty; the fleet sees `declined` and nothing else.
 *
 * ROLES (decisions correction 5). New remittance terms are owner-only. A
 * manager may propose shift and vehicle changes only under the driver's
 * CURRENTLY SIGNED terms version with this fleet — the terms are copied from
 * that signed row, never from the request.
 *
 * OVERLAP. Signed shifts on one vehicle, and of one driver, never overlap.
 * The propose check and the sign check use the same local-day segments as
 * the EXCLUDE constraints on fleet_assignment_shift_segments, so the answer
 * a fleet sees (422 `shift_overlap`, naming the signed shift) is exactly what
 * the database would refuse; a race between two signatures is settled by the
 * constraint. A driver's own overlapping arrangement IN THE SAME FLEET is the
 * one a signature supersedes (a material change); another fleet's is never
 * displaced.
 *
 * CITY CAP. A weekly_fixed remittance above the city's `remittanceCapMinor`
 * is refused (422 `above_city_cap`). The currency is always the city's.
 *
 * HISTORY. One immutable row per signed terms version: a supersession or a
 * notice only moves the validity end (and the segments with it), so contract
 * B always reads the terms signed for each week.
 */
import { createHash } from "node:crypto";

import { ContractError } from "@ubi/contracts";

import { requireFleetEnabled } from "./config";
import { openConflict } from "./conflicts";
import {
  FleetError,
  illegalTransition,
  notFound,
  exclusionConstraintOf,
} from "./errors";
import { withOutbox, type OutboxInput, type OutboxTx } from "./outbox";
import { assertCapability, type FleetAccess } from "./roles";
import { resolveShift, shiftIntervals, shiftSegments } from "./shifts";
import { fleetVehicleOf } from "./vehicles";
import {
  arrangementView,
  displayNames,
  nameOr,
  proposalView,
  shiftOf,
  termsOf,
  validToOf,
} from "./views";
import { deterministicId, isUuid } from "../lib/ids";
import {
  addDays,
  compareDates,
  dateColumnToLocalDate,
  iso,
  localDateOf,
  localDateToDateColumn,
  mergeIntervals,
  startOfLocalDay,
  totalMs,
  DAY_MS,
  HOUR_MS,
} from "../lib/time";

import type { FleetDeps } from "./context";
import type { Actor, FleetTx, JsonRecord } from "./types";
import type {
  AssignmentTerms,
  AssignmentTermsInput,
  FleetShift,
  FleetShiftInput,
  TermDiff,
} from "../contract";
import type {
  FleetAssignment,
  FleetAssignmentProposal,
} from "@prisma/client/index";

// ── Overlap ────────────────────────────────────────────────────────────────

interface OverlapRow {
  assignment_id: string;
  driver_id: string;
  fleet_id: string;
  vehicle_id: string;
  shift_kind: string;
  shift_start: string;
  shift_end: string;
}

/**
 * Active signed segments that the proposed shift would overlap on `vehicleId`
 * or for `driverId` — the EXCLUDE constraints' own predicate.
 */
async function overlappingSegments(
  db: FleetTx,
  input: {
    readonly vehicleId: string;
    readonly driverId: string;
    readonly shift: FleetShift;
    readonly validFrom: string;
    readonly validTo: string | null;
  },
): Promise<OverlapRow[]> {
  const found = new Map<string, OverlapRow>();
  for (const segment of shiftSegments(input.shift)) {
    const from = addDays(input.validFrom, segment.dayOffset);
    const to =
      input.validTo === null ? null : addDays(input.validTo, segment.dayOffset);
    const rows = await db.$queryRaw<OverlapRow[]>`
      SELECT s.assignment_id, a.driver_id, a.fleet_id, a.vehicle_id::text AS vehicle_id,
             a.shift_kind, a.shift_start, a.shift_end
        FROM fleet_assignment_shift_segments s
        JOIN fleet_assignments a ON a.id = s.assignment_id
       WHERE s.active
         AND (s.vehicle_id = ${input.vehicleId}::uuid OR s.driver_id = ${input.driverId})
         AND daterange(s.days_from, s.days_to, '[)') && daterange(${from}::date, ${to}::date, '[)')
         AND int4range(s.minute_from, s.minute_to, '[)') && int4range(${segment.minuteFrom}::int, ${segment.minuteTo}::int, '[)')`;
    for (const row of rows) {
      found.set(row.assignment_id, row);
    }
  }
  return [...found.values()];
}

interface OverlapVerdict {
  /** The driver's own arrangements in THIS fleet a signature would supersede. */
  readonly supersedes: readonly string[];
  /** Everything else: refused. */
  readonly blocking: readonly OverlapRow[];
}

async function overlapVerdict(
  db: FleetTx,
  fleetId: string,
  input: Parameters<typeof overlappingSegments>[1],
): Promise<OverlapVerdict> {
  const rows = await overlappingSegments(db, input);
  const supersedes: string[] = [];
  const blocking: OverlapRow[] = [];
  for (const row of rows) {
    if (row.driver_id === input.driverId && row.fleet_id === fleetId) {
      supersedes.push(row.assignment_id);
    } else {
      blocking.push(row);
    }
  }
  return { supersedes, blocking };
}

async function shiftOverlapError(
  db: FleetTx,
  fleetId: string,
  driverId: string,
  blocking: readonly OverlapRow[],
): Promise<FleetError> {
  const names = await displayNames(
    db,
    blocking
      .filter((row) => row.fleet_id === fleetId)
      .map((row) => row.driver_id),
  );
  const plates = await db.vehicle.findMany({
    where: { id: { in: blocking.map((row) => row.vehicle_id) } },
    select: { id: true, plateNumber: true },
  });
  const plateOf = new Map(
    plates.map((vehicle) => [vehicle.id, vehicle.plateNumber]),
  );
  return new FleetError(
    "shift_overlap",
    "The shift overlaps a signed shift. Change the times to send.",
    {
      overlaps: blocking.map((row) =>
        row.fleet_id === fleetId
          ? {
              reason:
                row.driver_id === driverId
                  ? "driver_shift_taken"
                  : "vehicle_shift_taken",
              assignmentId: row.assignment_id,
              vehicleId: row.vehicle_id,
              plate: plateOf.get(row.vehicle_id) ?? null,
              driverId: row.driver_id,
              driverDisplayName: nameOr(names, row.driver_id),
              shift: {
                kind: row.shift_kind,
                start: row.shift_start,
                end: row.shift_end,
              },
            }
          : // Another fleet's arrangement: that it exists, nothing about it.
            { reason: "driver_has_other_arrangement" },
      ),
    },
  );
}

// ── Terms ──────────────────────────────────────────────────────────────────

function termsHash(
  terms: AssignmentTerms,
  shift: FleetShift,
  vehicleId: string,
  validFrom: string,
  validTo: string | null,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ terms, shift, vehicleId, validFrom, validTo }))
    .digest("hex");
}

function termsColumns(terms: AssignmentTerms) {
  return {
    termsType: terms.type,
    amountMinor: terms.amountMinor === null ? null : BigInt(terms.amountMinor),
    currency: terms.currency,
    percent: terms.percent,
    shortfallPolicy: terms.shortfall.policy,
    shortfallMaxWeeks: terms.shortfall.maxWeeks,
    fuelBy: terms.fuelBy,
    servicingBy: terms.servicingBy,
  };
}

function diffOf(
  current: FleetAssignment | null,
  next: {
    vehicleId: string;
    shift: FleetShift;
    validFrom: string;
    validTo: string | null;
    terms: AssignmentTerms;
  },
): TermDiff[] {
  if (current === null) {
    return [
      { field: "vehicle", material: true },
      { field: "shift", material: true },
      { field: "validity", material: false },
      { field: "remittance", material: true },
      { field: "shortfall", material: true },
      { field: "fuelBy", material: false },
      { field: "servicingBy", material: false },
    ];
  }
  const before = termsOf(current);
  const shift = shiftOf(current);
  const diff: TermDiff[] = [];
  if (current.vehicleId !== next.vehicleId) {
    diff.push({ field: "vehicle", material: true });
  }
  if (shift.start !== next.shift.start || shift.end !== next.shift.end) {
    diff.push({ field: "shift", material: true });
  }
  if (
    dateColumnToLocalDate(current.validFrom) !== next.validFrom ||
    validToOf(current.validTo) !== next.validTo
  ) {
    diff.push({ field: "validity", material: false });
  }
  if (
    before.type !== next.terms.type ||
    before.amountMinor !== next.terms.amountMinor ||
    before.percent !== next.terms.percent
  ) {
    diff.push({ field: "remittance", material: true });
  }
  if (before.shortfall.maxWeeks !== next.terms.shortfall.maxWeeks) {
    diff.push({ field: "shortfall", material: true });
  }
  if (before.fuelBy !== next.terms.fuelBy) {
    diff.push({ field: "fuelBy", material: true });
  }
  if (before.servicingBy !== next.terms.servicingBy) {
    diff.push({ field: "servicingBy", material: true });
  }
  return diff;
}

/** The driver's arrangements in a fleet still in force on or after `date`. */
async function liveArrangements(
  db: FleetTx,
  fleetId: string,
  driverId: string,
  date: string,
) {
  const rows = await db.fleetAssignment.findMany({
    where: {
      fleetId,
      driverId,
      status: { in: ["active", "notice"] },
      OR: [{ validTo: null }, { validTo: { gt: localDateToDateColumn(date) } }],
    },
    orderBy: { signedAt: "desc" },
  });
  return rows;
}

async function nextTermsVersion(
  db: FleetTx,
  fleetId: string,
  driverId: string,
): Promise<number> {
  const [signed, proposed] = await Promise.all([
    db.fleetAssignment.aggregate({
      where: { fleetId, driverId },
      _max: { termsVersion: true },
    }),
    db.fleetAssignmentProposal.aggregate({
      where: { fleetId, driverId },
      _max: { termsVersion: true },
    }),
  ]);
  return (
    Math.max(signed._max.termsVersion ?? 0, proposed._max.termsVersion ?? 0) + 1
  );
}

// ── Propose ────────────────────────────────────────────────────────────────

export interface ProposeInput {
  readonly vehicleId: string;
  readonly driverId: string;
  readonly shift: FleetShiftInput;
  readonly validFrom: string;
  readonly validTo?: string | undefined;
  readonly terms?: AssignmentTermsInput | undefined;
}

export async function proposeAssignment(
  deps: FleetDeps,
  access: FleetAccess,
  input: ProposeInput,
  scopedKey: string,
) {
  assertCapability(access, "propose_assignment");
  const proposalId = deterministicId("fap", scopedKey);
  const replay = await deps.db.fleetAssignmentProposal.findUnique({
    where: { id: proposalId },
  });
  if (replay !== null) {
    const names = await displayNames(deps.db, [replay.driverId]);
    return proposalView(replay, nameOr(names, replay.driverId));
  }
  const now = deps.now();
  const zone = access.fleet.zone;
  const today = localDateOf(now.getTime(), zone);
  await fleetVehicleOf(deps.db, access.fleet.id, input.vehicleId);
  const driver = isUuid(input.driverId)
    ? await deps.db.driver.findUnique({
        where: { userId: input.driverId },
        include: { user: { select: { status: true } } },
      })
    : null;
  if (driver === null) {
    throw notFound("driver");
  }
  if (driver.user.status !== "ACTIVE") {
    // UBI decisions are status only: no reason, no override.
    throw new ContractError(
      "driver_ineligible",
      "this driver can't take a fleet arrangement right now",
    );
  }
  if (compareDates(input.validFrom, today) < 0) {
    throw new ContractError(
      "validation_failed",
      "an arrangement cannot start in the past",
      {
        validFrom: input.validFrom,
        today,
      },
    );
  }
  const validTo = input.validTo ?? null;
  if (validTo !== null && compareDates(validTo, input.validFrom) <= 0) {
    throw new ContractError(
      "validation_failed",
      "validTo must be after validFrom",
    );
  }
  const shift = resolveShift(input.shift, access.config.policy);
  const live = await liveArrangements(
    deps.db,
    access.fleet.id,
    input.driverId,
    today,
  );
  const current =
    live.find((row) => row.vehicleId === input.vehicleId) ?? live[0] ?? null;

  let terms: AssignmentTerms;
  let termsVersion: number;
  if (input.terms !== undefined) {
    assertTermsOwner(access);
    terms = {
      type: input.terms.type,
      amountMinor:
        input.terms.type === "weekly_fixed"
          ? (input.terms.amountMinor ?? null)
          : null,
      currency: access.config.city.currency,
      percent:
        input.terms.type === "percent_of_net"
          ? (input.terms.percent ?? null)
          : null,
      shortfall: {
        policy: "carry_forward",
        maxWeeks: input.terms.shortfall.maxWeeks,
      },
      fuelBy: input.terms.fuelBy,
      servicingBy: input.terms.servicingBy,
    };
    termsVersion = await nextTermsVersion(
      deps.db,
      access.fleet.id,
      input.driverId,
    );
  } else {
    // Reuse the CURRENTLY SIGNED terms version — the only form a manager may send.
    const signed = live[0];
    if (signed === undefined) {
      throw new FleetError(
        "terms_owner_only",
        "This driver has no signed terms with your fleet yet. A fleet owner proposes the first terms.",
        { reason: "no_signed_terms" },
      );
    }
    terms = termsOf(signed);
    termsVersion = signed.termsVersion;
  }

  const cap = {
    amountMinor: access.config.city.remittanceCapMinor,
    currency: access.config.city.currency,
  };
  if (
    terms.type === "weekly_fixed" &&
    (terms.amountMinor ?? 0) > cap.amountMinor
  ) {
    throw new FleetError(
      "above_city_cap",
      "The weekly remittance is above the city cap.",
      {
        amount: { amountMinor: terms.amountMinor, currency: terms.currency },
        cityCap: cap,
      },
    );
  }

  const verdict = await overlapVerdict(deps.db, access.fleet.id, {
    vehicleId: input.vehicleId,
    driverId: input.driverId,
    shift,
    validFrom: input.validFrom,
    validTo,
  });
  if (verdict.blocking.length > 0) {
    throw await shiftOverlapError(
      deps.db,
      access.fleet.id,
      input.driverId,
      verdict.blocking,
    );
  }

  const diff = diffOf(current, {
    vehicleId: input.vehicleId,
    shift,
    validFrom: input.validFrom,
    validTo,
    terms,
  });
  const expiresAt = new Date(
    now.getTime() + access.config.policy.proposalTtlHours * HOUR_MS,
  );
  const checkResult: JsonRecord = {
    shiftOverlap: false,
    withinCityCap: true,
    cityCap: cap,
    supersedes: [...verdict.supersedes],
  };

  const created = await withOutbox(deps.db, async (tx) => {
    const events: OutboxInput[] = [];
    // A newer proposal to the same driver from this fleet supersedes a pending one.
    const pending = await tx.fleetAssignmentProposal.findMany({
      where: {
        fleetId: access.fleet.id,
        driverId: input.driverId,
        status: "pending_signature",
      },
    });
    for (const old of pending) {
      await tx.fleetAssignmentProposal.update({
        where: { id: old.id },
        data: {
          status: "superseded",
          respondedAt: now,
          version: { increment: 1 },
        },
      });
      events.push(
        proposalEvent(
          old,
          "pending_signature",
          "superseded",
          access.actor,
          access.cityId,
          now,
        ),
      );
    }
    const row = await tx.fleetAssignmentProposal.create({
      data: {
        id: proposalId,
        fleetId: access.fleet.id,
        vehicleId: input.vehicleId,
        driverId: input.driverId,
        proposedBy: access.actor.id,
        proposedByRole: access.role === "owner" ? "owner" : "manager",
        supersedesAssignmentId: current?.id ?? null,
        shiftKind: shift.kind,
        shiftStart: shift.start,
        shiftEnd: shift.end,
        zone,
        validFrom: localDateToDateColumn(input.validFrom),
        validTo: validTo === null ? null : localDateToDateColumn(validTo),
        termsVersion,
        ...termsColumns(terms),
        termsHash: termsHash(
          terms,
          shift,
          input.vehicleId,
          input.validFrom,
          validTo,
        ),
        diff: diff as unknown as JsonRecord[],
        checkResult,
        // draft → checking → sent → pending_signature, all server-side in
        // this one request: the check passed, the offer reached the driver.
        status: "pending_signature",
        sentAt: now,
        expiresAt,
        idempotencyKey: scopedKey,
      },
    });
    events.push({
      ...proposalEvent(
        row,
        null,
        "pending_signature",
        access.actor,
        access.cityId,
        now,
      ),
      payload: {
        proposalId: row.id,
        fleetId: row.fleetId,
        vehicleId: row.vehicleId,
        driverId: row.driverId,
        from: null,
        to: "pending_signature",
        path: ["draft", "checking", "sent", "pending_signature"],
        termsVersion,
        expiresAt: iso(expiresAt.getTime()),
      },
    });
    return {
      result: row,
      events,
      audits: [
        {
          actor: access.actor,
          action: "fleet.assignment_proposal.sent",
          subjectType: "fleet_assignment_proposal",
          subjectId: row.id,
          after: {
            vehicleId: row.vehicleId,
            driverId: row.driverId,
            shift: { kind: shift.kind, start: shift.start, end: shift.end },
            termsVersion,
            reusedSignedTerms: input.terms === undefined,
            role: access.role,
          },
        },
      ],
    };
  });
  const names = await displayNames(deps.db, [created.driverId]);
  return proposalView(created, nameOr(names, created.driverId));
}

function assertTermsOwner(access: FleetAccess): void {
  if (access.role !== "owner") {
    throw new FleetError(
      "terms_owner_only",
      "New remittance terms are proposed by a fleet owner. Managers propose shift and vehicle changes under the driver's signed terms.",
      { role: access.role },
    );
  }
}

function proposalEvent(
  row: FleetAssignmentProposal,
  from: string | null,
  to: string,
  actor: Actor,
  cityId: string | null,
  now: Date,
): OutboxInput {
  return {
    name: "assignment.proposal.status.changed",
    aggregateType: "assignment",
    aggregateId: row.id,
    fromVersion: from === null ? null : row.version,
    toVersion: from === null ? row.version : row.version + 1,
    actor,
    cityId,
    occurredAt: now,
    // The fleet learns the outcome only: no decline reason exists to send.
    payload: {
      proposalId: row.id,
      fleetId: row.fleetId,
      vehicleId: row.vehicleId,
      driverId: row.driverId,
      from,
      to,
    },
  };
}

// ── Fleet reads and withdraw ───────────────────────────────────────────────

export async function listFleetAssignments(
  deps: FleetDeps,
  access: FleetAccess,
) {
  const [arrangements, proposals] = await Promise.all([
    deps.db.fleetAssignment.findMany({
      where: { fleetId: access.fleet.id },
      orderBy: { signedAt: "desc" },
      take: 500,
    }),
    deps.db.fleetAssignmentProposal.findMany({
      where: { fleetId: access.fleet.id },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  ]);
  const names = await displayNames(deps.db, [
    ...arrangements.map((row) => row.driverId),
    ...proposals.map((row) => row.driverId),
  ]);
  return {
    arrangements: arrangements.map((row) =>
      arrangementView(row, nameOr(names, row.driverId)),
    ),
    proposals: proposals.map((row) =>
      proposalView(row, nameOr(names, row.driverId)),
    ),
  };
}

export async function withdrawProposal(
  deps: FleetDeps,
  access: FleetAccess,
  proposalId: string,
) {
  assertCapability(access, "propose_assignment");
  const now = deps.now();
  const row = await withOutbox(deps.db, async (tx) => {
    const proposal = await tx.fleetAssignmentProposal.findUnique({
      where: { id: proposalId },
    });
    if (proposal === null || proposal.fleetId !== access.fleet.id) {
      throw notFound("proposal");
    }
    if (proposal.status === "withdrawn") {
      return { result: proposal };
    }
    if (proposal.status !== "pending_signature" && proposal.status !== "sent") {
      throw illegalTransition(
        "assignmentProposal",
        proposal.status,
        "withdrawn",
      );
    }
    // Guarded like sign and decline: a signature that commits first wins,
    // and a signed offer is never relabelled `withdrawn`.
    const moved = await tx.fleetAssignmentProposal.updateMany({
      where: {
        id: proposal.id,
        status: proposal.status,
        version: proposal.version,
      },
      data: {
        status: "withdrawn",
        respondedAt: now,
        version: { increment: 1 },
      },
    });
    if (moved.count === 0) {
      throw new ContractError(
        "version_conflict",
        "this proposal changed while you were withdrawing it; reload it",
      );
    }
    const updated = await tx.fleetAssignmentProposal.findUniqueOrThrow({
      where: { id: proposal.id },
    });
    return {
      result: updated,
      events: [
        proposalEvent(
          proposal,
          proposal.status,
          "withdrawn",
          access.actor,
          access.cityId,
          now,
        ),
      ],
      audits: [
        {
          actor: access.actor,
          action: "fleet.assignment_proposal.withdrawn",
          subjectType: "fleet_assignment_proposal",
          subjectId: proposal.id,
          before: proposal.status,
          after: "withdrawn",
        },
      ],
    };
  });
  const names = await displayNames(deps.db, [row.driverId]);
  return proposalView(row, nameOr(names, row.driverId));
}

// ── Expiry (48 h) ──────────────────────────────────────────────────────────

const SYSTEM: Actor = { id: "fleet-service", role: "system" };

/** Expires unsigned offers past their deadline (sweep, and lazily on read/sign). */
export async function expireProposals(
  deps: FleetDeps,
  where: { driverId?: string } = {},
): Promise<number> {
  const now = deps.now();
  const due = await deps.db.fleetAssignmentProposal.findMany({
    where: {
      status: { in: ["pending_signature", "sent"] },
      expiresAt: { lte: now },
      ...(where.driverId === undefined ? {} : { driverId: where.driverId }),
    },
    include: { fleet: { select: { cityId: true } } },
    take: 500,
  });
  let expired = 0;
  for (const proposal of due) {
    await withOutbox(deps.db, async (tx) => {
      const moved = await tx.fleetAssignmentProposal.updateMany({
        where: {
          id: proposal.id,
          status: proposal.status,
          version: proposal.version,
        },
        data: {
          status: "expired",
          respondedAt: now,
          version: { increment: 1 },
        },
      });
      if (moved.count === 0) {
        return { result: null };
      }
      expired += 1;
      return {
        result: null,
        events: [
          proposalEvent(
            proposal,
            proposal.status,
            "expired",
            SYSTEM,
            proposal.fleet.cityId,
            now,
          ),
        ],
        audits: [
          {
            actor: SYSTEM,
            action: "fleet.assignment_proposal.expired",
            subjectType: "fleet_assignment_proposal",
            subjectId: proposal.id,
            before: proposal.status,
            after: "expired",
            reason: "no_signature_within_ttl",
          },
        ],
      };
    });
  }
  return expired;
}

// ── Driver side: offers, sign, decline ─────────────────────────────────────

async function driverProposalOf(
  deps: FleetDeps,
  driverId: string,
  cityId: string,
  offerId: string,
): Promise<
  FleetAssignmentProposal & {
    fleet: { cityId: string; name: string; status: string };
  }
> {
  const proposal = await deps.db.fleetAssignmentProposal.findUnique({
    where: { id: offerId },
    include: { fleet: { select: { cityId: true, name: true, status: true } } },
  });
  if (
    proposal === null ||
    proposal.driverId !== driverId ||
    proposal.fleet.cityId !== cityId
  ) {
    throw notFound("offer");
  }
  return proposal;
}

export async function driverOffers(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
) {
  const config = await requireFleetEnabled(deps.config, cityId);
  await expireProposals(deps, { driverId: actor.id });
  const proposals = await deps.db.fleetAssignmentProposal.findMany({
    where: { driverId: actor.id, status: "pending_signature" },
    include: { fleet: { select: { id: true, name: true, cityId: true } } },
    orderBy: { expiresAt: "asc" },
  });
  const now = deps.now();
  const inCity = proposals.filter((row) => row.fleet.cityId === cityId);
  const vehicles = await deps.db.fleetVehicle.findMany({
    where: {
      vehicleId: { in: inCity.map((row) => row.vehicleId) },
      status: "active",
    },
    include: { vehicle: true },
  });
  const vehicleOf = new Map(vehicles.map((row) => [row.vehicleId, row]));
  const timeOff = await deps.db.driverAvailability.findMany({
    where: { driverId: actor.id, kind: "time_off", status: { not: "removed" } },
  });
  const horizonEnd =
    now.getTime() + config.policy.availabilityCheckHorizonDays * DAY_MS;
  let bookingsKnown = true;
  let liveBookings = 0;
  try {
    const bookings = await deps.rides.driverCalendar(
      actor.id,
      iso(now.getTime()),
      iso(horizonEnd),
    );
    liveBookings = bookings.filter((booking) =>
      [
        "held",
        "payment_pending",
        "confirmed",
        "reconfirmed",
        "activated",
      ].includes(booking.state),
    ).length;
  } catch {
    bookingsKnown = false;
  }
  const offers = [];
  for (const proposal of inCity) {
    const fleetVehicle = vehicleOf.get(proposal.vehicleId);
    if (fleetVehicle === undefined) {
      continue;
    }
    const shift = shiftOf(proposal);
    const validFrom = dateColumnToLocalDate(proposal.validFrom);
    const validTo = validToOf(proposal.validTo);
    const window = { start: now.getTime(), end: horizonEnd };
    const instances = shiftIntervals(
      shift,
      proposal.zone,
      validFrom,
      validTo,
      window,
    );
    const clashesWithTimeOff = timeOff.some((entry) =>
      instances.some(
        (instance) =>
          instance.start < entry.endsAt.getTime() &&
          entry.startsAt.getTime() < instance.end,
      ),
    );
    const current =
      proposal.supersedesAssignmentId === null
        ? null
        : await deps.db.fleetAssignment.findUnique({
            where: { id: proposal.supersedesAssignmentId },
          });
    const vehicleChanges =
      current === null || current.vehicleId !== proposal.vehicleId;
    offers.push({
      offerId: proposal.id,
      fleet: { fleetId: proposal.fleet.id, name: proposal.fleet.name },
      vehicle: {
        vehicleId: proposal.vehicleId,
        plate: fleetVehicle.vehicle.plateNumber,
        make: fleetVehicle.vehicle.make,
        model: fleetVehicle.vehicle.model,
        classes: [...fleetVehicle.classes],
        capacity: fleetVehicle.capacity,
      },
      shift,
      validFrom,
      validTo,
      termsVersion: proposal.termsVersion,
      terms: termsOf(proposal),
      current:
        current === null
          ? null
          : {
              assignmentId: current.id,
              vehicleId: current.vehicleId,
              shift: shiftOf(current),
              termsVersion: current.termsVersion,
              terms: termsOf(current),
            },
      diff: (proposal.diff ?? []) as TermDiff[],
      check: {
        // A vehicle change reaches the driver's advance bookings (each would
        // need a swap and the rider's consent); null = could not check now.
        clashesWithBookings: bookingsKnown
          ? vehicleChanges && liveBookings > 0
          : null,
        clashesWithTimeOff,
      },
      status: "pending_signature" as const,
      expiresAt:
        proposal.expiresAt === null ? null : iso(proposal.expiresAt.getTime()),
      historicEarnings: null,
      historicEarningsReason:
        "No per-vehicle earnings history is available to fleet-service yet; UBI shows none rather than an estimate.",
    });
  }
  return { offers };
}

export async function signOffer(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  offerId: string,
  pin: string,
) {
  await requireFleetEnabled(deps.config, cityId);
  let proposal = await driverProposalOf(deps, actor.id, cityId, offerId);
  if (proposal.status === "signed") {
    const signed = await deps.db.fleetAssignment.findUnique({
      where: { proposalId: proposal.id },
    });
    if (signed !== null) {
      return signView(deps, proposal.id, signed);
    }
  }
  if (
    proposal.status === "pending_signature" &&
    proposal.expiresAt !== null &&
    proposal.expiresAt <= deps.now()
  ) {
    await expireProposals(deps, { driverId: actor.id });
    proposal = await driverProposalOf(deps, actor.id, cityId, offerId);
  }
  if (proposal.status === "expired") {
    throw new ContractError(
      "offer_expired",
      "This offer expired. Your fleet can send a new one.",
    );
  }
  if (proposal.status !== "pending_signature") {
    throw illegalTransition("assignmentProposal", proposal.status, "signed");
  }
  if (proposal.fleet.status !== "active") {
    throw new ContractError(
      "conflict",
      "this fleet can't take signatures right now",
      {
        reason: "fleet_suspended",
      },
    );
  }
  await fleetVehicleOf(deps.db, proposal.fleetId, proposal.vehicleId);
  const shift = shiftOf(proposal);
  const proposedFrom = dateColumnToLocalDate(proposal.validFrom);
  const validTo = validToOf(proposal.validTo);
  // Consent is never retroactive. An offer signed after its proposed start
  // date (it lives 48 h) takes effect from the signing day, so no shift hour
  // before the signature is settled under these terms (contract B) and a
  // superseded arrangement keeps its own terms until then.
  const signingDay = localDateOf(deps.now().getTime(), proposal.zone);
  const validFrom =
    compareDates(proposedFrom, signingDay) < 0 ? signingDay : proposedFrom;
  if (validTo !== null && compareDates(validTo, validFrom) <= 0) {
    throw new ContractError(
      "offer_expired",
      "This offer's dates have already passed. Your fleet can send a new one.",
      { validTo },
    );
  }
  const signedTermsHash =
    validFrom === proposedFrom
      ? proposal.termsHash
      : termsHash(
          termsOf(proposal),
          shift,
          proposal.vehicleId,
          validFrom,
          validTo,
        );
  // Everything that could refuse the signature is checked BEFORE the PIN, so
  // an offer that cannot be signed never costs the driver a PIN attempt.
  const verdict = await overlapVerdict(deps.db, proposal.fleetId, {
    vehicleId: proposal.vehicleId,
    driverId: proposal.driverId,
    shift,
    validFrom,
    validTo,
  });
  if (verdict.blocking.length > 0) {
    throw await shiftOverlapError(
      deps.db,
      proposal.fleetId,
      proposal.driverId,
      verdict.blocking,
    );
  }

  const verification = await deps.pins.verify(pin);

  const now = deps.now();
  const assignmentId = deterministicId("asg", proposal.id);
  let assignment: FleetAssignment;
  try {
    assignment = await withOutbox(deps.db, async (tx) => {
      const moved = await tx.fleetAssignmentProposal.updateMany({
        where: {
          id: proposal.id,
          status: "pending_signature",
          version: proposal.version,
        },
        data: { status: "signed", respondedAt: now, version: { increment: 1 } },
      });
      if (moved.count === 0) {
        throw new ContractError(
          "version_conflict",
          "this offer changed while you were signing; reload it",
        );
      }
      const events: OutboxInput[] = [
        proposalEvent(
          proposal,
          "pending_signature",
          "signed",
          actor,
          cityId,
          now,
        ),
      ];
      // Supersede the driver's own overlapping arrangements in this fleet.
      for (const oldId of verdict.supersedes) {
        const old = await tx.fleetAssignment.findUnique({
          where: { id: oldId },
        });
        if (old === null) {
          continue;
        }
        const oldFrom = dateColumnToLocalDate(old.validFrom);
        const newTo =
          compareDates(oldFrom, validFrom) < 0 ? validFrom : oldFrom;
        await moveValidityEnd(tx, old, newTo, "superseded", now);
        events.push(
          arrangementEvent(old, old.status, "superseded", actor, cityId, now, {
            supersededBy: assignmentId,
          }),
        );
      }
      const created = await tx.fleetAssignment.create({
        data: {
          id: assignmentId,
          fleetId: proposal.fleetId,
          vehicleId: proposal.vehicleId,
          driverId: proposal.driverId,
          proposalId: proposal.id,
          shiftKind: proposal.shiftKind,
          shiftStart: proposal.shiftStart,
          shiftEnd: proposal.shiftEnd,
          zone: proposal.zone,
          validFrom: localDateToDateColumn(validFrom),
          validTo: proposal.validTo,
          termsVersion: proposal.termsVersion,
          termsType: proposal.termsType,
          amountMinor: proposal.amountMinor,
          currency: proposal.currency,
          percent: proposal.percent,
          shortfallPolicy: proposal.shortfallPolicy,
          shortfallMaxWeeks: proposal.shortfallMaxWeeks,
          fuelBy: proposal.fuelBy,
          servicingBy: proposal.servicingBy,
          termsHash: signedTermsHash,
          signedAt: verification.verifiedAt,
          pinVerificationRef: verification.reference,
          status: "active",
        },
      });
      await writeSegments(tx, created, shift, validFrom, validTo);
      events.push({
        name: "assignment.signed",
        aggregateType: "assignment",
        aggregateId: created.id,
        fromVersion: null,
        toVersion: 1,
        actor,
        cityId,
        occurredAt: now,
        payload: {
          assignmentId: created.id,
          proposalId: proposal.id,
          fleetId: created.fleetId,
          vehicleId: created.vehicleId,
          driverId: created.driverId,
          termsVersion: created.termsVersion,
          termsHash: created.termsHash,
          signedAt: iso(created.signedAt.getTime()),
          validFrom,
          validTo,
        },
      });
      return {
        result: created,
        events,
        audits: [
          {
            actor,
            action: "assignment.signed",
            subjectType: "fleet_assignment",
            subjectId: created.id,
            // Signature evidence — never the PIN, never the relayed context.
            after: {
              proposalId: proposal.id,
              termsVersion: created.termsVersion,
              termsHash: created.termsHash,
              signedAt: iso(created.signedAt.getTime()),
              validFrom,
              proposedValidFrom: proposedFrom,
              verification: {
                method: "wallet_pin",
                verifiedBy: "user-service",
                reference: verification.reference,
              },
              supersedes: [...verdict.supersedes],
            },
          },
        ],
      };
    });
  } catch (error) {
    if (exclusionConstraintOf(error) !== null) {
      // A concurrent signature took the slot first: the database refused ours.
      throw new FleetError(
        "shift_overlap",
        "The shift now overlaps a signed shift.",
        {
          overlaps: [{ reason: "signed_concurrently" }],
        },
      );
    }
    throw error;
  }
  return signView(deps, proposal.id, assignment);
}

async function signView(
  deps: FleetDeps,
  offerId: string,
  assignment: FleetAssignment,
) {
  const names = await displayNames(deps.db, [assignment.driverId]);
  return {
    offerId,
    status: "signed" as const,
    arrangement: arrangementView(
      assignment,
      nameOr(names, assignment.driverId),
    ),
    signature: {
      signedAt: iso(assignment.signedAt.getTime()),
      termsVersion: assignment.termsVersion,
      termsHash: assignment.termsHash,
      verification: {
        method: "wallet_pin" as const,
        verifiedBy: "user-service" as const,
        reference: assignment.pinVerificationRef,
      },
    },
  };
}

export async function declineOffer(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  offerId: string,
) {
  await requireFleetEnabled(deps.config, cityId);
  const proposal = await driverProposalOf(deps, actor.id, cityId, offerId);
  if (proposal.status === "declined") {
    return { offerId, status: "declined" as const };
  }
  if (proposal.status !== "pending_signature") {
    throw illegalTransition("assignmentProposal", proposal.status, "declined");
  }
  const now = deps.now();
  if (proposal.expiresAt !== null && proposal.expiresAt <= now) {
    await expireProposals(deps, { driverId: actor.id });
    throw new ContractError(
      "offer_expired",
      "This offer already expired. Nothing changes.",
    );
  }
  await withOutbox(deps.db, async (tx) => {
    const moved = await tx.fleetAssignmentProposal.updateMany({
      where: {
        id: proposal.id,
        status: "pending_signature",
        version: proposal.version,
      },
      data: { status: "declined", respondedAt: now, version: { increment: 1 } },
    });
    if (moved.count === 0) {
      throw new ContractError(
        "version_conflict",
        "this offer changed; reload it",
      );
    }
    return {
      result: null,
      events: [
        proposalEvent(
          proposal,
          "pending_signature",
          "declined",
          actor,
          cityId,
          now,
        ),
      ],
      // No reason is asked for, stored or sent: there is none to leak.
      audits: [
        {
          actor,
          action: "fleet.assignment_proposal.declined",
          subjectType: "fleet_assignment_proposal",
          subjectId: proposal.id,
          before: "pending_signature",
          after: "declined",
        },
      ],
    };
  });
  return { offerId, status: "declined" as const };
}

// ── Segments and validity ──────────────────────────────────────────────────

async function writeSegments(
  tx: OutboxTx,
  assignment: FleetAssignment,
  shift: FleetShift,
  validFrom: string,
  validTo: string | null,
): Promise<void> {
  let index = 0;
  for (const segment of shiftSegments(shift)) {
    index += 1;
    await tx.fleetAssignmentShiftSegment.create({
      data: {
        id: `${assignment.id}_s${index}`,
        assignmentId: assignment.id,
        vehicleId: assignment.vehicleId,
        driverId: assignment.driverId,
        daysFrom: localDateToDateColumn(addDays(validFrom, segment.dayOffset)),
        daysTo:
          validTo === null
            ? null
            : localDateToDateColumn(addDays(validTo, segment.dayOffset)),
        minuteFrom: segment.minuteFrom,
        minuteTo: segment.minuteTo,
      },
    });
  }
}

/** Moves an arrangement's (exclusive) validity end, and its segments with it. */
async function moveValidityEnd(
  tx: OutboxTx,
  assignment: FleetAssignment,
  newTo: string,
  status: "superseded" | "notice" | "ended",
  now: Date,
  noticeBy?: string,
): Promise<void> {
  const from = dateColumnToLocalDate(assignment.validFrom);
  // Version-guarded: two notices (fleet and driver at once), or a notice
  // racing a superseding signature, never both move the same row.
  const moved = await tx.fleetAssignment.updateMany({
    where: { id: assignment.id, version: assignment.version },
    data: {
      validTo: localDateToDateColumn(newTo),
      status,
      version: { increment: 1 },
      ...(status === "notice"
        ? { noticeStartedAt: now, noticeStartedBy: noticeBy ?? null }
        : {}),
      ...(status === "ended" || status === "superseded"
        ? { endedAt: now }
        : {}),
    },
  });
  if (moved.count === 0) {
    throw new ContractError(
      "version_conflict",
      "this arrangement changed at the same time; reload it",
    );
  }
  await tx.$executeRaw`
    UPDATE fleet_assignment_shift_segments
       SET days_to = days_from + (${newTo}::date - ${from}::date), updated_at = now()
     WHERE assignment_id = ${assignment.id}`;
}

function arrangementEvent(
  row: FleetAssignment,
  from: string,
  to: string,
  actor: Actor,
  cityId: string | null,
  now: Date,
  extra: JsonRecord = {},
): OutboxInput {
  return {
    name: "assignment.status.changed",
    aggregateType: "assignment",
    aggregateId: row.id,
    fromVersion: row.version,
    toVersion: row.version + 1,
    actor,
    cityId,
    occurredAt: now,
    payload: {
      assignmentId: row.id,
      fleetId: row.fleetId,
      vehicleId: row.vehicleId,
      driverId: row.driverId,
      from,
      to,
      ...extra,
    },
  };
}

// ── Termination (2-week notice, either side) ───────────────────────────────

async function startNotice(
  deps: FleetDeps,
  assignment: FleetAssignment,
  actor: Actor,
  cityId: string,
  noticeDays: number,
) {
  if (assignment.status !== "active") {
    throw illegalTransition("arrangement", assignment.status, "notice");
  }
  const now = deps.now();
  const today = localDateOf(now.getTime(), assignment.zone);
  const noticeEndsOn = addDays(today, noticeDays);
  const currentTo = validToOf(assignment.validTo);
  const newTo =
    currentTo !== null && compareDates(currentTo, noticeEndsOn) < 0
      ? currentTo
      : noticeEndsOn;
  const endInstant = startOfLocalDay(newTo, assignment.zone);
  // Bookings reaching past the notice end: the driver keeps each on another
  // eligible vehicle (swap, rider consent) or withdraws. Read BEFORE any
  // write: a ride-service outage leaves the arrangement untouched.
  const after = await deps.rides.occupiedBlocks({
    vehicleIds: [assignment.vehicleId],
    driverIds: [assignment.driverId],
    from: iso(endInstant),
    to: iso(endInstant + 120 * DAY_MS),
  });
  const affected = after.filter(
    (block) =>
      block.driverId === assignment.driverId &&
      new Date(block.endsAt).getTime() > endInstant &&
      (block.vehicleId === null || block.vehicleId === assignment.vehicleId),
  );
  const conflictIds = await withOutbox(deps.db, async (tx) => {
    await moveValidityEnd(tx, assignment, newTo, "notice", now, actor.id);
    const events: OutboxInput[] = [
      arrangementEvent(assignment, "active", "notice", actor, cityId, now, {
        noticeEndsOn: newTo,
      }),
    ];
    const ids: string[] = [];
    for (const block of affected) {
      const opened = await openConflict(
        tx,
        {
          type: "termination_bookings",
          severity: "high",
          fleetId: assignment.fleetId,
          vehicleId: assignment.vehicleId,
          driverId: assignment.driverId,
          bookingBlockId: block.blockId,
          assignmentId: assignment.id,
          resolverRoles: ["driver", "rider"],
          deadlineAt:
            block.decisionDeadline === null
              ? null
              : new Date(block.decisionDeadline),
          dedupeKey: `termination:${assignment.id}:${block.blockId}`,
          detail: {
            blockStartsAt: block.startsAt,
            blockEndsAt: block.endsAt,
            noticeEndsOn: newTo,
          },
        },
        actor,
        cityId,
        now,
      );
      ids.push(opened.conflict.id);
      events.push(...opened.events);
    }
    return {
      result: ids,
      events,
      audits: [
        {
          actor,
          action: "fleet.assignment.notice_started",
          subjectType: "fleet_assignment",
          subjectId: assignment.id,
          before: { status: "active", validTo: currentTo },
          after: {
            status: "notice",
            validTo: newTo,
            bookingsAfterNotice: affected.length,
          },
        },
      ],
    };
  });
  const reloaded = await deps.db.fleetAssignment.findUniqueOrThrow({
    where: { id: assignment.id },
  });
  return { assignment: reloaded, noticeEndsOn: newTo, affected, conflictIds };
}

export async function terminateByFleet(
  deps: FleetDeps,
  access: FleetAccess,
  assignmentId: string,
) {
  assertCapability(access, "terminate_arrangement");
  const assignment = await deps.db.fleetAssignment.findUnique({
    where: { id: assignmentId },
  });
  if (assignment === null || assignment.fleetId !== access.fleet.id) {
    throw notFound("arrangement");
  }
  const outcome = await startNotice(
    deps,
    assignment,
    access.actor,
    access.cityId,
    access.config.policy.terminationNoticeDays,
  );
  return {
    assignmentId: outcome.assignment.id,
    status: outcome.assignment.status as "notice",
    noticeEndsOn: outcome.noticeEndsOn,
    bookingsAfterNotice: outcome.affected,
    conflictIds: outcome.conflictIds,
  };
}

export async function terminateByDriver(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
  assignmentId: string,
) {
  const config = await requireFleetEnabled(deps.config, cityId);
  const assignment = await deps.db.fleetAssignment.findUnique({
    where: { id: assignmentId },
    include: { fleet: { select: { cityId: true } } },
  });
  if (
    assignment === null ||
    assignment.driverId !== actor.id ||
    assignment.fleet.cityId !== cityId
  ) {
    throw notFound("arrangement");
  }
  const outcome = await startNotice(
    deps,
    assignment,
    actor,
    cityId,
    config.policy.terminationNoticeDays,
  );
  return {
    assignmentId: outcome.assignment.id,
    status: outcome.assignment.status as "notice",
    noticeEndsOn: outcome.noticeEndsOn,
    // The driver's OWN bookings; the driver keeps or withdraws each.
    bookingsAfterNotice: outcome.affected.map((block) => ({
      bookingId: block.blockId,
      startsAt: block.startsAt,
    })),
  };
}

/** Arrangements whose notice (or validity) has run out: → ended. */
export async function endLapsedArrangements(deps: FleetDeps): Promise<number> {
  const now = deps.now();
  const candidates = await deps.db.fleetAssignment.findMany({
    where: { status: { in: ["active", "notice"] }, validTo: { not: null } },
    include: { fleet: { select: { cityId: true } } },
    take: 500,
  });
  let ended = 0;
  for (const row of candidates) {
    const today = localDateOf(now.getTime(), row.zone);
    const to = validToOf(row.validTo);
    if (to === null || compareDates(to, today) > 0) {
      continue;
    }
    await withOutbox(deps.db, async (tx) => {
      const moved = await tx.fleetAssignment.updateMany({
        where: { id: row.id, version: row.version },
        data: { status: "ended", endedAt: now, version: { increment: 1 } },
      });
      if (moved.count === 0) {
        return { result: null };
      }
      ended += 1;
      return {
        result: null,
        events: [
          arrangementEvent(
            row,
            row.status,
            "ended",
            SYSTEM,
            row.fleet.cityId,
            now,
          ),
        ],
        audits: [
          {
            actor: SYSTEM,
            action: "fleet.assignment.ended",
            subjectType: "fleet_assignment",
            subjectId: row.id,
            before: row.status,
            after: "ended",
            reason: "validity_ended",
          },
        ],
      };
    });
  }
  return ended;
}

export async function driverArrangements(
  deps: FleetDeps,
  actor: Actor,
  cityId: string,
) {
  await requireFleetEnabled(deps.config, cityId);
  const today = localDateOf(deps.now().getTime(), "UTC");
  const rows = await deps.db.fleetAssignment.findMany({
    where: {
      driverId: actor.id,
      status: { in: ["active", "notice"] },
      OR: [
        { validTo: null },
        { validTo: { gte: localDateToDateColumn(addDays(today, -1)) } },
      ],
    },
    include: { fleet: { select: { name: true, cityId: true } } },
    orderBy: { validFrom: "asc" },
  });
  const names = await displayNames(deps.db, [actor.id]);
  return {
    arrangements: rows
      .filter((row) => row.fleet.cityId === cityId)
      .map((row) => ({
        ...arrangementView(row, nameOr(names, actor.id)),
        fleetName: row.fleet.name,
        noticeEndsOn: row.status === "notice" ? validToOf(row.validTo) : null,
      })),
    weekSplit: {
      available: false as const,
      reason:
        "this week's split (UBI commission, fleet remittance, your net) is computed by payment-service on the ledger",
      source: "payment-service remittance settlement (internal contract B)",
    },
  };
}

// ── Internal contract A route 8 ────────────────────────────────────────────

/**
 * The vehicle a fleet driver is assigned to for the WHOLE of [from, to) under
 * a signed arrangement: the arrangement's shift instances must cover every
 * instant of the interval. Otherwise every field is null.
 */
export async function vehicleAt(
  db: FleetTx,
  driverId: string,
  from: Date,
  to: Date,
) {
  const none = {
    vehicleId: null,
    assignmentId: null,
    vehicleClass: null,
    capacity: null,
  };
  if (to.getTime() <= from.getTime()) {
    return none;
  }
  const candidates = await db.fleetAssignment.findMany({
    where: {
      driverId,
      validFrom: {
        lte: localDateToDateColumn(addDays(from.toISOString().slice(0, 10), 1)),
      },
      OR: [
        { validTo: null },
        {
          validTo: {
            gte: localDateToDateColumn(
              addDays(to.toISOString().slice(0, 10), -1),
            ),
          },
        },
      ],
    },
    orderBy: { signedAt: "desc" },
  });
  const window = { start: from.getTime(), end: to.getTime() };
  for (const row of candidates) {
    const covered = mergeIntervals(
      shiftIntervals(
        shiftOf(row),
        row.zone,
        dateColumnToLocalDate(row.validFrom),
        validToOf(row.validTo),
        window,
      ),
    );
    if (totalMs(covered) !== window.end - window.start) {
      continue;
    }
    const fleetVehicle = await db.fleetVehicle.findFirst({
      where: {
        vehicleId: row.vehicleId,
        fleetId: row.fleetId,
        status: "active",
      },
    });
    if (fleetVehicle === null) {
      continue;
    }
    return {
      vehicleId: row.vehicleId,
      assignmentId: row.id,
      vehicleClass: fleetVehicle.classes[0] ?? null,
      capacity: fleetVehicle.capacity,
    };
  }
  return none;
}
