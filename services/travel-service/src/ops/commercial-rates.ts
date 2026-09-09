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

import { generateId } from "../lib/ids";
import { toJson } from "./json";

import type { TravelDeps } from "./context";
import type { JsonRecord, JsonValue } from "./types";

export interface CommercialRateInput {
  readonly supplierId: string;
  readonly routeOrProperty: string;
  readonly feeSchedule: JsonRecord;
  readonly source: string;
  readonly effectiveDate: string;
  readonly termsRef: string | null;
}

export async function upsertCommercialRate(
  deps: TravelDeps,
  input: CommercialRateInput,
): Promise<JsonRecord> {
  const supplier = await deps.db.travelSupplier.findUnique({
    where: { id: input.supplierId },
  });
  if (supplier === null) {
    throw new ContractError("not_found", "no such supplier", {
      supplierId: input.supplierId,
    });
  }
  const id = generateId("tcr");
  const row = await deps.db.travelCommercialRate.create({
    data: {
      id,
      supplierId: input.supplierId,
      routeOrProperty: input.routeOrProperty,
      feeSchedule: toJson(input.feeSchedule),
      source: input.source,
      effectiveDate: new Date(input.effectiveDate),
      termsRef: input.termsRef,
    },
  });
  return {
    id: row.id,
    supplierId: row.supplierId,
    routeOrProperty: row.routeOrProperty,
    source: row.source,
    effectiveDate: row.effectiveDate.toISOString().slice(0, 10),
    termsRef: row.termsRef,
  };
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
