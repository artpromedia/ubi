/**
 * Safety cases: SOS, the 24/7 queue, and responder actions (board 4c / 15c).
 *
 * CLAUDE.md #9 is the whole design brief: SOS is durable, retried, has an SMS
 * fallback, lands in a queue with an SLA, and puts the ride in safety_hold. So
 * the order of operations is not negotiable:
 *
 *   1. The incident is committed to Postgres, with its audit row and its outbox
 *      events, before anything is sent anywhere.
 *   2. Only then is a notification attempted — push first, SMS as a fallback.
 *   3. A channel that fails does not fail the request and does not lose the
 *      incident: the failure is written back onto the case with the time of the
 *      next attempt, and the retry sweep picks it up.
 *
 * A person pressing the SOS button gets a 202 whether or not any notification
 * channel is alive, because the incident exists either way.
 *
 * The emergency number comes from city config (Lagos: 112). When config cannot
 * be read the responder is told the number is unavailable — this service does
 * not carry a number in code (CLAUDE.md #6, #12).
 */
import { ContractError, scopedIdempotencyKey } from "@ubi/contracts";

import { deterministicId } from "../lib/ids";
import { safetyLogger } from "../lib/logger";

import { auditedTransaction, type OutboxInput } from "./audit";
import {
  safetySlaMinutes,
  severityForTrigger,
  sosBackoffSeconds,
  type SafetySeverity,
  type SosTrigger,
  type SupportPolicy,
} from "./city-config";
import { isUniqueViolation } from "./errors";
import { actorTypeFor, assertPermission, locationForRole } from "./roles";

import type { SupportDeps } from "./context";
import type { SafetyAlert } from "./notifier";
import type { Actor, JsonRecord, JsonValue, SupportDb } from "./types";

export const SAFETY_STATUSES = ["open", "acknowledged", "escalated", "resolved"] as const;
export type SafetyStatus = (typeof SAFETY_STATUSES)[number];

/**
 * contracts/state-machines.json has no `safetyCase` machine, so this is the
 * local one. It is closed and checked the same way the contract machines are;
 * see the slice report for the contract gap.
 */
const SAFETY_TRANSITIONS: Readonly<Record<SafetyStatus, readonly SafetyStatus[]>> = {
  open: ["acknowledged", "escalated"],
  acknowledged: ["escalated", "resolved"],
  escalated: ["resolved"],
  resolved: [],
};

export const RESPONDER_ACTIONS = [
  "acknowledge",
  "contact_rider",
  "contact_driver",
  "dispatch_emergency",
  "escalate",
  "resolve",
] as const;
export type ResponderAction = (typeof RESPONDER_ACTIONS)[number];

/** The status each action moves the case to, or null when it only records contact. */
const ACTION_TARGET: Readonly<Record<ResponderAction, SafetyStatus | null>> = {
  acknowledge: "acknowledged",
  contact_rider: null,
  contact_driver: null,
  dispatch_emergency: "escalated",
  escalate: "escalated",
  resolve: "resolved",
};

export function isSafetyStatus(value: string): value is SafetyStatus {
  return (SAFETY_STATUSES as readonly string[]).includes(value);
}

/** The actions a responder may take from the case's current status. */
export function actionsFor(status: string): readonly ResponderAction[] {
  if (!isSafetyStatus(status)) {
    return [];
  }
  return RESPONDER_ACTIONS.filter((action) => {
    const target = ACTION_TARGET[action];
    if (target === null) {
      return status !== "resolved";
    }
    return SAFETY_TRANSITIONS[status].includes(target);
  });
}

// ---------------------------------------------------------------------------
// The timeline JSON carried on safety_cases.timeline
// ---------------------------------------------------------------------------

export type DeliveryStatus = "pending" | "delivered" | "exhausted";

export interface DeliveryState {
  readonly status: DeliveryStatus;
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly deliveredChannel: string | null;
  readonly lastError: string | null;
}

interface SafetyTimeline {
  readonly trigger: string;
  readonly raisedByType: string;
  readonly cityId: string;
  readonly rideId: string | null;
  readonly emergencyNumber: string | null;
  readonly configStatus: string;
  readonly location: JsonRecord | null;
  readonly tripContext: JsonRecord | null;
  readonly rideHoldRequested: boolean;
  readonly delivery: DeliveryState;
  readonly entries: readonly JsonRecord[];
}

