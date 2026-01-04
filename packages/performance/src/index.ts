/**
 * UBI Performance Tests - Entry Point
 *
 * Comprehensive performance testing suite for UBI.
 * Run all tests or individual test types.
 */

export * from "./config";
export * from "./helpers";

// Test exports
export { default as apiTest } from "./tests/api-test";
export { default as loadTest } from "./tests/load-test";
export { default as soakTest } from "./tests/soak-test";
export { default as spikeTest } from "./tests/spike-test";
export { default as stressTest } from "./tests/stress-test";

// Default export runs load test
export { default } from "./tests/load-test";
