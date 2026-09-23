/**
 * A mandate run (slice NEW-01, CLAUDE.md #18).
 *
 * An external event (a flight cancellation, an inbound flight landing) asks a
 * mandate to act. The server revalidates the mandate from scratch, then — in
 * ONE transaction — atomically reserves the run's allowance for the period,
 * mints a transaction-specific grant, and records the execution. Revocation
 * stops future runs here; it never unwinds a booking a supplier already
 * accepted, because this step only authorises — the booking is a separate
 * order in travel-service that consumes the grant.
 *
 * Allowance reservation is the canonical `mandate_allowance_reserve` (see
 * ./allowance.ts): a single guarded UPDATE. Concurrent runs of the same mandate
 * serialise on that one row and re-check the caps against the latest committed
 * values, so the period cap and run count can never be exceeded no matter how
 * many runs fire at once. A run authorises its price outright, so the
 * reservation is committed in the same transaction that mints the grant.
 */
import { randomBytes } from "node:crypto";

import { ContractError } from "@ubi/contracts";

import { reserveAllowance, settleAllowance } from "./allowance";
import { currentPeriodStart } from "./mandates";
import { isRunnableMandateAction, type MandateRunInput } from "./schemas";
import { runResultView, type RunResultView } from "./serialize";
import { guardTransition } from "./transition";
import { insertGrant } from "../grants/grants";
import { writeAudit, type Tx } from "../identity/audit";
import { newId } from "../identity/ids";
import { eventIdempotencyKey, writeOutboxEvent } from "../identity/outbox";

import type { AiActionDeps } from "../grants/types";
import type {
  ActionGrant,
  Mandate,
  MandateExecution,
  Prisma,
} from "@prisma/client";

const DEFAULT_GRANT_TTL_SECONDS = 900;

/** Blocked-run reason codes. The contract's list is open-ended ("e.g. …"). */
type BlockReason =
  | "mandate_paused"
  | "mandate_revoked"
  | "mandate_expired"
  | "price_above_cap"
  | "constraint_ask"
  | "allowance_exhausted"
  | "action_not_allowed";

interface Constraint {
  readonly key: string;
  readonly mode: string;
}

function readConstraints(value: Prisma.JsonValue): Constraint[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: Constraint[] = [];
  for (const entry of value) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof (entry as { key?: unknown }).key === "string" &&
      typeof (entry as { mode?: unknown }).mode === "string"
    ) {
      out.push({
        key: (entry as { key: string }).key,
        mode: (entry as { mode: string }).mode,
      });
    }
  }
  return out;
}

function receiptRef(): string {
  return `AUT-${randomBytes(4).toString("hex").toUpperCase()}`;
}

function grantTtlSeconds(): number {
  const parsed = Number.parseInt(
    process.env.AI_GRANT_TTL_SECONDS ?? String(DEFAULT_GRANT_TTL_SECONDS),
    10,
  );
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_GRANT_TTL_SECONDS;
}

/**
 * The read-only gate: everything that can block a run before any allowance is
 * touched. Returns a reason to block on, or null to proceed to reservation.
 */
function preReserveBlock(
  mandate: Mandate,
  input: MandateRunInput,
): BlockReason | null {
  if (mandate.status === "paused") {
    return "mandate_paused";
  }
  if (mandate.status === "revoked") {
    return "mandate_revoked";
  }
  if (mandate.status === "expired") {
    return "mandate_expired";
  }
  // Only the travel actions are runnable by a trigger; a marketplace mandate
  // acts solely through ask-service's selection against a live offer.
  if (!isRunnableMandateAction(mandate.action)) {
    return "action_not_allowed";
  }

  if (input.price.amountMinor > Number(mandate.perRunCapMinor)) {
    return "price_above_cap";
  }

  if (
    mandate.maxPriceVarianceMinor !== null &&
    input.referenceMinor !== undefined &&
    input.price.amountMinor - input.referenceMinor >
      Number(mandate.maxPriceVarianceMinor)
  ) {
    return "price_above_cap";
  }

  const observed = new Set(input.conditions ?? []);
  for (const constraint of readConstraints(mandate.constraints)) {
    if (
      (constraint.mode === "ask" || constraint.mode === "always_ask") &&
      observed.has(constraint.key)
    ) {
      return "constraint_ask";
    }
  }

  return null;
}

