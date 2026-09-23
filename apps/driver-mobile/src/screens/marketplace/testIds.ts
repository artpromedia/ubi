// testIDs for slice P9 (A04 driver economics), now registered in the closed
// registry packages/contracts/src/test-ids.ts. This module only re-shapes the
// registry entries for the P9 screens, so a screen can never drift from it.
import { TEST_IDS } from "@ubi/contracts";

const driver = TEST_IDS.mp.driver;

export const MP_DRIVER_TID = {
  earnings: driver.earnings,
  feed: {
    prefsBanner: driver.feed.prefsBanner,
    prefsToggle: driver.feed.prefsToggle,
    homewardTag: driver.feed.homewardTag,
  },
  detail: {
    preferenceNotice: driver.detail.preferenceNotice,
    presetPerHour: driver.detail.presetPerHour,
  },
  prefs: driver.prefs,
} as const;
