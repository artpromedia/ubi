/**
 * @ubi/testing
 *
 * Shared testing utilities for the UBI monorepo.
 *
 * @example
 * ```typescript
 * // Import factories
 * import { createUser, createRide, createFoodOrder } from "@ubi/testing";
 *
 * // Import fixtures
 * import { TEST_USERS, TEST_RIDES, LAGOS_LOCATIONS } from "@ubi/testing";
 *
 * // Import MSW handlers
 * import { handlers, setupMswServer } from "@ubi/testing/msw";
 *
 * // Import Vitest config
 * import { createServiceConfig } from "@ubi/testing/vitest";
 * ```
 */

// Export all factories
export * from "./factories";

// Export all fixtures
export * from "./fixtures";

// Export all matchers
export * from "./matchers";

// Export types
export * from "./types";

// Export utilities
export * from "./utils";
