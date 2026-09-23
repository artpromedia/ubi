/**
 * The weekly fleet settlement sweep: for every city whose `fleet` flag is ON,
 * settle the most recent COMPLETED week — and the week before it, so a pass
 * that was missed (a deploy, an outage, fleet-service unreachable) catches
 * up, and a correction fleet-service makes to last week's inputs is picked up
 * as a linked adjustment. Every item is exactly-once on (assignment, week),
 * so the sweep is safe to run any number of times, in any number of
 * processes; a city that fails is logged and retried on the next pass.
 */
import { isEnabled } from "@ubi/contracts";

import { addDays, FLEET_FLAG, FLEET_SETTLEMENT_ACTOR } from "./model";
import { runWeeklySettlement, type SettlementRunResult } from "./settlement";
import { dateInZone } from "../ledger/day-window";
import { logger } from "../lib/logger";

import type { SettlementInputsClient } from "./inputs";
import type { WalletDeps } from "../ledger/context";

const sweepLogger = logger.child({ component: "fleet-settlement-sweep" });

/** The Monday starting the last week that has fully ended in `timeZone`. */
export function lastCompletedWeekStart(now: Date, timeZone: string): string {
  const today = dateInZone(now, timeZone);
  const day = new Date(`${today}T00:00:00.000Z`).getUTCDay();
  const thisMonday = addDays(today, -((day + 6) % 7));
  return addDays(thisMonday, -7);
}

export interface SweepReport {
  readonly runs: ReadonlyArray<{
    readonly cityId: string;
    readonly weekStart: string;
    readonly totals: SettlementRunResult["totals"] | null;
    readonly error: string | null;
  }>;
}

export async function runFleetSettlementSweep(
  deps: WalletDeps,
  client: SettlementInputsClient,
  options: {
    readonly weeksBack?: number;
    /** Restrict the pass to these cities (still only where the flag is on). */
    readonly cityIds?: readonly string[];
  } = {},
): Promise<SweepReport> {
  const weeksBack = Math.max(1, options.weeksBack ?? 2);
  const cities = await deps.db.city.findMany({
    where: {
      active: true,
      ...(options.cityIds === undefined
        ? {}
        : { id: { in: [...options.cityIds] } }),
    },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  const runs: Array<SweepReport["runs"][number]> = [];
  for (const { id: cityId } of cities) {
    let timezone: string;
    try {
      const { city, flags } = await deps.config.load(cityId);
      if (!isEnabled(flags, FLEET_FLAG)) {
        continue; // deny-by-default: nothing settles where fleet is off
      }
      timezone = city.timezone;
    } catch {
      continue; // an unconfigured city has no fleets to settle
    }
    const newest = lastCompletedWeekStart(deps.now(), timezone);
    for (let back = weeksBack - 1; back >= 0; back -= 1) {
      const weekStart = addDays(newest, -7 * back);
      try {
        const result = await runWeeklySettlement(deps, client, {
          cityId,
          weekStart,
          actor: FLEET_SETTLEMENT_ACTOR,
        });
        runs.push({ cityId, weekStart, totals: result.totals, error: null });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sweepLogger.error(
          { err: error, cityId, weekStart },
          "fleet settlement pass failed for a city week; the next pass retries it",
        );
        runs.push({ cityId, weekStart, totals: null, error: message });
      }
    }
  }
  return { runs };
}
