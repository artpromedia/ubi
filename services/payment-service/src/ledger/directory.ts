/**
 * The recipient directory.
 *
 * The lookup exists so the sender sees who they are about to pay *before* the
 * PIN step (board 7b). It returns a display name and nothing else — no phone,
 * no email, no id beyond the one the transfer needs.
 *
 * `@tag` handles: the `users` table has no wallet tag column, so this directory
 * says plainly that tags are not available here rather than returning "no such
 * recipient" for a handle that may well exist. Honest unavailability beats a
 * silent dead end (CLAUDE.md #8).
 */
import { ContractError } from "@ubi/contracts";

import type { RecipientDirectory, RecipientMatch } from "./context";
import type { LedgerTx } from "./types";

const E164 = /^\+[1-9]\d{6,14}$/;

function displayNameOf(user: {
  readonly firstName: string;
  readonly lastName: string;
}): string {
  return `${user.firstName} ${user.lastName}`.trim();
}

export function createPrismaDirectory(db: LedgerTx): RecipientDirectory {
  return {
    async lookup(query: string): Promise<RecipientMatch> {
      const trimmed = query.trim();
      if (trimmed.startsWith("@")) {
        throw new ContractError(
          "validation_failed",
          "wallet tags are not available in this deployment; look the recipient up by phone number",
          { supported: ["phone"] },
        );
      }
      if (!E164.test(trimmed)) {
        throw new ContractError(
          "validation_failed",
          "enter the recipient's phone number in international format",
        );
      }
      const user = await db.user.findUnique({
        where: { phone: trimmed },
        select: { id: true, firstName: true, lastName: true, status: true, deletedAt: true },
      });
      if (user === null || user.deletedAt !== null || user.status !== "ACTIVE") {
        throw new ContractError("recipient_not_found", "no UBI account uses that number");
      }
      return { userId: user.id, displayName: displayNameOf(user) };
    },

    async byUserId(userId: string): Promise<RecipientMatch | null> {
      const user = await db.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, lastName: true, status: true, deletedAt: true },
      });
      if (user === null || user.deletedAt !== null || user.status !== "ACTIVE") {
        return null;
      }
      return { userId: user.id, displayName: displayNameOf(user) };
    },
  };
}
