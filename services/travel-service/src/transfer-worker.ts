/**
 * The airport-transfer worker: a durable, replay-safe pass over live transfers
 * (ops/transfer-orchestrator.ts `runTransferSweep`). Each pass makes the
 * scheduled ride requests whose horizon opened, carries retimes and
 * withdrawals to ride-service, reads live requests back (award, no driver,
 * cancelled) and closes transfers whose window passed. Passes never overlap in
 * this process, and a per-transfer lease keeps two processes off one transfer.
 */
import { logger } from "./lib/logger";
import { runTransferSweep } from "./ops/transfer-orchestrator";

import type { TravelDeps } from "./ops/context";

const workerLogger = logger.child({ component: "transfer-worker" });

export interface TransferWorker {
  stop(): void;
}

export function startTransferWorker(
  deps: TravelDeps,
  intervalMs = Number.parseInt(
    process.env.TRANSFER_SWEEP_INTERVAL_MS ?? "30000",
    10,
  ),
): TransferWorker {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void runTransferSweep(deps)
      .catch((error: unknown) => {
        workerLogger.error({ err: error }, "airport transfer sweep failed");
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  workerLogger.info({ intervalMs }, "airport transfer worker started");
  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}
