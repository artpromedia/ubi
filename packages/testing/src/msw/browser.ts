/**
 * MSW Browser Setup
 *
 * For browser environments (E2E tests, Storybook, etc.)
 */

import { setupWorker } from "msw/browser";

import { handlers } from "./handlers";

/**
 * Create and configure MSW worker for browser
 */
export const worker = setupWorker(...handlers);

/**
 * Start the MSW worker in the browser
 */
export async function startMswWorker(options?: {
  onUnhandledRequest?: "warn" | "error" | "bypass";
}) {
  const registration = await worker.start({
    onUnhandledRequest: options?.onUnhandledRequest || "warn",
    serviceWorker: {
      url: "/mockServiceWorker.js",
    },
  });
  return registration;
}

/**
 * Stop the MSW worker
 */
export function stopMswWorker() {
  worker.stop();
}
