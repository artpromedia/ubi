/**
 * Environment for the driver-profile read-model tests.
 *
 * MUST be the first import in every test file here. It reuses the identity
 * suite's bootstrap — the same `IDENTITY_TEST_DATABASE_URL` Postgres, created
 * and migrated on first use — and adds the per-caller service keys the
 * `/internal/driver-profiles` surface authenticates with.
 */
import "../identity/setup-env";

process.env.DRIVER_PROFILE_RIDE_SERVICE_KEY =
  "user-service-test-driver-profile-ride-service-key-01";
process.env.DRIVER_PROFILE_ASK_SERVICE_KEY =
  "user-service-test-driver-profile-ask-service-key-001";

export const RIDE_SERVICE_KEY = process.env.DRIVER_PROFILE_RIDE_SERVICE_KEY;
export const ASK_SERVICE_KEY = process.env.DRIVER_PROFILE_ASK_SERVICE_KEY;
