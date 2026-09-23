/**
 * Starts a REAL sibling service as its own process for a contract test — the
 * service's actual entry point, router registry, auth middleware and database
 * code — and stops it afterwards. Nothing here fakes a response.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

export interface SpawnedService {
  readonly baseUrl: string;
  output(): string;
  stop(): Promise<void>;
}

export interface SpawnOptions {
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly healthPath: string;
  readonly readyTimeoutMs?: number;
  /** The env var the service reads its listen port from (default PORT). */
  readonly portEnv?: string;
}

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const found =
        typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => {
        resolve(found);
      });
    });
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function spawnService(
  options: SpawnOptions,
): Promise<SpawnedService> {
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let output = "";
  const child: ChildProcess = spawn(options.command, [...options.args], {
    cwd: options.cwd,
    env: {
      PATH: process.env.PATH ?? "",
      HOME: process.env.HOME ?? "",
      ...options.env,
      [options.portEnv ?? "PORT"]: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const collect = (chunk: Buffer): void => {
    // Keep the tail only: a chatty service must not grow the test's memory.
    output = (output + chunk.toString("utf8")).slice(-20_000);
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);

  const stop = async (): Promise<void> => {
    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }
    await new Promise<void>((resolve) => {
      const guard = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(guard);
        resolve();
      });
      child.kill("SIGTERM");
    });
  };

  const deadline = Date.now() + (options.readyTimeoutMs ?? 60_000);
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `${options.name} exited (${child.exitCode}) before it was healthy:\n${output}`,
      );
    }
    try {
      const response = await fetch(`${baseUrl}${options.healthPath}`);
      if (response.ok) {
        return { baseUrl, output: () => output, stop };
      }
    } catch {
      // not listening yet
    }
    await sleep(250);
  }
  await stop();
  throw new Error(`${options.name} did not become healthy:\n${output}`);
}
