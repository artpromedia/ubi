/**
 * Global Setup for Playwright Tests
 *
 * Runs before all tests to set up the test environment.
 */

import { FullConfig } from "@playwright/test";

async function globalSetup(config: FullConfig): Promise<void> {
  console.log("🚀 Starting E2E test setup...");

  // Set timezone to UTC for consistent date handling
  // Using Object.assign to avoid TypeScript read-only assignment errors
  Object.assign(process.env, { TZ: "UTC", NODE_ENV: "test" });

  // Log test configuration
  console.log(`📍 Base URL: ${config.projects[0]?.use?.baseURL || "Not set"}`);
  console.log(`🔄 Retries: ${config.projects[0]?.retries || 0}`);
  console.log(`👥 Workers: ${config.workers || "default"}`);

  // Wait for services to be ready
  const baseUrl = config.projects[0]?.use?.baseURL || "http://localhost:3000";
  await waitForService(baseUrl);

  console.log("✅ E2E test setup complete!");
}

/**
 * Wait for a service to be ready
 */
async function waitForService(url: string, maxAttempts = 30): Promise<void> {
  console.log(`⏳ Waiting for service at ${url}...`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok) {
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
