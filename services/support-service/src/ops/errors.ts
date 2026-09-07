/**
 * Mapping foreign errors onto the canonical contract codes.
 *
 * Clients branch on `code`, never on a message, so an illegal state transition
 * raised by @ubi/contracts and a unique-index collision raised by Postgres both
 * have to arrive as a `ContractError` with the code the contract names.
 */
import {
  ContractError,
  IllegalTransitionError,
  UnknownStateError,
} from "@ubi/contracts";

export function toContractError(error: unknown): ContractError {
  if (error instanceof ContractError) {
    return error;
  }
  if (error instanceof IllegalTransitionError) {
    return new ContractError("illegal_transition", error.message, {
      machine: error.machine,
      from: error.from,
      to: error.to,
      allowed: [...error.allowed],
    });
  }
  if (error instanceof UnknownStateError) {
    return new ContractError("illegal_transition", error.message, {
      machine: error.machine,
      state: error.state,
    });
  }
  return new ContractError("internal_error", "something went wrong handling that request");
}

/**
 * True when Postgres refused the write because a row with that key already
 * exists. The deterministic primary keys in this service make that the signal
 * that a request is a replay, not a failure (CLAUDE.md #3).
 */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; meta?: { target?: unknown } };
  if (candidate.code !== "P2002") {
    return false;
  }
  if (field === undefined) {
    return true;
  }
  const target = candidate.meta?.target;
  const fields = Array.isArray(target)
    ? target.map((entry) => String(entry))
    : typeof target === "string"
      ? [target]
      : [];
  return fields.some((entry) => entry.includes(field));
}
