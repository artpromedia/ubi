import { describe, expect, it } from "vitest";

import * as utils from "../index";

describe("@ubi/utils", () => {
  it("should export validation schemas", () => {
    expect(utils).toBeDefined();
  });

  it("should export formatters", () => {
    expect(typeof utils.formatCurrency).toBe("function");
  });

  it("should export constants", () => {
    expect(utils.UBI_COUNTRIES).toBeDefined();
    expect(utils.CURRENCIES).toBeDefined();
  });
});
