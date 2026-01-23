/**
 * Global Setup for Admin Dashboard E2E Tests
 */

import { FullConfig } from "@playwright/test";

async function globalSetup(config: FullConfig): Promise<void> {
  console.log("🔧 Starting Admin Dashboard E2E test setup...");

  process.env.TZ = "UTC";

  Object.defineProperty(process.env, "NODE_ENV", {
    value: "test",
    writable: true,
    configurable: true,
  });

  console.log(`📍 Base URL: ${config.projects[0]?.use?.baseURL || "Not set"}`);

  const baseUrl = config.projects[0]?.use?.baseURL || "http://localhost:3002";
  await waitForService(baseUrl);

  console.log("✅ Admin Dashboard E2E test setup complete!");
}

async function waitForService(url: string, maxAttempts = 30): Promise<void> {
  console.log(`⏳ Waiting for service at ${url}...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok || response.status === 307) {
        // 307 is expected redirect to login
        console.log(`✅ Service is ready at ${url}`);
        return;
      }
    } catch {
      // Service not ready yet
    }

    if (attempt === maxAttempts) {
      throw new Error(
        `Service at ${url} did not become ready after ${maxAttempts} attempts`,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

export default globalSetup;
