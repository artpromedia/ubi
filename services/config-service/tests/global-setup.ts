/**
 * Creates the dedicated test database if it is missing and brings it up to the
 * current schema. Nothing here touches the shared development database.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const TEST_DATABASE_URL =
  process.env.CONFIG_TEST_DATABASE_URL ??
  "postgresql://ubi:ubi_dev_password@127.0.0.1:5432/ubi_config_test";

const DATABASE_PACKAGE = path.resolve(__dirname, "../../../packages/database");

function adminUrl(url: string): string {
  const parsed = new URL(url);
  parsed.pathname = "/postgres";
  return parsed.toString();
}

function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, "");
}

export default async function setup(): Promise<void> {
  const name = databaseName(TEST_DATABASE_URL);
  const admin = new PrismaClient({
    datasources: { db: { url: adminUrl(TEST_DATABASE_URL) } },
  });
  try {
    const existing = await admin.$queryRawUnsafe<unknown[]>(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      name,
    );
    if (existing.length === 0) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${name}" OWNER ubi`);
    }
  } finally {
    await admin.$disconnect();
  }

  const target = new PrismaClient({
    datasources: { db: { url: TEST_DATABASE_URL } },
  });
  let migrated = false;
  try {
    const table = await target.$queryRawUnsafe<
      Array<{ regclass: string | null }>
    >("SELECT to_regclass('public.city_config_versions')::text AS regclass");
    migrated = table[0]?.regclass !== null && table[0]?.regclass !== undefined;
  } finally {
    await target.$disconnect();
  }

  if (!migrated) {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      cwd: DATABASE_PACKAGE,
      env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
      stdio: "inherit",
    });
  }
}
