/**
 * The review status moves that must happen AT MOST ONCE, shared by the travel
 * and the marketplace confirm paths.
 *
 * Reading a review's status and then updating it by id is not enough: two
 * confirms under different idempotency keys can both read
 * `awaiting_confirmation` before either commits, and both updates would then
 * land — two executions for one approval. Each move below is a single
 * conditional UPDATE on the status it leaves, so under concurrency exactly one
 * transaction moves the row; the other sees nothing to move and is refused
 * (its transaction rolls back with everything it wrote).
 */
import { ContractError } from "@ubi/contracts";

import type { AskTx } from "./types";

/** awaiting_confirmation → executing, bound to its grant; refuses if raced. */
export async function moveReviewToExecuting(
  tx: AskTx,
  reviewId: string,
  grantId: string,
): Promise<void> {
  const moved = await tx.askReview.updateMany({
    where: { id: reviewId, status: "awaiting_confirmation" },
    data: { status: "executing", grantId },
  });
  if (moved.count !== 1) {
    // A concurrent confirm won the race; refuse this one rather than double-run.
    throw new ContractError(
      "conflict",
      "this review is no longer awaiting confirmation",
    );
  }
}

/**
 * awaiting_confirmation → superseded. True when this call moved it; false when
 * the review had already left `awaiting_confirmation` (e.g. a concurrent
 * confirm moved it to executing), which is then left exactly as it is.
 */
export async function supersedeIfAwaiting(
  tx: AskTx,
  reviewId: string,
): Promise<boolean> {
  const moved = await tx.askReview.updateMany({
    where: { id: reviewId, status: "awaiting_confirmation" },
    data: { status: "superseded" },
  });
  return moved.count === 1;
}
