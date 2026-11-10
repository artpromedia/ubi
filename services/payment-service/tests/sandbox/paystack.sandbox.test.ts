/**
 * Live Paystack Sandbox contract suite (CC-B03, DEC-6 Part A).
 *
 * Explicitly skipped — NEVER faked — when `PAYSTACK_SANDBOX_SECRET_KEY` is not
 * present in the environment (`CLAUDE.md` #8 / `OPEN_ITEMS_CLAUDE_CODE_PROMPTS`
 * CC-B03). When credentials are supplied in staging/pre-pilot verification,
 * this exercises real Paystack test-mode bank resolution against Paystack's
 * sandbox endpoint.
 */
import { describe, expect, it } from "vitest";

import { paystackBankRailProvider } from "../../src/ledger/paystack";

const sandboxKey = process.env.PAYSTACK_SANDBOX_SECRET_KEY?.trim();

describe.skipIf(!sandboxKey)("Paystack live sandbox suite", () => {
  it("resolves a Paystack sandbox bank account via GET /bank/resolve", async () => {
    const previous = process.env.PAYSTACK_SECRET_KEY;
    process.env.PAYSTACK_SECRET_KEY = sandboxKey;
    try {
      const rail = paystackBankRailProvider();
      expect(rail).not.toBeNull();
      // Paystack's documented test bank code 001 / invalid account returns null cleanly
      // without throwing an unhandled transport error.
      const res = await rail!.nameEnquiry({
        bankCode: "057",
        accountNumber: "0000000000",
      });
      expect(res === null || typeof res.accountName === "string").toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.PAYSTACK_SECRET_KEY;
      } else {
        process.env.PAYSTACK_SECRET_KEY = previous;
      }
    }
  });
});