/**
 * Maps a refused reservation to the run's block reason. The allowance function
 * re-checks status / expiry / per-run cap under the mandate row lock, so a
 * pause or revoke that landed after `preReserveBlock` read the row still blocks
 * the run with its own reason rather than as "exhausted".
 */
function reserveBlock(outcome: string): BlockReason {
  switch (outcome) {
    case "mandate_paused":
    case "mandate_revoked":
    case "mandate_expired":
      return outcome;
    case "price_above_cap":
      return "price_above_cap";
    default:
      return "allowance_exhausted";
  }
}

async function recordBlocked(
  tx: Tx,
  mandate: Mandate,
  input: MandateRunInput,
  reason: BlockReason,
): Promise<MandateExecution> {
  const executionId = newId("mex");
  guardTransition("mandateRun", "evaluated", "blocked");

  const exec = await tx.mandateExecution.create({
    data: {
      id: executionId,
      mandateId: mandate.id,
      triggerRef: input.triggerRef,
      outcome: "blocked",
      reasonCode: reason,
      amountMinor: BigInt(input.price.amountMinor),
      currency: input.price.currency,
      resultRef: input.resourceRef,
      summary: `Run blocked: ${reason}`,
    },
  });

  await writeAudit(tx, {
    actorId: input.triggeredBy ?? "mandate-runner",
    actorRole: "system",
    action: "mandate.run.blocked",
    subjectType: "mandate",
    subjectId: mandate.id,
    after: {
      executionId,
      triggerRef: input.triggerRef,
      reasonCode: reason,
    } satisfies Prisma.InputJsonValue,
  });

  await writeOutboxEvent(tx, {
    name: "mandate.run.evaluated",
    subjectType: "user",
    subjectId: mandate.userId,
    actorType: "system",
    actorId: input.triggeredBy ?? "mandate-runner",
    idempotencyKey: eventIdempotencyKey("mandate.run.evaluated", executionId),
    fromVersion: null,
    toVersion: 1,
    cityId: null,
    payload: {
      mandateId: mandate.id,
      executionId,
      triggerRef: input.triggerRef,
      amount: {
        amountMinor: input.price.amountMinor,
        currency: input.price.currency,
      },
    },
  });

  await writeOutboxEvent(tx, {
    name: "mandate.run.blocked",
    subjectType: "user",
    subjectId: mandate.userId,
    actorType: "system",
    actorId: input.triggeredBy ?? "mandate-runner",
    idempotencyKey: eventIdempotencyKey("mandate.run.blocked", executionId),
    fromVersion: 1,
    toVersion: 2,
    cityId: null,
    payload: {
      mandateId: mandate.id,
      executionId,
      reasonCode: reason,
      resultRef: input.resourceRef,
    },
  });

  return exec;
}

/** Expires a mandate whose time has passed, in the run's own transaction. */
async function expireMandate(
  tx: Tx,
  mandate: Mandate,
  triggeredBy: string,
): Promise<void> {
  guardTransition("mandate", mandate.status, "expired");
  await tx.mandate.update({
    where: { id: mandate.id },
    data: { status: "expired" },
  });
  await writeAudit(tx, {
    actorId: triggeredBy,
    actorRole: "system",
    action: "mandate.expired",
    subjectType: "mandate",
    subjectId: mandate.id,
    before: { status: mandate.status } satisfies Prisma.InputJsonValue,
    after: { status: "expired" } satisfies Prisma.InputJsonValue,
  });
  await writeOutboxEvent(tx, {
    name: "mandate.expired",
    subjectType: "user",
    subjectId: mandate.userId,
    actorType: "system",
    actorId: triggeredBy,
    idempotencyKey: eventIdempotencyKey("mandate.expired", mandate.id),
    fromVersion: null,
    toVersion: 1,
    cityId: null,
    payload: { mandateId: mandate.id, status: "expired" },
  });
}