function asTimeline(value: unknown): SafetyTimeline | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as unknown as SafetyTimeline;
}

function timelineToJson(timeline: SafetyTimeline): JsonRecord {
  return timeline as unknown as JsonRecord;
}

// ---------------------------------------------------------------------------
// Raising an SOS
// ---------------------------------------------------------------------------

export interface SosLocation {
  readonly lat: number;
  readonly lng: number;
  readonly accuracyMeters: number | null;
  readonly at: string | null;
}

export interface RaiseSosInput {
  readonly actor: Actor;
  readonly cityId: string;
  readonly trigger: SosTrigger;
  readonly rideId: string | null;
  /** The reporter's own device fix. Recorded as reported; never used for money. */
  readonly location: SosLocation | null;
  readonly note: string | null;
  readonly idempotencyKey: string;
  readonly correlationId: string | null;
}

export interface SafetyCaseView {
  readonly id: string;
  readonly status: string;
  readonly severity: string;
  readonly rideId: string | null;
  readonly raisedBy: string;
  readonly slaDueAt: string | null;
  readonly slaBreached: boolean;
  readonly responder: string | null;
  readonly emergencyNumber: string | null;
  readonly rideHoldRequested: boolean;
  readonly delivery: DeliveryState;
  readonly location: { lat: number; lng: number; precision: string } | null;
  readonly createdAt: string;
  readonly availableActions: readonly ResponderAction[];
}

interface SafetyRow {
  id: string;
  rideId: string | null;
  raisedBy: string;
  severity: string;
  status: string;
  slaDue: Date | null;
  responder: string | null;
  timeline: unknown;
  createdAt: Date;
}

function safetyView(row: SafetyRow, role: string, now: Date): SafetyCaseView {
  const timeline = asTimeline(row.timeline);
  const rawLocation = timeline?.location ?? null;
  const lat = typeof rawLocation?.lat === "number" ? rawLocation.lat : null;
  const lng = typeof rawLocation?.lng === "number" ? rawLocation.lng : null;
  const coarse =
    lat === null || lng === null ? null : locationForRole(role, { lat, lng });

  return {
    id: row.id,
    status: row.status,
    severity: row.severity,
    rideId: row.rideId,
    raisedBy: row.raisedBy,
    slaDueAt: row.slaDue === null ? null : row.slaDue.toISOString(),
    slaBreached:
      row.slaDue !== null && row.status !== "resolved" && row.slaDue.getTime() < now.getTime(),
    responder: row.responder,
    emergencyNumber: timeline?.emergencyNumber ?? null,
    rideHoldRequested: timeline?.rideHoldRequested ?? false,
    delivery: timeline?.delivery ?? {
      status: "pending",
      attempts: 0,
      nextAttemptAt: null,
      deliveredChannel: null,
      lastError: null,
    },
    location: coarse,
    createdAt: row.createdAt.toISOString(),
    availableActions: actionsFor(row.status),
  };
}

