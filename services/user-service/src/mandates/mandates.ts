/**
 * Mandates (migration 010, slice NEW-01, CLAUDE.md #18-19).
 *
 * A mandate is a user-controlled standing authorisation for exactly one
 * ride/travel action, with hard caps the server enforces on every run. Creation
 * and revocation require assurance; the model can never create, edit, pause,
 * resume or revoke a mandate — these endpoints answer only to the gateway's
 * signed user identity.
 */
import type {
  Mandate,
  MandateAllowance,
  MandateExecution,
  Prisma,
} from "@prisma/client";
import { ContractError } from "@ubi/contracts";

import type { Tx } from "../identity/audit";
import { writeAudit } from "../identity/audit";
import { actorTypeFor, auditRevision } from "../identity/common";
import { deterministicId } from "../identity/ids";
import {
  eventIdempotencyKey,
  findOutboxByIdempotencyKey,
  writeOutboxEvent,
} from "../identity/outbox";
import type { AiActionDeps } from "../grants/types";
import type { Assurance, MandateInput, MandatePatch } from "./schemas";
import { isMandateAction } from "./schemas";
import { mandateToView, type MandateView } from "./serialize";
import { guardTransition } from "./transition";

/** UTC first-of-month for the period the given instant falls in. */
export function currentPeriodStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
}

/** Calendar-accurate 12-month bound, matching the DB's `interval '12 months'`. */
function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

export interface MandateActor {
  readonly userId: string;
  readonly role: string;
  readonly cityId: string | null;
}

/**
 * The invariants that hold for any mandate shape, on create and on edit: a
 * mandate-able action, one consistent currency, and an expiry inside the
 * 12-month window. Throws 422 rather than letting a DB CHECK surface as a 500.
 */
function validateInput(input: MandateInput, now: Date): void {
  if (!isMandateAction(input.action)) {
    throw new ContractError(
      "validation_failed",
      `${input.action} is not a mandate-able action`,
      { action: input.action, allowed: true },
    );
  }

  const currencies = new Set<string>([
    input.perRunCap.currency,
    input.periodCap.amount.currency,
  ]);
  if (input.maxPriceVariance !== undefined) {
    currencies.add(input.maxPriceVariance.currency);
  }
  if (currencies.size > 1) {
    throw new ContractError(
      "validation_failed",
      "All mandate amounts must share one currency",
    );
  }

  if (input.perRunCap.amountMinor > input.periodCap.amount.amountMinor) {
    throw new ContractError(
      "validation_failed",
      "The per-run cap cannot exceed the period cap",
    );
  }

  const expiresAt = new Date(input.expiresAt);
  if (expiresAt.getTime() <= now.getTime()) {
    throw new ContractError(
      "validation_failed",
      "A mandate must expire in the future",
    );
  }
  if (expiresAt.getTime() > addMonths(now, 12).getTime()) {
    throw new ContractError(
      "validation_failed",
      "A mandate can run for at most 12 months",
    );
  }
}

function requireAssurance(
  assurance: Assurance | undefined,
  op: string,
): Assurance {
  if (assurance === undefined) {
    throw new ContractError(
      "step_up_required",
      `${op} a mandate requires assurance (PIN or biometric)`,
    );
  }
  return assurance;
}

async function currentAllowance(
  tx: Tx,
  mandateId: string,
  now: Date,
): Promise<MandateAllowance | null> {
  return tx.mandateAllowance.findUnique({
    where: {
      mandateId_periodStart: {
        mandateId,
        periodStart: currentPeriodStart(now),
      },
    },
  });
}

async function lastRunAt(tx: Tx, mandateId: string): Promise<Date | null> {
  const latest = await tx.mandateExecution.findFirst({
    where: { mandateId },
    orderBy: { at: "desc" },
    select: { at: true },
  });
  return latest?.at ?? null;
}

async function viewOf(
  tx: Tx,
  mandate: Mandate,
  now: Date,
): Promise<MandateView> {
  const [allowance, latest] = await Promise.all([
    currentAllowance(tx, mandate.id, now),
    lastRunAt(tx, mandate.id),
  ]);
  return mandateToView(mandate, allowance, latest);
}

