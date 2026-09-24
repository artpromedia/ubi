/**
 * Environment for the business travel organization tests.
 *
 * MUST be the first import in every test file here. It reuses the identity
 * suite's bootstrap — the same `IDENTITY_TEST_DATABASE_URL` Postgres, created
 * and migrated on first use — because organizations authenticate with the
 * same gateway-signed identity context (`UBI_IDENTITY_SECRET`).
 */
import "../identity/setup-env";
