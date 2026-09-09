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
 * Allowance reservation is a single guarded UPDATE. Concurrent runs of the same
 * mandate serialise on that one row and re-check the caps against the latest
 * committed values, so the period cap and run count can never be exceeded no
 * matter how many runs fire at once.
 */
import type { ActionGrant, Mandate, MandateExecution, Prisma } from "@prisma/client";
import { ContractError } from "@ubi/contracts";
import { randomBytes } from "node:crypto";

import type { Tx } from "../identity/audit";
import { writeAudit } from "../identity/audit";
import { insertGrant } from "../grants/grants";
import { newId } from "../identity/ids";
import { eventIdempotencyKey, writeOutboxEvent } from "../identity/outbox";
import type { AiActionDeps } from "../grants/types";
import { currentPeriodStart } from "./mandates";
import { isMandateAction, type MandateRunInput } from "./schemas";
import { isoDate, runResultView, type RunResultView } from "./serialize";
import { guardTransition } from "./transition";

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
  if (!Array.isArray(value)) return [];
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
  if (mandate.status === "paused") return "mandate_paused";
  if (mandate.status === "revoked") return "mandate_revoked";
  if (mandate.status === "expired") return "mandate_expired";
  if (!isMandateAction(mandate.action)) return "action_not_allowed";

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
 * Atomically reserves one run's worth of allowance for the period. The guarded
 * UPDATE both increments and re-checks the caps under the row lock, so it
 * returns true only if the reservation still fits after any concurrent run.
 */
async function reserveAllowance(
  tx: Tx,
  mandateId: string,
  periodStartStr: string,
  priceMinor: number,
  periodRuns: number,
  periodCapMinor: bigint,
): Promise<boolean> {
  await tx.$executeRaw`
    INSERT INTO mandate_allowances (mandate_id, period_start, amount_used_minor, runs_used)
    VALUES (${mandateId}, ${periodStartStr}::date, 0, 0)
    ON CONFLICT (mandate_id, period_start) DO NOTHING`;

  const reserved = await tx.$queryRaw<{ runs_used: number }[]>`
    UPDATE mandate_allowances
    SET amount_used_minor = amount_used_minor + ${BigInt(priceMinor)},
        runs_used = runs_used + 1
    WHERE mandate_id = ${mandateId}
      AND period_start = ${periodStartStr}::date
      AND runs_used + 1 <= ${periodRuns}
      AND amount_used_minor + ${BigInt(priceMinor)} <= ${periodCapMinor}
    RETURNING runs_used`;

  return reserved.length > 0;
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
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export async function runMandate(
  deps: AiActionDeps,
  mandateId: string,
  input: MandateRunInput,
): Promise<RunResultView> {
  const now = deps.now();
  const triggeredBy = input.triggeredBy ?? "mandate-runner";
  const periodStartStr = isoDate(currentPeriodStart(now));

  const load = await deps.prisma.mandate.findUnique({ where: { id: mandateId } });
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

        const reserved = await reserveAllowance(
          tx,
          mandateId,
          periodStartStr,
          input.price.amountMinor,
          mandate.periodRuns,
          mandate.periodCapMinor,
        );
        if (!reserved) {
          const blocked = await recordBlocked(
            tx,
            mandate,
            input,
            "allowance_exhausted",
          );
          return runResultView(blocked, null, false);
        }

        const grant = await mintRunGrant(tx, mandate, input, now, triggeredBy);
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

  return insertGrant(
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
