/**
 * Money crosses the Prisma boundary as `BigInt` (the columns are `bigint`) and
 * lives in application code as an integer `number` inside `Money`. These two
 * helpers are the only place that conversion happens, and they refuse to lose
 * precision silently.
 */
import { ContractError } from "@ubi/contracts";

export function toDbMinor(amountMinor: number): bigint {
  if (!Number.isInteger(amountMinor)) {
    throw new ContractError(
      "validation_failed",
      "money must be an integer number of minor units",
      { amountMinor },
    );
  }
  return BigInt(amountMinor);
}

export function fromDbMinor(value: bigint): number {
  if (
    value > BigInt(Number.MAX_SAFE_INTEGER) ||
    value < BigInt(Number.MIN_SAFE_INTEGER)
  ) {
    throw new ContractError(
      "internal_error",
      "ledger amount exceeds the safe integer range and cannot be represented",
      { value: value.toString() },
    );
  }
  return Number(value);
}

export function fromNullableDbMinor(value: bigint | null | undefined): number {
  return value === null || value === undefined ? 0 : fromDbMinor(value);
}
