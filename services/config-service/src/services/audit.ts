/**
 * Audit trail. Every write that changes config or flags carries one of these
 * rows, written inside the same transaction as the change itself — if the
 * change rolls back, so does its audit record.
 */
import type { Prisma } from "@prisma/client";

import { newId } from "../lib/ids";

export type Tx = Prisma.TransactionClient;

export interface AuditInput {
  readonly actorId: string;
  readonly actorRole: string;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly before?: Prisma.InputJsonValue | undefined;
  readonly after?: Prisma.InputJsonValue | undefined;
  readonly reason?: string | undefined;
}

export async function writeAudit(tx: Tx, input: AuditInput): Promise<string> {
  const id = newId("aud");
  await tx.auditLog.create({
    data: {
      id,
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      ...(input.before === undefined ? {} : { before: input.before }),
      ...(input.after === undefined ? {} : { after: input.after }),
      ...(input.reason === undefined ? {} : { reason: input.reason }),
    },
  });
  return id;
}

/**
 * How many times this subject has already been audited. Used to give flag
 * changes a monotonic revision number for the event envelope, since a flag rule
 * carries no version column of its own.
 */
export async function auditRevision(
  tx: Tx,
  subjectType: string,
  subjectId: string,
): Promise<number> {
  return tx.auditLog.count({ where: { subjectType, subjectId } });
}
