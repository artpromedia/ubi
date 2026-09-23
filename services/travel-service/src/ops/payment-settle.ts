/**
 * Travel money postings that CONVERGE instead of guessing.
 *
 * ONE KEY SCHEME. Every posting for an order uses a key derived from the order
 * id alone — `<orderId>:auth`, `<orderId>:cap`, `<orderId>:rel` — whichever
 * path makes it: checkout, reconcile, a webhook, ops. payment-service keys
 * each travel item on the order and treats a same-key repeat as a replay, so
 * a capture that checkout made (or may have made) and a later webhook capture
 * are the SAME posting. Before this, checkout captured under
 * `<itemKey>:cap` and reconcile/webhooks under `<orderId>:cap`: a capture that
 * landed but lost its response could never be repeated by reconcile — the
 * second key read as a second capture and was refused forever.
 *
 * CONVERGENCE. When a posting times out, comes back 5xx, or is refused with a
 * 409, the outcome is read from payment-service (`status()`) rather than
 * assumed:
 *  - the op is already recorded FOR THIS AMOUNT → its recorded result is the
 *    answer (a hold or capture of a different amount — e.g. a 409
 *    `idempotency_key_reuse` after a crash and a reprice — is a contradiction,
 *    never adopted as if it were this posting);
 *  - the op provably did not happen and the failure was ambiguous → one
 *    retry under the SAME key (idempotent by construction);
 *  - the recorded state contradicts the op (capture of a released hold,
 *    release of a captured one) → a `conflict` naming the payment state, for
 *    ops — never a second movement of money.
 */
import { ContractError, money } from "@ubi/contracts";

import { paymentLogger } from "../lib/logger";
import {
  isAmbiguousPaymentError,
  isConflictPaymentError,
  type PaymentRequest,
  type PaymentResult,
  type PaymentStatus,
} from "../ports/payment-port";

import type { TravelDeps } from "./context";

export type SettleOp = "authorize" | "capture" | "release";

/** The one idempotency key scheme for an order's postings. */
export function paymentKeys(
  orderId: string,
): Readonly<Record<SettleOp, string>> {
  return {
    authorize: `${orderId}:auth`,
    capture: `${orderId}:cap`,
    release: `${orderId}:rel`,
  };
}

type Converged =
  | { readonly kind: "done"; readonly result: PaymentResult }
  | { readonly kind: "absent" }
  | { readonly kind: "contradiction"; readonly paymentState: string };

function recordedRef(status: PaymentStatus, op: SettleOp): string | null {
  const recorded = status.ops.filter((entry) => entry.op === op);
  return recorded[recorded.length - 1]?.ref ?? null;
}

function converge(
  op: SettleOp,
  status: PaymentStatus | null,
  request: PaymentRequest,
): Converged {
  if (status === null) {
    return op === "authorize"
      ? { kind: "absent" }
      : { kind: "contradiction", paymentState: "no_authorization" };
  }
  const item = status.item;
  const currency = request.amount.currency;
  const wanted = request.amount.amountMinor;
  if (item.authorized.currency !== currency) {
    // Never re-denominated: a record in another currency is not this posting.
    return { kind: "contradiction", paymentState: "currency_mismatch" };
  }
  if (op === "authorize") {
    // A recorded authorization is this posting only when it holds exactly the
    // amount asked for and is still a live hold. A 409 `idempotency_key_reuse`
    // (the same key with different money terms) or a hold that was already
    // captured / released must never read as "authorized" for this amount.
    if (item.state !== "authorized") {
      return { kind: "contradiction", paymentState: item.state };
    }
    if (item.authorized.amountMinor !== wanted) {
      return { kind: "contradiction", paymentState: "authorized_other_amount" };
    }
    return {
      kind: "done",
      result: {
        ref: recordedRef(status, "authorize") ?? item.itemId,
        entryId: null,
        amount: money(item.authorized.amountMinor, currency),
        replayed: true,
      },
    };
  }
  if (op === "capture") {
    if (item.state === "authorized") {
      return { kind: "absent" };
    }
    if (item.state === "released") {
      return { kind: "contradiction", paymentState: item.state };
    }
    if (item.captured.amountMinor !== wanted) {
      // Captured, but not this amount: ops territory, never a second posting.
      return { kind: "contradiction", paymentState: "captured_other_amount" };
    }
    return {
      kind: "done",
      result: {
        ref: recordedRef(status, "capture") ?? item.itemId,
        entryId: item.captureEntryId,
        amount: money(item.captured.amountMinor, currency),
        replayed: true,
      },
    };
  }
  // release
  if (item.state === "authorized") {
    return { kind: "absent" };
  }
  if (item.state === "released") {
    return {
      kind: "done",
      result: {
        ref: recordedRef(status, "release") ?? item.itemId,
        entryId: null,
        amount: money(item.authorized.amountMinor, currency),
        replayed: true,
      },
    };
  }
  return { kind: "contradiction", paymentState: item.state };
}

/**
 * Posts `op` for the order under its canonical key, converging through
 * `status()` on an ambiguous or 409 answer. The request's own key is replaced
 * by the canonical one, so no caller can drift from the scheme.
 */
export async function settlePayment(
  deps: TravelDeps,
  op: SettleOp,
  input: Omit<PaymentRequest, "idempotencyKey">,
): Promise<PaymentResult> {
  const request: PaymentRequest = {
    ...input,
    idempotencyKey: paymentKeys(input.orderId)[op],
  };
  try {
    return await deps.payment[op](request);
  } catch (error) {
    const ambiguous = isAmbiguousPaymentError(error);
    if (!ambiguous && !isConflictPaymentError(error)) {
      throw error;
    }
    let status: PaymentStatus | null;
    try {
      status = await deps.payment.status(request.orderId);
    } catch (statusError) {
      paymentLogger.error(
        { err: statusError, op, orderId: request.orderId },
        "payment status unreadable after an unresolved posting; outcome still unknown",
      );
      throw error;
    }
    const converged = converge(op, status, request);
    if (converged.kind === "done") {
      paymentLogger.info(
        { op, orderId: request.orderId, ambiguous },
        "payment posting converged from payment-service's recorded state",
      );
      return converged.result;
    }
    if (converged.kind === "absent" && ambiguous) {
      // Provably not applied: repeat once under the SAME key.
      return deps.payment[op](request);
    }
    const paymentState =
      converged.kind === "contradiction"
        ? converged.paymentState
        : (status?.item.state ?? "none");
    throw new ContractError(
      "conflict",
      `payment-service's record for this order does not allow a ${op}`,
      { op, orderId: request.orderId, paymentState, converged: false },
    );
  }
}
