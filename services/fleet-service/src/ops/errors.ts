/**
 * Errors: the canonical contract codes plus the fleet codes the contract has
 * not registered yet (packages/contracts/src/fleet.ts FLEET_ERROR_STATUS).
 *
 * Clients branch on `code`, never on message text. Every failure leaves the
 * service as `{ code, message, details? }` (middleware/error-handler.ts).
 */
import {
  ContractError,
  IllegalTransitionError,
  UnknownStateError,
} from "@ubi/contracts";

import { FLEET_ERROR_STATUS, type FleetErrorCode } from "../contract";

/** A fleet-specific refusal (shift_overlap, above_city_cap, needs_resolution, …). */
export class FleetError extends Error {
  readonly status: number;

  constructor(
    readonly code: FleetErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "FleetError";
    this.status = FLEET_ERROR_STATUS[code];
  }

  toBody(): {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    return this.details === undefined
      ? { code: this.code, message: this.message }
      : {
          code: this.code,
          message: this.message,
          details: { ...this.details },
        };
  }
}

/** An illegal move on one of the fleet state machines. */
export function illegalTransition(
  machine: string,
  from: string,
  to: string,
): ContractError {
  return new ContractError(
    "illegal_transition",
    `illegal ${machine} transition ${from} → ${to}`,
    { machine, from, to },
  );
}

export function notFound(what: string): ContractError {
  return new ContractError("not_found", `${what} not found`);
}

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
  return new ContractError(
    "internal_error",
    "something went wrong handling that request",
  );
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/** Postgres refused a duplicate key (a replay's deterministic id, a unique index). */
export function isUniqueViolation(error: unknown): boolean {
  if (errorCode(error) === "P2002") {
    return true;
  }
  const meta = (error as { meta?: { code?: unknown } } | null)?.meta;
  return meta?.code === "23505";
}

/**
 * Postgres refused an overlap by an EXCLUDE constraint (SQLSTATE 23P01): two
 * signed shifts, two planned blocks, two active fleets for one vehicle.
 * Prisma surfaces it as a raw-query error (meta.code) or an unknown request
 * error whose message carries the SQLSTATE and constraint name.
 */
export function exclusionConstraintOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const meta = (error as { meta?: { code?: unknown; message?: unknown } }).meta;
  const message = String((error as { message?: unknown }).message ?? "");
  const metaMessage = typeof meta?.message === "string" ? meta.message : "";
  const text = `${message}\n${metaMessage}`;
  if (
    meta?.code !== "23P01" &&
    !text.includes("23P01") &&
    !text.includes("exclusion constraint")
  ) {
    return null;
  }
  const named = /constraint "([^"]+)"/.exec(text);
  return named?.[1] ?? "exclusion_constraint";
}