export async function raiseSos(
  deps: SupportDeps,
  input: RaiseSosInput,
): Promise<SafetyCaseView> {
  assertPermission(input.actor.role, "safety.raise");

  // Tolerant load: a missing city config must not swallow an SOS. What it costs
  // is the SLA clock and the emergency number, and the case says so out loud.
  const attempt = await deps.config.tryLoadForSupport(input.cityId);
  const policy: SupportPolicy | null = attempt.ok ? attempt.config.policy : null;
  const severity: SafetySeverity = severityForTrigger(policy, input.trigger);
  const now = deps.now();
  const slaDue =
    policy === null
      ? null
      : new Date(now.getTime() + safetySlaMinutes(policy, severity) * 60_000);
  const emergencyNumber = attempt.ok ? attempt.config.city.emergencyNumber : null;
  const configStatus = attempt.ok ? "ok" : `unavailable:${attempt.reason}`;

  const scoped = scopedIdempotencyKey(
    "safety.sos",
    input.actor.id,
    input.idempotencyKey,
  );
  const caseId = deterministicId("sfc", scoped);

  const replay = await deps.db.safetyCase.findUnique({ where: { id: caseId } });
  if (replay !== null) {
    return safetyView(replay, input.actor.role, now);
  }

  const locationJson: JsonRecord | null =
    input.location === null
      ? null
      : {
          lat: input.location.lat,
          lng: input.location.lng,
          accuracyMeters: input.location.accuracyMeters,
          at: input.location.at ?? now.toISOString(),
          source: "reporter_device",
        };

  let view: SafetyCaseView;
  try {
    view = await auditedTransaction(deps.db, async (tx) => {
      // Trip context comes from the same outbox stream live ops reads, so the
      // responder sees what the ride console sees.
      const lastRideEvent =
        input.rideId === null
          ? null
          : await tx.outboxEvent.findFirst({
              where: { aggregateType: "ride", aggregateId: input.rideId },
              orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
            });
      const tripContext: JsonRecord | null =
        lastRideEvent === null
          ? null
          : {
              lastEvent: lastRideEvent.name,
              lastEventAt: lastRideEvent.occurredAt.toISOString(),
              version: lastRideEvent.toVersion,
            };

      const delivery: DeliveryState = {
        status: "pending",
        attempts: 0,
        nextAttemptAt: now.toISOString(),
        deliveredChannel: null,
        lastError: null,
      };

      const timeline: SafetyTimeline = {
        trigger: input.trigger,
        raisedByType: actorTypeFor(input.actor.role),
        cityId: input.cityId,
        rideId: input.rideId,
        emergencyNumber,
        configStatus,
        location: locationJson,
        tripContext,
        rideHoldRequested: input.rideId !== null,
        delivery,
        entries: [
          {
            at: now.toISOString(),
            kind: "sos.raised",
            actor: input.actor.id,
            detail: { trigger: input.trigger, note: input.note },
          },
        ],
      };

      const created = await tx.safetyCase.create({
        data: {
          id: caseId,
          rideId: input.rideId,
          raisedBy: input.actor.id,
          severity,
          status: "open",
          slaDue,
          responder: null,
          timeline: timelineToJson(timeline) as never,
        },
      });

      const actorType = actorTypeFor(input.actor.role);
      const lastLocation: JsonValue =
        locationJson === null
          ? null
          : { lat: locationJson.lat ?? null, lng: locationJson.lng ?? null };

      const events: OutboxInput[] = [
        {
          name: "safety.sos_raised",
          aggregateType: "case",
          aggregateId: caseId,
          fromVersion: null,
          toVersion: 1,
          actor: input.actor,
          actorType,
          cityId: input.cityId,
          idempotencyKey: `safety.sos_raised:${caseId}`,
          correlationId: input.correlationId,
          occurredAt: now,
          payload: {
            caseId,
            rideId: input.rideId,
            severity,
            trigger: input.trigger,
            lastLocation,
          },
        },
        {
          name: "incident.created",
          aggregateType: "case",
          aggregateId: caseId,
          fromVersion: null,
          toVersion: 1,
          actor: input.actor,
          actorType,
          cityId: input.cityId,
          idempotencyKey: `incident.created:${caseId}`,
          correlationId: input.correlationId,
          occurredAt: now,
          payload: {
            caseId,
            rideId: input.rideId,
            severity,
            slaDueAt: slaDue === null ? null : slaDue.toISOString(),
          },
        },
      ];

      if (input.rideId !== null) {
        // The ride aggregate belongs to ride-service. The hold is requested the
        // way every cross-service state change is made: through the outbox, in
        // the same transaction as the incident.
        events.push({
          name: "ride.safety_hold",
          aggregateType: "ride",
          aggregateId: input.rideId,
          fromVersion: null,
          toVersion: 1,
          actor: input.actor,
          actorType,
          cityId: input.cityId,
          idempotencyKey: `ride.safety_hold:${caseId}`,
          correlationId: input.correlationId,
          occurredAt: now,
          payload: {
            rideId: input.rideId,
            caseId,
            severity,
            lastLocation,
          },
        });
      }

      return {
        result: safetyView(created, input.actor.role, now),
        audit: {
          actor: input.actor,
          action: "safety.sos.raised",
          subjectType: "safety_case",
          subjectId: caseId,
          reason: `SOS raised by ${input.trigger}`,
          before: null,
          after: {
            severity,
            rideId: input.rideId,
            slaDueAt: slaDue === null ? null : slaDue.toISOString(),
            configStatus,
            rideHoldRequested: input.rideId !== null,
          },
          correlationId: input.correlationId,
        },
        events,
      };
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await deps.db.safetyCase.findUnique({ where: { id: caseId } });
      if (existing !== null) {
        return safetyView(existing, input.actor.role, now);
      }
    }
    throw error;
  }

  // The incident is committed. Everything from here is best effort and can
  // never take it away.
  const delivered = await attemptDelivery(deps, caseId);
  return { ...view, delivery: delivered ?? view.delivery };
}

// ---------------------------------------------------------------------------
// Notification delivery, retry and the sweep
// ---------------------------------------------------------------------------

const CHANNEL_ORDER = ["push", "sms"] as const;

/**
 * Tries push, then SMS. Returns the delivery state it wrote back, or null if the
 * case has gone away. Never throws: an SOS that cannot be delivered is still an
 * SOS that exists, is queued, and is escalated when the attempts run out.
 */
export async function attemptDelivery(
  deps: SupportDeps,
  caseId: string,
): Promise<DeliveryState | null> {
  const row = await deps.db.safetyCase.findUnique({ where: { id: caseId } });
  if (row === null) {
    return null;
  }
  const timeline = asTimeline(row.timeline);
  if (timeline === null || timeline.delivery.status === "delivered") {
    return timeline?.delivery ?? null;
  }

  const attempt = await deps.config.tryLoadForSupport(timeline.cityId);
  const policy = attempt.ok ? attempt.config.policy : null;

  const alert: SafetyAlert = {
    caseId,
    severity: (row.severity as SafetySeverity) ?? "critical",
    cityId: timeline.cityId,
    audience: [
      { userType: "agent", userId: "trust_and_safety_queue" },
      { userType: timeline.raisedByType, userId: row.raisedBy },
    ],
    emergencyNumber: timeline.emergencyNumber,
    rideId: row.rideId,
  };

  let lastError: string | null = null;
  for (const channel of CHANNEL_ORDER) {
    try {
      await deps.notifier.deliver(channel, alert);
      return persistDelivery(deps.db, caseId, timeline, {
        status: "delivered",
        attempts: timeline.delivery.attempts + 1,
        nextAttemptAt: null,
        deliveredChannel: channel,
        lastError: null,
      });
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : `channel ${channel} failed`;
      safetyLogger.error(
        { caseId, channel },
        "safety notification channel failed; falling through",
      );
    }
  }

  const attempts = timeline.delivery.attempts + 1;
  const maxAttempts = policy?.sosMaxDeliveryAttempts ?? 1;
  const exhausted = attempts >= maxAttempts;
  const backoff = policy === null ? 60 : sosBackoffSeconds(policy, attempts);
  const nextAttemptAt = exhausted
    ? null
    : new Date(deps.now().getTime() + backoff * 1000).toISOString();

  const state = await persistDelivery(
    deps.db,
    caseId,
    timeline,
    {
      status: exhausted ? "exhausted" : "pending",
      attempts,
      nextAttemptAt,
      deliveredChannel: null,
      lastError,
    },
    exhausted,
  );
  return state;
}

async function persistDelivery(
  db: SupportDb,
  caseId: string,
  timeline: SafetyTimeline,
  delivery: DeliveryState,
  escalate = false,
): Promise<DeliveryState> {
  const entry: JsonRecord = {
    at: new Date().toISOString(),
    kind:
      delivery.status === "delivered"
        ? "notification.delivered"
        : delivery.status === "exhausted"
          ? "notification.exhausted"
          : "notification.failed",
    actor: "system",
    detail: {
      attempts: delivery.attempts,
      channel: delivery.deliveredChannel,
      nextAttemptAt: delivery.nextAttemptAt,
    },
  };
  const next: SafetyTimeline = {
    ...timeline,
    delivery,
    entries: [...timeline.entries, entry],
  };
  // Delivery attempts have no human actor, so they are recorded on the case —
  // which is what the responder queue reads — rather than in audit_log, which
  // answers "who did what and why".
  await db.safetyCase.update({
    where: { id: caseId },
    data: {
      timeline: timelineToJson(next) as never,
      // An SOS nobody could be told about is escalated, never quietly dropped.
      ...(escalate ? { status: "escalated" } : {}),
    },
  });
  return delivery;
}

interface PendingRow {
  id: string;
}

/**
 * Retries every SOS whose notification is still pending and due. Runs on a
 * timer in `src/index.ts` and is called directly by the tests.
 */
export async function sweepPendingDeliveries(
  deps: SupportDeps,
  limit = 50,
): Promise<number> {
  const now = deps.now();
  const rows = await deps.db.$queryRaw<PendingRow[]>`
    SELECT id FROM safety_cases
    WHERE timeline -> 'delivery' ->> 'status' = 'pending'
      AND (timeline -> 'delivery' ->> 'nextAttemptAt') IS NOT NULL
      AND (timeline -> 'delivery' ->> 'nextAttemptAt')::timestamptz <= ${now}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;
  let handled = 0;
  for (const row of rows) {
    await attemptDelivery(deps, row.id);
    handled += 1;
  }
  return handled;
}

// ---------------------------------------------------------------------------
// The queue and responder actions
// ---------------------------------------------------------------------------

export interface SafetyQueueFilter {
  readonly status?: string | undefined;
  readonly severity?: string | undefined;
  readonly limit: number;
}

export async function listSafetyCases(
  deps: SupportDeps,
  actor: Actor,
  filter: SafetyQueueFilter,
): Promise<readonly SafetyCaseView[]> {
  // Safety evidence stays with Trust & Safety (CLAUDE.md #6): a support agent
  // has no route into this queue at all.
  assertPermission(actor.role, "safety.read");
  const now = deps.now();
  const rows = await deps.db.safetyCase.findMany({
    where: {
      ...(filter.status === undefined ? {} : { status: filter.status }),
      ...(filter.severity === undefined ? {} : { severity: filter.severity }),
    },
    orderBy: [{ slaDue: "asc" }, { createdAt: "desc" }],
    take: filter.limit,
  });
  return rows.map((row) => safetyView(row, actor.role, now));
}

export interface ResponderActionInput {
  readonly actor: Actor;
  readonly caseId: string;
  readonly action: ResponderAction;
  readonly note: string | null;
  readonly correlationId: string | null;
}

export async function respond(
  deps: SupportDeps,
  input: ResponderActionInput,
): Promise<SafetyCaseView> {
  assertPermission(input.actor.role, "safety.respond");
  const row = await deps.db.safetyCase.findUnique({ where: { id: input.caseId } });
  if (row === null) {
    throw new ContractError("not_found", "no such safety case", {
      caseId: input.caseId,
    });
  }
  if (!isSafetyStatus(row.status)) {
    throw new ContractError("illegal_transition", "the case is in an unknown state", {
      status: row.status,
    });
  }
  const target = ACTION_TARGET[input.action];
  if (!actionsFor(row.status).includes(input.action)) {
    throw new ContractError(
      "illegal_transition",
      `${input.action} is not available from ${row.status}`,
      { status: row.status, allowed: [...actionsFor(row.status)] },
    );
  }

  const now = deps.now();
  const timeline = asTimeline(row.timeline);

  return auditedTransaction(deps.db, async (tx) => {
    const entry: JsonRecord = {
      at: now.toISOString(),
      kind: `responder.${input.action}`,
      actor: input.actor.id,
      detail: { note: input.note },
    };
    const nextTimeline =
      timeline === null
        ? null
        : timelineToJson({ ...timeline, entries: [...timeline.entries, entry] });

    const updated = await tx.safetyCase.update({
      where: { id: input.caseId },
      data: {
        ...(target === null ? {} : { status: target }),
        responder: row.responder ?? input.actor.id,
        ...(nextTimeline === null ? {} : { timeline: nextTimeline as never }),
      },
    });

    return {
      result: safetyView(updated, input.actor.role, now),
      audit: {
        actor: input.actor,
        action: `safety.responder.${input.action}`,
        subjectType: "safety_case",
        subjectId: input.caseId,
        reason: input.note ?? `responder action ${input.action}`,
        before: { status: row.status, responder: row.responder },
        after: { status: target ?? row.status, responder: row.responder ?? input.actor.id },
        correlationId: input.correlationId,
      },
    };
  });
}
