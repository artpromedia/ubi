/**
 * Commercial rates — the config-stored fee schedules behind the launch
 * comparison harness (slice NEW-02).
 *
 * Each row carries the fee schedule for a route or property, plus its SOURCE and
 * EFFECTIVE DATE, so a comparison against the market can always cite where the
 * number came from and when it was agreed. Nothing here computes a traveller's
 * price — that is always the supplier's confirmed amount (CLAUDE.md #1, #23);
 * these rates are the commercial terms UBI books against, reconciled by finance.
 */
import { ContractError } from "@ubi/contracts";

import {
  runConsoleWrite,
  type ConsoleAnswer,
  type ConsoleCity,
  type ConsoleWrite,
} from "./console";
import { toJson } from "./json";
import { generateId } from "../lib/ids";

import type { TravelDeps } from "./context";
import type { Actor, JsonRecord, JsonValue } from "./types";

export interface CommercialRateInput {
  readonly supplierId: string;
  readonly routeOrProperty: string;
  readonly feeSchedule: JsonRecord;
  readonly source: string;
  readonly effectiveDate: string;
  readonly termsRef: string | null;
}

/**
 * Stores a commercial rate — a travel-ops console write, exactly once per
 * Idempotency-Key (./console.ts): a retry answers the rate the first call
 * stored instead of storing a second copy. The rate row and the console's
 * audit record (operator, city provenance when a city was named) commit
 * together.
 */
export async function upsertCommercialRate(
  deps: TravelDeps,
  input: CommercialRateInput & {
    readonly actor: Actor;
    /** Rates are supplier-level: null when the request names no city. */
    readonly city: ConsoleCity | null;
    readonly idempotencyKey: string;
  },
): Promise<ConsoleAnswer> {
  const write: ConsoleWrite = {
    operation: "commercial_rate",
    actor: input.actor,
    city: input.city,
    idempotencyKey: input.idempotencyKey,
    subjectType: "travel_supplier",
    subjectId: input.supplierId,
    request: {
      routeOrProperty: input.routeOrProperty,
      feeSchedule: input.feeSchedule,
      source: input.source,
      effectiveDate: input.effectiveDate,
      termsRef: input.termsRef,
    },
  };
  const answer = await runConsoleWrite(deps, write, async (record) => {
    const supplier = await deps.db.travelSupplier.findUnique({
      where: { id: input.supplierId },
    });
    if (supplier === null) {
      throw new ContractError("not_found", "no such supplier", {
        supplierId: input.supplierId,
      });
    }
    const body = await deps.db.$transaction(async (tx) => {
      const row = await tx.travelCommercialRate.create({
        data: {
          id: generateId("tcr"),
          supplierId: input.supplierId,
          routeOrProperty: input.routeOrProperty,
          feeSchedule: toJson(input.feeSchedule),
          source: input.source,
          effectiveDate: new Date(input.effectiveDate),
          termsRef: input.termsRef,
        },
      });
      const stored: JsonRecord = {
        id: row.id,
        supplierId: row.supplierId,
        routeOrProperty: row.routeOrProperty,
        source: row.source,
        effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
        termsRef: row.termsRef,
      };
      await record(tx, {
        action: "travel.ops.commercial_rate_stored",
        status: 201,
        result: stored,
        reason: `commercial rate for ${row.routeOrProperty} (source ${row.source})`,
      });
      return stored;
    });
    return { status: 201, body };
  });
  return answer;
}

export async function listCommercialRates(
  deps: TravelDeps,
  supplierId: string | null,
): Promise<readonly JsonRecord[]> {
  const rows = await deps.db.travelCommercialRate.findMany({
    where: supplierId === null ? {} : { supplierId },
    orderBy: [{ routeOrProperty: "asc" }, { effectiveDate: "desc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    supplierId: row.supplierId,
    routeOrProperty: row.routeOrProperty,
    feeSchedule: row.feeSchedule as JsonValue,
    source: row.source,
    effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
    termsRef: row.termsRef,
  }));
}
