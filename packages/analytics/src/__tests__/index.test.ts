import { describe, it, expect } from "vitest";

import * as analytics from "../index";

describe("@ubi/analytics", () => {
  it("should export createAnalytics function", () => {
    expect(typeof analytics.createAnalytics).toBe("function");
  });

  it("should export Analytics class", () => {
    expect(analytics.Analytics).toBeDefined();
  });

  it("should export provider classes", () => {
    expect(analytics.ConsoleProvider).toBeDefined();
    expect(analytics.MixpanelProvider).toBeDefined();
  });
});
