// testIDs for slice P9 (A04 driver economics) and the A02/A03 trip, amendment and
// booking-calendar screens, registered in the closed registry
// packages/contracts/src/test-ids.ts. This module only re-shapes the registry entries
// for these screens, so a screen can never drift from it.
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
    bookingWindow: driver.detail.bookingWindow,
    advanceTerms: driver.detail.advanceTerms,
  },
  prefs: driver.prefs,
  jobs: driver.jobs,
  trip: driver.trip,
  amend: driver.amend,
  calendar: driver.calendar,
} as const;
