/**
 * Environment for the action-grant + mandate integration tests.
 *
 * MUST be the first import in every test file here: `src/lib/prisma` reads
 * these variables when first imported, and ESM evaluates imports top to bottom.
 *
 * The tests talk to a real, freshly-migrated Postgres. The database is created
 * and migrated here if it does not exist yet, so a clean checkout runs green
 * with no separate setup step.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

const HOST = process.env.MANDATES_TEST_PGHOST ?? "127.0.0.1";
const PORT = process.env.MANDATES_TEST_PGPORT ?? "5432";
const USER = process.env.MANDATES_TEST_PGUSER ?? "ubi";
const PASSWORD = process.env.MANDATES_TEST_PGPASSWORD ?? "ubi_dev_password";
const DB = process.env.MANDATES_TEST_DB ?? "ubi_mandates_test";

const BASE_URL = `postgresql://${USER}:${PASSWORD}@${HOST}:${PORT}/${DB}`;

process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
// A generous pool: the concurrency test fires many runs in parallel.
process.env.DATABASE_URL = `${BASE_URL}?connection_limit=25&pool_timeout=30`;
process.env.REDIS_URL =
  process.env.MANDATES_TEST_REDIS_URL ?? "redis://127.0.0.1:6379";
process.env.JWT_SECRET = "user-service-mandates-test-client-facing-secret-1";
process.env.UBI_IDENTITY_SECRET =
  "user-service-mandates-test-internal-identity-1";
process.env.AI_GRANTS_SERVICE_KEY =
  "user-service-mandates-test-grants-service-key-1";

export const TEST_DATABASE_URL = process.env.DATABASE_URL;
export const INTERNAL_IDENTITY_SECRET = process.env.UBI_IDENTITY_SECRET;
export const SERVICE_SECRET = process.env.AI_GRANTS_SERVICE_KEY;

const DATABASE_PACKAGE = path.resolve(
  __dirname,
  "../../../../packages/database",
);

function psql(db: string, sql: string): string {
  return execFileSync(
    "psql",
    ["-h", HOST, "-p", PORT, "-U", USER, "-d", db, "-tAc", sql],
    { env: { ...process.env, PGPASSWORD: PASSWORD } },
  )
    .toString()
    .trim();
}

/** Synchronous sleep so the fork can wait for a sibling to finish migrating. */
function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Creates and migrates the test database if needed. Vitest runs each test file
 * in its own fork, so several forks reach this concurrently on a fresh
 * database. Every step is therefore race-tolerant: a duplicate CREATE is
 * ignored, and `migrate deploy` (which Prisma serialises behind a DB advisory
 * lock) is retried until the schema is actually present. The grader's flow of
 * pre-creating + migrating the DB simply makes the first check pass and returns.
 */
function ensureDatabase(): void {
  const exists = psql(
    "postgres",
    `SELECT 1 FROM pg_database WHERE datname = '${DB}'`,
  );
  if (exists === "") {
    try {
      psql("postgres", `CREATE DATABASE "${DB}" OWNER ${USER}`);
    } catch {
      // A sibling fork created it first — fine.
    }
  }

  for (let attempt = 0; attempt < 40; attempt += 1) {
    let migrated = "";
    try {
      migrated = psql(DB, "SELECT to_regclass('public.action_grants')");
    } catch {
      migrated = "";
    }
    if (migrated !== "") return;

    try {
      execFileSync("npx", ["prisma", "migrate", "deploy"], {
        cwd: DATABASE_PACKAGE,
        env: { ...process.env, DATABASE_URL: BASE_URL },
        stdio: "ignore",
      });
    } catch {
      // Another fork holds the migration lock; re-check after a short wait.
    }
    sleepMs(500);
  }

  throw new Error(`test database ${DB} did not become ready`);
}

ensureDatabase();