export interface CreateResult {
  readonly mandate: MandateView;
  readonly replayed: boolean;
}

export async function createMandate(
  deps: AiActionDeps,
  actor: MandateActor,
  input: MandateInput,
  assurance: Assurance | undefined,
  idempotencyKey: string,
): Promise<CreateResult> {
  const now = deps.now();
  requireAssurance(assurance, "Creating");
  validateInput(input, now);

  const id = deterministicId("mnd", actor.userId, idempotencyKey);

  return deps.prisma.$transaction(async (tx) => {
    const existing = await tx.mandate.findUnique({ where: { id } });
    if (existing !== null) {
      return { mandate: await viewOf(tx, existing, now), replayed: true };
    }

    const mandate = await tx.mandate.create({
      data: {
        id,
        userId: actor.userId,
        action: input.action,
        title: input.title,
        passengers: input.passengers,
        categories: input.categories,
        providers: input.providers ?? [],
        perRunCapMinor: BigInt(input.perRunCap.amountMinor),
        periodCapMinor: BigInt(input.periodCap.amount.amountMinor),
        periodRuns: input.periodCap.runs,
        maxPriceVarianceMinor:
          input.maxPriceVariance === undefined
            ? null
            : BigInt(input.maxPriceVariance.amountMinor),
        currency: input.perRunCap.currency,
        constraints: input.constraints as unknown as Prisma.InputJsonValue,
        status: "active",
        expiresAt: new Date(input.expiresAt),
        createdAt: now,
      },
    });

    await writeAudit(tx, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: "mandate.created",
      subjectType: "mandate",
      subjectId: id,
      after: {
        action: input.action,
        assurance: assurance?.method ?? null,
        status: "active",
      } satisfies Prisma.InputJsonValue,
    });

    await writeOutboxEvent(tx, {
      name: "mandate.created",
      subjectType: "user",
      subjectId: actor.userId,
      actorType: actorTypeFor(actor.role),
      actorId: actor.userId,
      idempotencyKey: eventIdempotencyKey("mandate.created", id),
      fromVersion: null,
      toVersion: 1,
      cityId: actor.cityId,
      payload: {
        mandateId: id,
        action: input.action,
        perRunCapMinor: input.perRunCap.amountMinor,
        periodCapMinor: input.periodCap.amount.amountMinor,
        periodRuns: input.periodCap.runs,
        currency: input.perRunCap.currency,
        expiresAt: new Date(input.expiresAt).toISOString(),
      },
    });

    return { mandate: await viewOf(tx, mandate, now), replayed: false };
  });
}

export async function listMandates(
  deps: AiActionDeps,
  userId: string,
): Promise<MandateView[]> {
  const now = deps.now();
  const mandates = await deps.prisma.mandate.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });
  const views: MandateView[] = [];
  for (const mandate of mandates) {
    const [allowance, latest] = await Promise.all([
      deps.prisma.mandateAllowance.findUnique({
        where: {
          mandateId_periodStart: {
            mandateId: mandate.id,
            periodStart: currentPeriodStart(now),
          },
        },
      }),
      deps.prisma.mandateExecution.findFirst({
        where: { mandateId: mandate.id },
        orderBy: { at: "desc" },
        select: { at: true },
      }),
    ]);
    views.push(mandateToView(mandate, allowance, latest?.at ?? null));
  }
  return views;
}

/** Loads a mandate the caller owns, or refuses. Ownership is by user id. */
async function ownedMandate(
  tx: Tx,
  userId: string,
  id: string,
): Promise<Mandate> {
  const mandate = await tx.mandate.findUnique({ where: { id } });
  if (mandate === null || mandate.userId !== userId) {
    throw new ContractError("not_found", "No such mandate");
  }
  return mandate;
}

const PATCH_EVENT: Readonly<
  Record<MandatePatch["op"], "mandate.edited" | "mandate.paused" | "mandate.resumed" | "mandate.revoked">
