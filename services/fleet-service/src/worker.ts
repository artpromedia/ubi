/**
 * The server clock for fleet state. Every minute, under a Redis lock so two
 * replicas never run the same sweep at once (and every sweep is idempotent
 * anyway):
 *  - unsigned offers past 48 h → expired;
 *  - arrangements past their notice / validity end → ended;
 *  - maintenance: scheduled → active at its start, planned active →
 *    completed at its end (an off-road block ends only when the fleet says
 *    the vehicle is back);
 *  - off-road blocks whose ledger write failed → retried (idempotent);
 *  - off-road integrity: a vehicle seen on a trip / online during a claimed
 *    breakdown → flagged for UBI ops;
 *  - document expiry warnings (30/14/7/1 days, and bookings past an expiry);
 *  - conflicts past their decision deadline → lapsed.
 */
import { workerLogger } from "./lib/logger";
import { withSweepLock } from "./lib/redis";
import { endLapsedArrangements, expireProposals } from "./ops/assignments";
import { documentSweep, lapseConflicts } from "./ops/documents";
import {
  advanceMaintenanceClock,
  checkOffRoadIntegrity,
  retryUnrecordedOffRoad,
} from "./ops/maintenance";

import type { FleetDeps } from "./ops/context";
import type Redis from "ioredis";

export async function runSweeps(
  deps: FleetDeps,
): Promise<Record<string, number>> {
  const results: Record<string, number> = {};
  const sweeps: [string, (d: FleetDeps) => Promise<number>][] = [
    ["proposalsExpired", expireProposals],
    ["arrangementsEnded", endLapsedArrangements],
    ["maintenanceAdvanced", advanceMaintenanceClock],
    ["offRoadRecorded", retryUnrecordedOffRoad],
    ["offRoadFlagged", checkOffRoadIntegrity],
    ["documentWarnings", documentSweep],
    ["conflictsLapsed", lapseConflicts],
  ];
  for (const [name, sweep] of sweeps) {
    try {
      results[name] = await sweep(deps);
    } catch (error) {
      workerLogger.error({ err: error, sweep: name }, "fleet sweep failed");
      results[name] = -1;
    }
  }
  return results;
}

export function startWorker(
  deps: FleetDeps,
  redis: Redis,
  intervalMs = 60_000,
): { stop(): void } {
  let running = false;
  const tick = async (): Promise<void> => {
    if (running) {
      return;
    }
    running = true;
    try {
      await withSweepLock(
        redis,
        "fleet-service:sweeps",
        Math.ceil(intervalMs / 1000) * 2,
        async () => {
          const results = await runSweeps(deps);
          return results;
        },
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
    },
  };
}
