/**
 * Canonical state machines and the guard every service uses before it writes a
 * transition. The server is authoritative (CLAUDE.md #2): a transition that is
 * not in the contract is rejected, never coerced into something adjacent.
 */
import {
  MACHINES,
  type MachineName,
} from "./machines.generated";

export * from "./machines.generated";

export class IllegalTransitionError extends Error {
  readonly code = "illegal_transition";

  constructor(
    readonly machine: MachineName,
    readonly from: string,
    readonly to: string,
    readonly allowed: readonly string[],
  ) {
    super(
      `illegal ${machine} transition ${from} → ${to}; allowed from ${from}: ${
        allowed.length > 0 ? allowed.join(", ") : "(terminal)"
      }`,
    );
    this.name = "IllegalTransitionError";
  }
}

export class UnknownStateError extends Error {
  readonly code = "unknown_state";

  constructor(
    readonly machine: MachineName,
    readonly state: string,
  ) {
    super(`unknown ${machine} state "${state}"`);
    this.name = "UnknownStateError";
  }
}

function transitionsFor(machine: MachineName, from: string): readonly string[] {
  const definition = MACHINES[machine];
  const allowed = definition.transitions[from];
  if (allowed === undefined) {
    throw new UnknownStateError(machine, from);
  }
  return allowed;
}

export function isKnownState(machine: MachineName, state: string): boolean {
  return Object.prototype.hasOwnProperty.call(MACHINES[machine].transitions, state);
}

export function initialState(machine: MachineName): string {
  return MACHINES[machine].initial;
}

export function allowedTransitions(machine: MachineName, from: string): readonly string[] {
  return transitionsFor(machine, from);
}

export function canTransition(machine: MachineName, from: string, to: string): boolean {
  if (!isKnownState(machine, from) || !isKnownState(machine, to)) {
    return false;
  }
  return transitionsFor(machine, from).includes(to);
}

/**
 * Throws unless the transition is in the contract. Services call this inside the
 * same transaction that writes the new state and the outbox row, so an illegal
 * transition can never be persisted or published.
 */
export function assertTransition(machine: MachineName, from: string, to: string): void {
  if (!isKnownState(machine, from)) {
    throw new UnknownStateError(machine, from);
  }
  if (!isKnownState(machine, to)) {
    throw new UnknownStateError(machine, to);
  }
  const allowed = transitionsFor(machine, from);
  if (!allowed.includes(to)) {
    throw new IllegalTransitionError(machine, from, to, allowed);
  }
}

export function isTerminal(machine: MachineName, state: string): boolean {
  return transitionsFor(machine, state).length === 0;
}

/**
 * States reachable from the initial state. Used by the contract tests to prove
 * no state in the machine is orphaned — an unreachable state on the board means
 * a screen no journey can ever show.
 */
export function reachableStates(machine: MachineName): ReadonlySet<string> {
  const definition = MACHINES[machine];
  const seen = new Set<string>([definition.initial]);
  const queue: string[] = [definition.initial];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    for (const next of transitionsFor(machine, current)) {
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen;
}
