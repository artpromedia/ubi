/**
 * Audit trail for identity decisions (CLAUDE.md #2).
 *
 * Every device enrolment, step-up result, safe-mode change, PIN lock, document
 * decision and identity-case ruling writes one of these rows INSIDE the same
 * transaction as the change. If the change rolls back so does its audit record,
 * and there is no path that changes identity state without leaving one.
 *
 * `before` / `after` hold state, never PII: no phone numbers, no selfie, no
 * document contents (CLAUDE.md #7, #12).
 */
import type { Prisma } from "@prisma/client";

import { newId } from "./ids";

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
