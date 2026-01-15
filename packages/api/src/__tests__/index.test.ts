import { describe, it, expect } from "vitest";

import * as api from "../index";

describe("@ubi/api", () => {
  it("should export ApiClient", () => {
    expect(api.ApiClient).toBeDefined();
  });

  it("should export createApiClient function", () => {
    expect(typeof api.createApiClient).toBe("function");
  });

  it("should export defaultConfig", () => {
    expect(api.defaultConfig).toBeDefined();
  });
});
