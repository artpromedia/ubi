// testIDs for the fleet calendar driver screens (A05, handoff C1–C5), registered in the
// closed registry packages/contracts/src/test-ids.ts (TEST_IDS.driver.fleet). This
// module only re-exports that block so a screen can never drift from it.
import { TEST_IDS } from "@ubi/contracts";

export const FLEET_TID = TEST_IDS.driver.fleet;

/** The load-state ids LoadFailure takes (offline / error / retry). */
export const FLEET_LOAD_TIDS = {
  offline: FLEET_TID.offline,
  error: FLEET_TID.error,
  retry: FLEET_TID.retry,
} as const;
