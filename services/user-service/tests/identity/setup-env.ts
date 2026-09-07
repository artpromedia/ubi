/**
 * Environment for the identity integration tests.
 *
 * MUST be the first import in every identity test file: `src/lib/prisma` and
 * `src/lib/redis` read these variables when they are first imported, and ESM
 * evaluates imports in the order they are written.
 *
 * The tests talk to a real Postgres and a real Redis. The database is created
 * and migrated here if it does not exist yet, so `npx vitest run` works on a
 * fresh checkout without a separate setup step.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

const DATABASE_URL =
  process.env.IDENTITY_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_identity_test";

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.DATABASE_URL = DATABASE_URL;
process.env.REDIS_URL = process.env.IDENTITY_TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_SECRET = "user-service-test-client-facing-secret-1";
process.env.UBI_IDENTITY_SECRET = "user-service-test-internal-identity-01";
process.env.TELCO_SIM_SWAP_SECRET = "user-service-test-telco-webhook-secret-1";
process.env.IDENTITY_JOB_SERVICE_KEY = "user-service-test-identity-job-service-1";
process.env.IDENTITY_OTP_PEPPER = "user-service-test-otp-pepper";
process.env.IDENTITY_DEFAULT_CITY_ID = "LOS";

export const TEST_DATABASE_URL = DATABASE_URL;
export const CLIENT_JWT_SECRET = process.env.JWT_SECRET;
export const INTERNAL_IDENTITY_SECRET = process.env.UBI_IDENTITY_SECRET;
export const TELCO_SECRET = process.env.TELCO_SIM_SWAP_SECRET;
export const JOB_SERVICE_KEY = process.env.IDENTITY_JOB_SERVICE_KEY;

const DATABASE_PACKAGE = path.resolve(__dirname, "../../../../packages/database");

function psql(url: string, sql: string): string {
  const parsed = new URL(url);
  return execFileSync(
    "psql",
    [
      "-h",
      parsed.hostname,
      "-p",
      parsed.port === "" ? "5432" : parsed.port,
      "-U",
      decodeURIComponent(parsed.username),
      "-d",
      "postgres",
      "-tAc",
      sql,
    ],
    { env: { ...process.env, PGPASSWORD: decodeURIComponent(parsed.password) } },
  )
    .toString()
    .trim();
}

function ensureDatabase(): void {
  const name = new URL(DATABASE_URL).pathname.replace(/^\//, "");
  const exists = psql(DATABASE_URL, `SELECT 1 FROM pg_database WHERE datname = '${name}'`);
  if (exists === "") {
    psql(DATABASE_URL, `CREATE DATABASE "${name}" OWNER ubi`);
  }

  const migrated = execFileSync(
    "psql",
    [DATABASE_URL, "-tAc", "SELECT to_regclass('public.step_up_challenges')"],
    { env: process.env },
  )
    .toString()
    .trim();

  if (migrated === "") {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: DATABASE_PACKAGE,
      env: { ...process.env, DATABASE_URL },
      stdio: "ignore",
    });
  }
}

ensureDatabase();