function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const { code, meta } = error as { code?: unknown; meta?: unknown };
  if (code === "P2002") {
    return true;
  }
  // A collision inside the allowance function (a concurrent run of the same
  // trigger reserving first) surfaces as a raw-query error carrying 23505.
  return (
    code === "P2010" &&
    typeof meta === "object" &&
    meta !== null &&
    (meta as { code?: unknown }).code === "23505"
  );
}

export async function runMandate(
  deps: AiActionDeps,
  mandateId: string,
  input: MandateRunInput,
): Promise<RunResultView> {
  const now = deps.now();
  const triggeredBy = input.triggeredBy ?? "mandate-runner";

  const load = await deps.prisma.mandate.findUnique({
    where: { id: mandateId },
  });
  if (load === null) {
    throw new ContractError("not_found", "No such mandate");
  }

  try {
    return await deps.prisma.$transaction(
      async (tx) => {
        const existing = await tx.mandateExecution.findUnique({
          where: {
            mandateId_triggerRef: { mandateId, triggerRef: input.triggerRef },
          },
        });
        if (existing !== null) {
          const grant =
            existing.grantId === null
              ? null
              : await tx.actionGrant.findUnique({
                  where: { id: existing.grantId },
                });
          return runResultView(existing, grant, true);
        }

        const mandate = await tx.mandate.findUniqueOrThrow({
          where: { id: mandateId },
        });

        if (input.price.currency !== mandate.currency) {
          throw new ContractError(
            "validation_failed",
            "Run price currency does not match the mandate",
          );
        }

        // A mandate active only on paper but past its expiry is expired now,
        // and the run is blocked on that.
        if (
          mandate.status === "active" &&
          mandate.expiresAt.getTime() <= now.getTime()
        ) {
          await expireMandate(tx, mandate, triggeredBy);
          const blocked = await recordBlocked(
            tx,
            { ...mandate, status: "expired" },
            input,
            "mandate_expired",
          );
          return runResultView(blocked, null, false);
        }

        const preBlock = preReserveBlock(mandate, input);
        if (preBlock !== null) {
          const blocked = await recordBlocked(tx, mandate, input, preBlock);
          return runResultView(blocked, null, false);
        }

        const reservation = await reserveAllowance(tx, {
          reservationId: newId("mar"),
          idempotencyKey: `mandate:${mandate.id}:${input.triggerRef}`,
          mandateId,
          periodStart: currentPeriodStart(now),
          amountMinor: input.price.amountMinor,
          currency: input.price.currency,
          grantId: null,
          now,
        });
        if (reservation.outcome === "replayed") {
          // A concurrent run of the same trigger committed first: its
          // reservation, grant and execution are the answer, never a second.
          const prior = await tx.mandateExecution.findUnique({
            where: {
              mandateId_triggerRef: { mandateId, triggerRef: input.triggerRef },
            },
          });
          if (prior !== null) {
            const grant =
              prior.grantId === null
                ? null
                : await tx.actionGrant.findUnique({
                    where: { id: prior.grantId },
                  });
            return runResultView(prior, grant, true);
          }
        }
        if (
          reservation.outcome !== "reserved" ||
          reservation.reservationId === null
        ) {
          const blocked = await recordBlocked(
            tx,
            mandate,
            input,
            reserveBlock(reservation.outcome),
          );
          return runResultView(blocked, null, false);
        }

        const grant = await mintRunGrant(tx, mandate, input, now, triggeredBy);
        // A run authorises its price outright: the reservation is spent now,
        // atomically with the grant it paid for.
        await settleAllowance(tx, {
          reservationId: reservation.reservationId,
          action: "commit",
          actualMinor: input.price.amountMinor,
          resultRef: grant.id,
          grantId: grant.id,
          now,
        });
        const executed = await recordExecuted(
          tx,
          mandate,
          input,
          grant,
          triggeredBy,
        );
        return runResultView(executed, grant, false);
      },
      { timeout: 20_000, maxWait: 20_000 },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      // A concurrent run with the same trigger won the race; return its result.
      const exec = await deps.prisma.mandateExecution.findUnique({
        where: {
          mandateId_triggerRef: { mandateId, triggerRef: input.triggerRef },
        },
      });
      if (exec !== null) {
        const grant =
          exec.grantId === null
            ? null
            : await deps.prisma.actionGrant.findUnique({
                where: { id: exec.grantId },
              });
        return runResultView(exec, grant, true);
      }
    }
    throw error;
  }
}

