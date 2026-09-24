/**
 * Background settlement passes for payment-service — replay-safe, never
 * overlapping in one process, and started only by the service bootstrap
 * (src/index.ts, never under test):
 *
 *  - the weekly FLEET remittance sweep (src/fleet/sweep.ts), started only
 *    when fleet-service is configured (`FLEET_SERVICE_URL` and a
 *    `FLEET_PAYMENT_SERVICE_KEY` of ≥ 32 characters) — and even then it
 *    settles only cities whose `fleet` flag is on;
 *  - the BUSINESS payout retry (src/business/payouts.ts): committed business
 *    trips whose driver payout was left pending.
 *
 * Every pass is exactly-once per money record, so passes in several
 * processes converge instead of double-paying.
 */
import { sweepPendingPayouts } from "./business/payouts";
import {
  httpSettlementInputsClient,
  MIN_FLEET_KEY_LENGTH,
} from "./fleet/inputs";
import { runFleetSettlementSweep } from "./fleet/sweep";
import { logger } from "./lib/logger";

import type { WalletDeps } from "./ledger/context";

const workerLogger = logger.child({ component: "settlement-worker" });

export interface SettlementWorker {
  stop(): void;
}

function every(
  name: string,
  intervalMs: number,
  pass: () => Promise<unknown>,
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) {
      return;
    }
    running = true;
    void pass()
      .catch((error: unknown) => {
        workerLogger.error(
          { err: error, pass: name },
          "settlement pass failed",
        );
      })
      .finally(() => {
        running = false;
      });
  }, intervalMs);
  timer.unref();
  workerLogger.info({ pass: name, intervalMs }, "settlement pass scheduled");
  return () => {
    clearInterval(timer);
  };
}

function intervalFrom(name: string, fallbackMs: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 1_000 ? parsed : fallbackMs;
}

export function startSettlementWorker(deps: WalletDeps): SettlementWorker {
  const stops: Array<() => void> = [];

  const fleetUrl = process.env.FLEET_SERVICE_URL ?? "";
  const fleetKey = process.env.FLEET_PAYMENT_SERVICE_KEY ?? "";
  if (fleetUrl.length > 0 && fleetKey.length >= MIN_FLEET_KEY_LENGTH) {
    const client = httpSettlementInputsClient();
    stops.push(
      every(
        "fleet_remittance",
        intervalFrom("FLEET_SETTLEMENT_SWEEP_INTERVAL_MS", 3_600_000),
        async () => {
          await runFleetSettlementSweep(deps, client);
        },
      ),
    );
  } else {
    workerLogger.info(
      "fleet settlement sweep not started: fleet-service is not configured",
    );
  }

  stops.push(
    every(
      "business_payouts",
      intervalFrom("BUSINESS_PAYOUT_SWEEP_INTERVAL_MS", 300_000),
      async () => {
        await sweepPendingPayouts(deps);
      },
    ),
  );

  return {
    stop(): void {
      for (const stop of stops) {
        stop();
      }
    },
  };
}
