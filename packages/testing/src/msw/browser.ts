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
  return worker.start({
    onUnhandledRequest: options?.onUnhandledRequest || "warn",
    serviceWorker: {
      url: "/mockServiceWorker.js",
    },
  });
}

/**
 * Stop the MSW worker
 */
export function stopMswWorker() {
  worker.stop();
}
