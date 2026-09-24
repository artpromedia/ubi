/**
 * Production boot fails closed without the ride-service signing key.
 *
 * The real entry point (src/index.ts) is started as its own process with
 * NODE_ENV=production: without RIDE_INTERNAL_CONTEXT_SECRET it must exit
 * non-zero before listening — as ride-service itself refuses to start — and
 * with the key configured it must come up. Nothing here connects to a
 * database; the process is stopped as soon as it reports that it listens.
 */
import { spawn } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const SERVICE_ROOT = path.resolve(__dirname, "..");
const TSX = path.join(SERVICE_ROOT, "node_modules", ".bin", "tsx");

interface BootResult {
  readonly code: number | null;
  readonly output: string;
  readonly listened: boolean;
}

async function boot(extraEnv: Record<string, string>): Promise<BootResult> {
  const result = await new Promise<BootResult>((resolve, reject) => {
    const child = spawn(TSX, ["src/index.ts"], {
      cwd: SERVICE_ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "production",
        LOG_LEVEL: "info",
        PORT: "0",
        DATABASE_URL: "postgresql://boot-test@127.0.0.1:1/never-connected",
        REDIS_URL: "redis://127.0.0.1:1/0",
        ...extraEnv,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let listened = false;
    const onData = (chunk: Buffer): void => {
      output += chunk.toString("utf8");
      if (!listened && output.includes("ask-service listening")) {
        listened = true;
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    const guard = setTimeout(() => {
      child.kill("SIGKILL");
    }, 25_000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(guard);
      resolve({ code, output, listened });
    });
  });
  return result;
}

describe("production boot", () => {
  it("refuses to start without RIDE_INTERNAL_CONTEXT_SECRET", async () => {
    const result = await boot({});
    expect(result.listened).toBe(false);
    expect(result.code).toBe(1);
    expect(result.output).toContain(
      "refusing to start: RIDE_INTERNAL_CONTEXT_SECRET must be set in production",
    );
  });

  it("refuses to start when the secret is only separators", async () => {
    const result = await boot({ RIDE_INTERNAL_CONTEXT_SECRET: " , " });
    expect(result.listened).toBe(false);
    expect(result.code).toBe(1);
  });

  it("starts when the secret is configured", async () => {
    const result = await boot({
      RIDE_INTERNAL_CONTEXT_SECRET: "boot-test-ride-context-key-new,old",
    });
    expect(result.listened).toBe(true);
    expect(result.output).not.toContain("refusing to start");
  });
});
