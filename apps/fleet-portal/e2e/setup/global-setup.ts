/**
 * Global Setup for Fleet Portal E2E Tests
 */

import { FullConfig } from "@playwright/test";

async function globalSetup(config: FullConfig): Promise<void> {
  console.log("🚚 Starting Fleet Portal E2E test setup...");

  process.env.TZ = "UTC";

  Object.defineProperty(process.env, "NODE_ENV", {
    value: "test",
    writable: true,
    configurable: true,
  });

  const baseUrl = config.projects[0]?.use?.baseURL || "http://localhost:3005";
  await waitForService(baseUrl);

  console.log("✅ Fleet Portal E2E test setup complete!");
}

async function waitForService(url: string, maxAttempts = 30): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok || response.status === 307) {
        console.log(`✅ Service is ready at ${url}`);
        return;
      }
    } catch {
      // Service not ready yet
    }

    if (attempt === maxAttempts) {
      throw new Error(`Service at ${url} did not become ready`);
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

export default globalSetup;