> = {
  edit: "mandate.edited",
  pause: "mandate.paused",
  resume: "mandate.resumed",
  revoke: "mandate.revoked",
};

export async function patchMandate(
  deps: AiActionDeps,
  actor: MandateActor,
  id: string,
  patch: MandatePatch,
  idempotencyKey: string,
): Promise<MandateView> {
  const now = deps.now();
  const eventName = PATCH_EVENT[patch.op];
  const eventKey = eventIdempotencyKey(eventName, id, idempotencyKey);

  return deps.prisma.$transaction(async (tx) => {
    const replay = await findOutboxByIdempotencyKey(tx, eventKey);
    if (replay !== undefined) {
      const mandate = await ownedMandate(tx, actor.userId, id);
      return viewOf(tx, mandate, now);
    }

    const mandate = await ownedMandate(tx, actor.userId, id);
    const revision = await auditRevision(tx, "mandate", id);

    let nextStatus = mandate.status;
    const update: Prisma.MandateUpdateInput = {};

    if (patch.op === "edit") {
      requireAssurance(patch.assurance, "Editing");
      if (patch.changes === undefined) {
        throw new ContractError(
          "validation_failed",
          "Editing a mandate requires the changed limits",
        );
      }
      if (mandate.status !== "active" && mandate.status !== "paused") {
        throw new ContractError(
          "conflict",
          `A ${mandate.status} mandate cannot be edited`,
        );
      }
      validateInput(patch.changes, now);
      const changes = patch.changes;
      update.action = changes.action;
      update.title = changes.title;
      update.passengers = changes.passengers;
      update.categories = changes.categories;
      update.providers = changes.providers ?? [];
      update.perRunCapMinor = BigInt(changes.perRunCap.amountMinor);
      update.periodCapMinor = BigInt(changes.periodCap.amount.amountMinor);
      update.periodRuns = changes.periodCap.runs;
      update.maxPriceVarianceMinor =
        changes.maxPriceVariance === undefined
          ? null
          : BigInt(changes.maxPriceVariance.amountMinor);
      update.currency = changes.perRunCap.currency;
      update.constraints =
        changes.constraints as unknown as Prisma.InputJsonValue;
      update.expiresAt = new Date(changes.expiresAt);
    } else {
      const transition =
        patch.op === "pause"
          ? "paused"
          : patch.op === "resume"
            ? "active"
            : "revoked";
      if (patch.op === "revoke") {
        requireAssurance(patch.assurance, "Revoking");
      }
      // The contract's mandate machine is the only source of legal moves.
      guardTransition("mandate", mandate.status, transition);
      nextStatus = transition;
      update.status = transition;
    }

    const updated = await tx.mandate.update({
      where: { id },
      data: update,
    });

    await writeAudit(tx, {
      actorId: actor.userId,
      actorRole: actor.role,
      action: eventName,
      subjectType: "mandate",
      subjectId: id,
      before: { status: mandate.status } satisfies Prisma.InputJsonValue,
      after: {
        status: nextStatus,
        op: patch.op,
        assurance: patch.assurance?.method ?? null,
      } satisfies Prisma.InputJsonValue,
    });

    await writeOutboxEvent(tx, {
      name: eventName,
      subjectType: "user",
      subjectId: actor.userId,
      actorType: actorTypeFor(actor.role),
      actorId: actor.userId,
      idempotencyKey: eventKey,
      fromVersion: revision,
      toVersion: revision + 1,
      cityId: actor.cityId,
      payload: {
        mandateId: id,
        op: patch.op,
        status: nextStatus,
      },
    });

    return viewOf(tx, updated, now);
  });
}

export async function listExecutions(
  deps: AiActionDeps,
  userId: string,
  id: string,
): Promise<MandateExecution[]> {
  await ownedMandate(deps.prisma, userId, id);
  return deps.prisma.mandateExecution.findMany({
    where: { mandateId: id },
    orderBy: { at: "desc" },
  });
}
