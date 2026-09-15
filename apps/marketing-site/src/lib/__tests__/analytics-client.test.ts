import { describe, expect, it } from "vitest";

import { CONSENT_COOKIE, hasAnalyticsConsent } from "@/lib/analytics-client";

describe("analytics consent", () => {
  it("is off with no cookie", () => {
    expect(hasAnalyticsConsent("")).toBe(false);
    expect(hasAnalyticsConsent("other=1")).toBe(false);
  });

  it("is on for the analytics token or JSON analytics:true", () => {
    expect(hasAnalyticsConsent(`${CONSENT_COOKIE}=necessary,analytics`)).toBe(
      true,
    );
    expect(
      hasAnalyticsConsent(
        `a=b; ${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify({ analytics: true }))}`,
      ),
    ).toBe(true);
  });

  it("stays off for other values", () => {
    expect(hasAnalyticsConsent(`${CONSENT_COOKIE}=necessary`)).toBe(false);
    expect(
      hasAnalyticsConsent(
        `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify({ analytics: false }))}`,
      ),
    ).toBe(false);
  });
});
