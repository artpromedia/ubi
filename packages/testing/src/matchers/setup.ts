/**
 * Custom Matchers Setup
 *
 * Extend Vitest's expect with UBI-specific matchers.
 */

import { expect } from "vitest";
import { apiMatchers } from "./api.matchers";
import { locationMatchers } from "./location.matchers";
import { paymentMatchers } from "./payment.matchers";

/**
 * Setup all custom matchers
 */
export function setupMatchers() {
  expect.extend({
    ...apiMatchers,
    ...locationMatchers,
    ...paymentMatchers,
  });
}

/**
 * All matchers combined
 */
export const allMatchers = {
  ...apiMatchers,
  ...locationMatchers,
  ...paymentMatchers,
};
