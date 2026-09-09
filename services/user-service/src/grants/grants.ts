/**
 * Action grants (migration 010, CLAUDE.md #18).
 *
 * A grant is a SINGLE-USE authorisation to perform exactly one transactional
 * action, up to exactly one total, until exactly one moment. It is minted by
 * the server after a user confirms a review sheet (or a mandate run fires) and
 * consumed once by the service that actually books the supplier. The model can
 * never mint, extend or modify a grant — minting is service-to-service only.
 *
 *   MINT     idempotent on `idempotency_key`; a replay returns the original
 *            grant, even after it has expired or been consumed.
 *   CONSUME  atomic and single-use: `consumed_at` is set by one conditional
 *            UPDATE, so a second consume fails and an expired grant fails.
 *            Idempotent on the consume key: the same key replays the result.
 */
import type { ActionGrant, Prisma } from "@prisma/client";
import { ContractError, MoneySchema } from "@ubi/contracts";
import { z } from "zod";

import type { Tx } from "../identity/audit";
import { writeAudit } from "../identity/audit";
import { deterministicId } from "../identity/ids";
import {
  eventIdempotencyKey,
  findOutboxByIdempotencyKey,
  writeOutboxEvent,
} from "../identity/outbox";
import type { AiActionDeps } from "./types";

export const GRANT_ASSURANCES = ["pin", "biometric", "mandate"] as const;
export type GrantAssurance = (typeof GRANT_ASSURANCES)[number];

/**
 * The body ask-service / travel-service post to mint a grant. `total` is the
 * server-computed total of the confirmed review; `assurance` is the auth the
 * user cleared; `resourceRef` is the opaque reference to what is being booked.
 */
export const MintGrantSchema = z.object({
  actorId: z.string().min(1).max(128),
  action: z.string().min(1).max(120),
  resourceRef: z.string().min(1).max(200),
  provider: z.string().min(1).max(120).optional(),
  termsVersion: z.string().min(1).max(60),
  total: MoneySchema.extend({ amountMinor: z.number().int().min(0) }),
  assurance: z.enum(GRANT_ASSURANCES),
  mandateId: z.string().min(1).max(128).optional(),
  expiresAt: z.string().datetime({ offset: true }),
});
export type MintGrantBody = z.infer<typeof MintGrantSchema>;

export interface GrantView {
  readonly id: string;
  readonly actorId: string;
  readonly action: string;
  readonly resourceRef: string;
  readonly provider: string | null;
  readonly termsVersion: string;
  readonly total: { readonly amountMinor: number; readonly currency: string };
  readonly assurance: GrantAssurance;
  readonly mandateId: string | null;
  readonly expiresAt: string;
  readonly consumedAt: string | null;
  readonly createdAt: string;
}

export function grantToView(grant: ActionGrant): GrantView {
  return {
    id: grant.id,
    actorId: grant.actorId,
    action: grant.action,
    resourceRef: grant.resourceRef,
    provider: grant.provider,
    termsVersion: grant.termsVersion,
    total: { amountMinor: Number(grant.totalMinor), currency: grant.currency },
    assurance: grant.assurance as GrantAssurance,
    mandateId: grant.mandateId,
    expiresAt: grant.expiresAt.toISOString(),
    consumedAt: grant.consumedAt === null ? null : grant.consumedAt.toISOString(),
    createdAt: grant.createdAt.toISOString(),
  };
}

export interface InsertGrantInput {
  readonly actorId: string;
  readonly action: string;
  readonly resourceRef: string;
  readonly provider: string | null;
  readonly termsVersion: string;
  readonly totalMinor: number;
  readonly currency: string;
  readonly assurance: GrantAssurance;
  readonly mandateId: string | null;
  readonly expiresAt: Date;
  /** Unique across grants; a replay of the mint collides with its own write. */
  readonly idempotencyKey: string;
}

/** Who, in event terms, minted the grant (a service, never a person). */
export interface GrantEventActor {
  readonly actorId: string;
  readonly cityId: string | null;
}

/**
 * Writes the grant row, its audit line and the `action_grant.minted` outbox
 * event inside a caller-supplied transaction. Mandate runs use this directly so
 * the mint shares the run's atomicity; the standalone mint wraps it below.
 */
export async function insertGrant(
  tx: Tx,
  input: InsertGrantInput,
  event: GrantEventActor,
): Promise<ActionGrant> {
  const id = deterministicId("grn", input.idempotencyKey);
  const grant = await tx.actionGrant.create({
    data: {
      id,
      actorId: input.actorId,
      action: input.action,
      resourceRef: input.resourceRef,
      provider: input.provider,
      termsVersion: input.termsVersion,
      totalMinor: BigInt(input.totalMinor),
      currency: input.currency,
      idempotencyKey: input.idempotencyKey,
      assurance: input.assurance,
      mandateId: input.mandateId,
      expiresAt: input.expiresAt,
    },
  });

  await writeAudit(tx, {
    actorId: event.actorId,
    actorRole: "system",
    action: "action_grant.minted",
    subjectType: "action_grant",
    subjectId: id,
    after: {
      action: input.action,
      resourceRef: input.resourceRef,
      totalMinor: input.totalMinor,
      currency: input.currency,
      assurance: input.assurance,
      mandateId: input.mandateId,
    } satisfies Prisma.InputJsonValue,
  });

  await writeOutboxEvent(tx, {
    name: "action_grant.minted",
    subjectType: "user",
    subjectId: input.actorId,
    actorType: "system",
    actorId: event.actorId,
    idempotencyKey: eventIdempotencyKey("action_grant.minted", id),
    fromVersion: null,
    toVersion: 1,
    cityId: event.cityId,
    payload: {
      grantId: id,
      actorId: input.actorId,
      action: input.action,
      resourceRef: input.resourceRef,
      provider: input.provider,
      termsVersion: input.termsVersion,
      totalMinor: input.totalMinor,
      currency: input.currency,
      assurance: input.assurance,
      mandateId: input.mandateId,
      expiresAt: input.expiresAt.toISOString(),
    },
  });

  return grant;
}

