/**
 * Consuming an action grant (CLAUDE.md #18).
 *
 * Minting is user-service's authority (see ports/grant-port.ts); *spending* is
 * enforced here, once, atomically. `consumeGrant` marks the grant used with a
 * single conditional UPDATE: it only succeeds while the grant is unconsumed and
 * unexpired, so a replayed grant and an expired grant are both rejected by the
 * database, not by a read-then-write race. The model has no path to this: a grant
 * is consumed only inside an execution the user themselves confirmed.
 */
import { ContractError } from "@ubi/contracts";

import type { AskTx } from "./types";

export type GrantConsumeReason = "not_found" | "already_consumed" | "expired";

export class GrantConsumeError extends ContractError {
  constructor(readonly reason: GrantConsumeReason) {
    super(
      reason === "not_found" ? "not_found" : "conflict",
      reason === "not_found"
        ? "no such action grant"
        : reason === "already_consumed"
          ? "this action grant has already been used"
          : "this action grant has expired",
      { reason },
    );
    this.name = "GrantConsumeError";
  }
}

/**
 * Atomically marks the grant consumed. Throws `GrantConsumeError` if it does not
 * exist, was already consumed, or has expired. The optional term checks refuse a
 * grant that does not match the review it is being spent against.
 */
export async function consumeGrant(
  tx: AskTx,
  grantId: string,
  now: Date,
  expected?: {
    readonly totalMinor: number;
    readonly currency: string;
    readonly termsVersion: string;
  },
): Promise<void> {
  const updated = await tx.actionGrant.updateMany({
    where: { id: grantId, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });
  if (updated.count === 1) {
    if (expected !== undefined) {
      const row = await tx.actionGrant.findUnique({ where: { id: grantId } });
      if (
        row !== null &&
        (Number(row.totalMinor) !== expected.totalMinor ||
          row.currency !== expected.currency ||
          row.termsVersion !== expected.termsVersion)
      ) {
        // The grant does not authorise these terms; refuse and roll back.
        throw new ContractError(
          "conflict",
          "the grant does not match the confirmed terms",
          { reason: "terms_mismatch" },
        );
      }
    }
    return;
  }
  const row = await tx.actionGrant.findUnique({ where: { id: grantId } });
  if (row === null) {
    throw new GrantConsumeError("not_found");
  }
  if (row.consumedAt !== null) {
    throw new GrantConsumeError("already_consumed");
  }
  throw new GrantConsumeError("expired");
}
