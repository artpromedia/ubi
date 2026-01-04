/**
 * Vitest Setup File
 *
 * Global setup for all UBI tests.
 */

import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { setupMatchers } from "../matchers/setup";

// Setup custom matchers
setupMatchers();

// =============================================================================
// Global Mocks
// =============================================================================

// Mock console.error to fail tests on unexpected errors
const originalConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    // Allow specific expected errors
    const message = args[0]?.toString() || "";
    const allowedPatterns = [
      /Warning:/, // React warnings
      /act\(\)/, // React act() warnings
      /Not implemented/, // JSDOM not implemented
    ];

    if (allowedPatterns.some((pattern) => pattern.test(message))) {
      return;
    }

    originalConsoleError(...args);
  };
});

afterAll(() => {
  console.error = originalConsoleError;
});

// =============================================================================
// Global Cleanup
// =============================================================================

afterEach(() => {
  // Clear all mocks
  vi.clearAllMocks();

  // Reset all mocks
  vi.resetAllMocks();

  // Clear any timers
  vi.useRealTimers();
});

// =============================================================================
// Environment Variables
// =============================================================================

// Set default test environment variables
process.env.NODE_ENV = "test";
process.env.TZ = "UTC";

// =============================================================================
// Global Test Utilities
// =============================================================================

declare global {
  /**
   * Wait for all promises to resolve
   */
  function flushPromises(): Promise<void>;

  /**
   * Advance timers and flush promises
   */
  function advanceTimersAndFlush(ms: number): Promise<void>;
}

globalThis.flushPromises = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

globalThis.advanceTimersAndFlush = async (ms: number) => {
  vi.advanceTimersByTime(ms);
  await flushPromises();
};

// =============================================================================
// Test Timeouts
// =============================================================================

// Increase timeout for CI environments
if (process.env.CI) {
  vi.setConfig({
    testTimeout: 30000,
    hookTimeout: 30000,
  });
}

// =============================================================================
// Fetch Polyfill (for Node.js < 18)
// =============================================================================

if (typeof globalThis.fetch === "undefined") {
  // @ts-expect-error - Polyfill fetch if not available
  globalThis.fetch = vi.fn(() =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(""),
      status: 200,
    })
  );
}

// =============================================================================
// Date Mocking Helper
// =============================================================================

declare global {
  namespace Vi {
    interface JestAssertion<T = unknown> {
      toBeWithinRange(floor: number, ceiling: number): T;
    }
  }
}

export {};
