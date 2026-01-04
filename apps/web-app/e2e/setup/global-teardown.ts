/**
 * Global Teardown for Playwright Tests
 *
 * Runs after all tests to clean up the test environment.
 */

import { FullConfig } from "@playwright/test";

async function globalTeardown(config: FullConfig): Promise<void> {
  console.log("🧹 Cleaning up E2E test environment...");

  // Cleanup tasks can be added here:
  // - Reset test database
  // - Clean up test files
  // - Stop mock services

  console.log("✅ E2E test cleanup complete!");
}

export default globalTeardown;