export interface MintResult {
  readonly grant: GrantView;
  readonly replayed: boolean;
}

/**
 * Mints a grant for a confirmed review. Idempotent on `idempotencyKey`: a
 * replay returns the original grant unchanged (even once expired or consumed),
 * which is how a retried confirmation never mints a second authorisation.
 */
export async function mintGrant(
  deps: AiActionDeps,
  body: MintGrantBody,
  idempotencyKey: string,
): Promise<MintResult> {
  const now = deps.now();
  const expiresAt = new Date(body.expiresAt);

  return deps.prisma.$transaction(async (tx) => {
    // A replay returns the original grant untouched — even once it has expired.
    // The future-expiry check therefore only guards a genuinely new mint.
    const existing = await tx.actionGrant.findUnique({
      where: { idempotencyKey },
    });
    if (existing !== null) {
      return { grant: grantToView(existing), replayed: true };
    }

    if (expiresAt.getTime() <= now.getTime()) {
      throw new ContractError(
        "validation_failed",
        "A grant must expire in the future",
      );
    }

    const grant = await insertGrant(
      tx,
      {
        actorId: body.actorId,
        action: body.action,
        resourceRef: body.resourceRef,
        provider: body.provider ?? null,
        termsVersion: body.termsVersion,
        totalMinor: body.total.amountMinor,
        currency: body.total.currency,
        assurance: body.assurance,
        mandateId: body.mandateId ?? null,
        expiresAt,
        idempotencyKey,
      },
      { actorId: "user-service", cityId: null },
    );
    return { grant: grantToView(grant), replayed: false };
  });
}

export const ConsumeGrantSchema = z.object({
  /** The reservation/order the consuming service booked, for the receipt. */
  resultRef: z.string().min(1).max(200).optional(),
});
export type ConsumeGrantBody = z.infer<typeof ConsumeGrantSchema>;

export interface ConsumeResult {
  readonly grant: GrantView;
  readonly consumedAt: string;
  readonly replayed: boolean;
}

/**
 * Verifies a grant is live and consumes it, atomically. The single conditional
 * UPDATE is what makes it single-use: exactly one caller can flip `consumed_at`
 * from null while the grant is unexpired. A second consume with a fresh key
 * fails; a retry with the same consume key replays the original result.
 */
export async function consumeGrant(
  deps: AiActionDeps,
  grantId: string,
  body: ConsumeGrantBody,
  consumeKey: string,
): Promise<ConsumeResult> {
  const now = deps.now();
  const eventKey = eventIdempotencyKey("action_grant.consumed", consumeKey);

  return deps.prisma.$transaction(async (tx) => {
    const prior = await findOutboxByIdempotencyKey(tx, eventKey);
    if (prior !== undefined) {
      const grant = await tx.actionGrant.findUniqueOrThrow({
        where: { id: grantId },
      });
      return {
        grant: grantToView(grant),
        consumedAt:
          grant.consumedAt === null
            ? now.toISOString()
            : grant.consumedAt.toISOString(),
        replayed: true,
      };
    }

    const updated = await tx.actionGrant.updateMany({
      where: { id: grantId, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });

    if (updated.count === 0) {
      const grant = await tx.actionGrant.findUnique({ where: { id: grantId } });
      if (grant === null) {
        throw new ContractError("not_found", "No such grant");
      }
      if (grant.consumedAt !== null) {
        throw new ContractError(
          "conflict",
          "This grant has already been used",
          { reason: "already_consumed" },
        );
      }
      throw new ContractError("conflict", "This grant has expired", {
        reason: "grant_expired",
      });
    }

    const grant = await tx.actionGrant.findUniqueOrThrow({
      where: { id: grantId },
    });

    await writeAudit(tx, {
      actorId: "user-service",
      actorRole: "system",
      action: "action_grant.consumed",
      subjectType: "action_grant",
      subjectId: grantId,
      after: {
        consumedAt: now.toISOString(),
        resultRef: body.resultRef ?? null,
      } satisfies Prisma.InputJsonValue,
    });

    await writeOutboxEvent(tx, {
      name: "action_grant.consumed",
      subjectType: "user",
      subjectId: grant.actorId,
      actorType: "system",
      actorId: "user-service",
      idempotencyKey: eventKey,
      fromVersion: 1,
      toVersion: 2,
      cityId: null,
      payload: {
        grantId,
        actorId: grant.actorId,
        action: grant.action,
        resourceRef: grant.resourceRef,
        totalMinor: Number(grant.totalMinor),
        currency: grant.currency,
        consumedAt: now.toISOString(),
        resultRef: body.resultRef ?? null,
      },
    });

    return {
      grant: grantToView(grant),
      consumedAt: now.toISOString(),
      replayed: false,
    };
  });
}
