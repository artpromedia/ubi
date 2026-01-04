/**
 * MSW Server Setup
 *
 * For Node.js environments (API testing, SSR, etc.)
 */

import { setupServer } from "msw/node";
import { handlers } from "./handlers";

/**
 * Create and configure MSW server for Node.js
 */
export const server = setupServer(...handlers);

/**
 * Server lifecycle helpers for test setup
 */
export function setupMswServer() {
  // Start server before all tests
  beforeAll(() => {
    server.listen({
      onUnhandledRequest: "warn",
    });
  });

  // Reset handlers after each test
  afterEach(() => {
    server.resetHandlers();
  });

  // Clean up after all tests
  afterAll(() => {
    server.close();
  });

  return server;
}

/**
 * Add custom handlers for specific tests
 */
export function addHandlers(...customHandlers: Parameters<typeof server.use>) {
  server.use(...customHandlers);
}

/**
 * Reset to default handlers
 */
export function resetHandlers() {
  server.resetHandlers();
}
