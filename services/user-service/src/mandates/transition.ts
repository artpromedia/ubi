/**
 * assertTransition throws the contract's own IllegalTransitionError /
 * UnknownStateError, which are not ContractErrors — so a route wrapper would
 * surface them as a 500. This adapts them to the canonical `illegal_transition`
 * ContractError (409) while keeping the contract as the single source of truth
 * for what moves are legal.
 */
import {
  assertTransition,
  ContractError,
  IllegalTransitionError,
  type MachineName,
  UnknownStateError,
} from "@ubi/contracts";

export function guardTransition(
  machine: MachineName,
  from: string,
  to: string,
): void {
  try {
    assertTransition(machine, from, to);
  } catch (error) {
    if (
      error instanceof IllegalTransitionError ||
      error instanceof UnknownStateError
    ) {
      throw new ContractError("illegal_transition", error.message, {
        machine,
        from,
        to,
      });
    }
    throw error;
  }
}