async function mintRunGrant(
  tx: Tx,
  mandate: Mandate,
  input: MandateRunInput,
  now: Date,
  triggeredBy: string,
): Promise<ActionGrant> {
  const expiresAt =
    input.grantExpiresAt !== undefined
      ? new Date(input.grantExpiresAt)
      : new Date(now.getTime() + grantTtlSeconds() * 1000);

  const grant = await insertGrant(
    tx,
    {
      actorId: mandate.userId,
      action: mandate.action,
      resourceRef: input.resourceRef,
      provider: input.provider ?? null,
      termsVersion: input.termsVersion,
      totalMinor: input.price.amountMinor,
      currency: input.price.currency,
      assurance: "mandate",
      mandateId: mandate.id,
      expiresAt,
      idempotencyKey: `mandate:${mandate.id}:${input.triggerRef}`,
    },
    { actorId: triggeredBy, cityId: null },
  );
  return grant;
}

async function recordExecuted(
  tx: Tx,
  mandate: Mandate,
  input: MandateRunInput,
  grant: ActionGrant,
  triggeredBy: string,
): Promise<MandateExecution> {
  const executionId = newId("mex");
  guardTransition("mandateRun", "evaluated", "executed");

  const exec = await tx.mandateExecution.create({
    data: {
      id: executionId,
      mandateId: mandate.id,
      triggerRef: input.triggerRef,
      outcome: "executed",
      grantId: grant.id,
      receiptRef: receiptRef(),
      resultRef: input.resourceRef,
      amountMinor: BigInt(input.price.amountMinor),
      currency: input.price.currency,
      summary: `Authorised ${mandate.action}`,
    },
  });

  await writeAudit(tx, {
    actorId: triggeredBy,
    actorRole: "system",
    action: "mandate.run.executed",
    subjectType: "mandate",
    subjectId: mandate.id,
    after: {
      executionId,
      triggerRef: input.triggerRef,
      grantId: grant.id,
    } satisfies Prisma.InputJsonValue,
  });

  await writeOutboxEvent(tx, {
    name: "mandate.run.evaluated",
    subjectType: "user",
    subjectId: mandate.userId,
    actorType: "system",
    actorId: triggeredBy,
    idempotencyKey: eventIdempotencyKey("mandate.run.evaluated", executionId),
    fromVersion: null,
    toVersion: 1,
    cityId: null,
    payload: {
      mandateId: mandate.id,
      executionId,
      triggerRef: input.triggerRef,
      amount: {
        amountMinor: input.price.amountMinor,
        currency: input.price.currency,
      },
    },
  });

  await writeOutboxEvent(tx, {
    name: "mandate.run.executed",
    subjectType: "user",
    subjectId: mandate.userId,
    actorType: "system",
    actorId: triggeredBy,
    idempotencyKey: eventIdempotencyKey("mandate.run.executed", executionId),
    fromVersion: 1,
    toVersion: 2,
    cityId: null,
    payload: {
      mandateId: mandate.id,
      executionId,
      grantId: grant.id,
      resultRef: input.resourceRef,
      amount: {
        amountMinor: input.price.amountMinor,
        currency: input.price.currency,
      },
    },
  });

  return exec;
}
